use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::abacatepay_gateway;
use crate::pandadoc;
use crate::state::AppState;

/// Webhook da AbacatePay — preparado, sem tráfego real ainda (gateway em
/// modo mock até ter credencial). Sempre responde 200 pra AbacatePay nunca
/// retry-stormar por eventos que não reconhecemos, mesmo padrão já usado
/// no motor de e-commerce pro webhook da Evolution API.
pub async fn abacatepay_webhook(State(state): State<AppState>, Json(payload): Json<Value>) -> StatusCode {
    let Some((external_id, status)) = abacatepay_gateway::handle_webhook(&payload).await else {
        return StatusCode::OK;
    };
    if status != "PAID" {
        return StatusCode::OK;
    }

    let result: Result<Option<(Option<String>, Option<String>)>, _> = sqlx::query_as(
        "UPDATE subscribers SET status = 'ativo', \
         onboarding_status = CASE \
           WHEN slug IS NOT NULL AND NULLIF(trim(slug), '') IS NOT NULL THEN 'provisionado' \
           WHEN tenant_id IS NOT NULL AND NULLIF(trim(tenant_id), '') IS NOT NULL THEN 'provisionado' \
           WHEN onboarding_status = 'aguardando_pagamento' THEN 'aguardando_onboarding' \
           ELSE onboarding_status END, \
         updated_at = now() WHERE mp_preapproval_id = $1 \
         RETURNING slug, plan_code",
    )
    .bind(&external_id)
    .fetch_optional(&state.pool)
    .await;

    match result {
        Ok(Some((slug, plan_code))) => {
            if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if let Err(e) = crate::routes::onboarding::sync_ecommerce_tenant_status_with_plan(
                    &state,
                    slug,
                    "ativo",
                    plan_code.as_deref(),
                )
                .await
                {
                    tracing::warn!("abacatepay webhook: sync tenant online failed: {e:?}");
                }
            }
        }
        Ok(None) => {}
        Err(e) => {
            tracing::warn!("abacatepay webhook: failed to update subscriber for charge {external_id}: {e:?}");
        }
    }

    StatusCode::OK
}

#[derive(Debug, Deserialize)]
pub struct PandadocWebhookQuery {
    /// HMAC-SHA256 hex do body — PandaDoc anexa automaticamente.
    pub signature: Option<String>,
}

/// Webhook PandaDoc — contrato lojista (`platform_subscription` / Plano Essential).
///
/// URL: `POST /api/webhooks/pandadoc?signature=…`
/// Eventos recomendados: `recipient_completed`, `document_state_changed`, `document_updated`.
///
/// Verificação: se `PANDADOC_WEBHOOK_SHARED_KEY` (ou `PANDADOC_WEBHOOK_SECRET`) estiver
/// setado, exige assinatura válida (403 caso contrário). Sem key: processa com warn
/// (sandbox local / setup incompleto).
pub async fn pandadoc_webhook(
    State(state): State<AppState>,
    Query(q): Query<PandadocWebhookQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    let event_id = headers
        .get("X-PandaDoc-Webhook-Event-Id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-");

    if let Some(key) = state.pandadoc.webhook_shared_key.as_deref() {
        let Some(sig) = q.signature.as_deref().filter(|s| !s.is_empty()) else {
            tracing::warn!(
                event_id,
                "pandadoc webhook: shared key configurada mas query signature ausente — 403"
            );
            return StatusCode::FORBIDDEN;
        };
        if !pandadoc::verify_webhook_signature(key, &body, sig) {
            tracing::warn!(
                event_id,
                "pandadoc webhook: assinatura HMAC inválida — 403"
            );
            return StatusCode::FORBIDDEN;
        }
    } else {
        tracing::warn!(
            event_id,
            "pandadoc webhook: PANDADOC_WEBHOOK_SHARED_KEY não setada — aceitando sem verificação"
        );
    }

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(event_id, error = %e, "pandadoc webhook: JSON inválido — 200 (sem retry storm)");
            return StatusCode::OK;
        }
    };

    let events = match payload.as_array() {
        Some(arr) => arr.as_slice(),
        None => {
            // Alguns testes enviam objeto único; normaliza.
            std::slice::from_ref(&payload)
        }
    };

    for item in events {
        let event_name = item
            .get("event")
            .and_then(|e| e.as_str())
            .unwrap_or("");
        let data = item.get("data").cloned().unwrap_or(Value::Null);
        if let Err(e) = handle_pandadoc_event(&state, event_id, event_name, &data).await {
            tracing::warn!(
                event_id,
                event_name,
                error = %e,
                "pandadoc webhook: falha ao processar evento (continua 200)"
            );
        }
    }

    StatusCode::OK
}

async fn handle_pandadoc_event(
    state: &AppState,
    delivery_id: &str,
    event_name: &str,
    data: &Value,
) -> Result<(), String> {
    let doc_id = data
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if doc_id.is_empty() {
        tracing::info!(delivery_id, event_name, "pandadoc webhook: evento sem data.id — ignorado");
        return Ok(());
    }

    let pd_status = data.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let meta = data.get("metadata").cloned().unwrap_or(json!({}));

    tracing::info!(
        delivery_id,
        event_name,
        pandadoc_document_id = %doc_id,
        pandadoc_status = pd_status,
        "pandadoc webhook: recebido"
    );

    match event_name {
        "recipient_completed" => {
            // Contrato Essential = 1 assinante (lojista). Recipient completed ⇒ via assinada.
            apply_contract_status(state, &doc_id, "completed", delivery_id, event_name, &meta, data)
                .await?;
        }
        "document_state_changed" => {
            if let Some(internal) = pandadoc::map_document_status(pd_status) {
                apply_contract_status(state, &doc_id, internal, delivery_id, event_name, &meta, data)
                    .await?;
            } else {
                tracing::info!(
                    delivery_id,
                    event_name,
                    pandadoc_document_id = %doc_id,
                    pandadoc_status = pd_status,
                    "pandadoc webhook: status sem mapeamento — só log"
                );
            }
        }
        "document_updated" => {
            // Doc voltou a draft / conteúdo alterado — registra se já existir via.
            let internal = pandadoc::map_document_status(pd_status).unwrap_or("draft");
            apply_contract_status(state, &doc_id, internal, delivery_id, event_name, &meta, data)
                .await?;
        }
        other => {
            tracing::info!(
                delivery_id,
                event = other,
                pandadoc_document_id = %doc_id,
                "pandadoc webhook: evento não tratado (ok)"
            );
        }
    }

    Ok(())
}

async fn apply_contract_status(
    state: &AppState,
    pandadoc_document_id: &str,
    new_status: &str,
    delivery_id: &str,
    event_name: &str,
    metadata: &Value,
    data: &Value,
) -> Result<(), String> {
    let patch = json!({
        "last_webhook_event_id": delivery_id,
        "last_webhook_event": event_name,
        "last_webhook_at": chrono::Utc::now().to_rfc3339(),
        "pandadoc_status": data.get("status"),
    });

    // Idempotente: se já completed e novo status também completed, só atualiza metadata.
    let updated: Option<(String, Option<String>, String)> = sqlx::query_as(
        "UPDATE contract_documents SET \
           status = CASE \
             WHEN status = 'completed' AND $1 <> 'completed' AND $1 <> 'voided' AND $1 <> 'declined' \
               THEN status \
             ELSE $1 \
           END, \
           signed_at = CASE \
             WHEN $1 = 'completed' THEN COALESCE(signed_at, now()) \
             ELSE signed_at \
           END, \
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, \
           updated_at = now() \
         WHERE pandadoc_document_id = $3 \
         RETURNING id::text, subscriber_id, status",
    )
    .bind(new_status)
    .bind(&patch)
    .bind(pandadoc_document_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("update contract_documents: {e}"))?;

    if let Some((id, subscriber_id, status)) = updated {
        tracing::info!(
            delivery_id,
            event_name,
            contract_document_id = %id,
            subscriber_id = ?subscriber_id,
            status = %status,
            pandadoc_document_id,
            "pandadoc webhook: contract_documents atualizado"
        );

        if status == "completed" {
            if let Some(sub) = subscriber_id.as_deref().filter(|s| !s.is_empty()) {
                ensure_acceptance(state, sub, &id).await?;
            }
        }
        return Ok(());
    }

    // Sem via prévia: tenta amarrar por metadata.subscriber_id (quando a sessão criar o doc).
    let subscriber_id = metadata
        .get("subscriber_id")
        .or_else(|| metadata.get("resolutoo_subscriber_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(sub) = subscriber_id {
        let exists: Option<(i64,)> = sqlx::query_as(
            "SELECT 1::bigint FROM contract_documents WHERE pandadoc_document_id = $1",
        )
        .bind(pandadoc_document_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("exists check: {e}"))?;
        if exists.is_some() {
            return Ok(());
        }

        let row: Option<(uuid::Uuid,)> = sqlx::query_as(
            "SELECT v.id FROM contract_template_versions v \
             JOIN contract_templates t ON t.id = v.template_id \
             WHERE t.kind = 'platform_subscription' AND t.active = true \
             ORDER BY v.version DESC LIMIT 1",
        )
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("lookup template version: {e}"))?;

        if let Some((version_id,)) = row {
            let id: (uuid::Uuid,) = sqlx::query_as(
                "INSERT INTO contract_documents ( \
                   template_version_id, kind, subscriber_id, signer_email, signer_name, \
                   status, pandadoc_document_id, signed_at, metadata \
                 ) VALUES ($1, 'platform_subscription', $2, $3, $4, $5, $6, \
                   CASE WHEN $5 = 'completed' THEN now() ELSE NULL END, $7) \
                 RETURNING id",
            )
            .bind(version_id)
            .bind(&sub)
            .bind(first_recipient_email(data))
            .bind(first_recipient_name(data))
            .bind(new_status)
            .bind(pandadoc_document_id)
            .bind(&patch)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| format!("insert contract_documents: {e}"))?;

            tracing::info!(
                delivery_id,
                event_name,
                contract_document_id = %id.0,
                subscriber_id = %sub,
                status = new_status,
                pandadoc_document_id,
                "pandadoc webhook: contract_documents inserido via metadata.subscriber_id"
            );
            if new_status == "completed" {
                ensure_acceptance(state, &sub, &id.0.to_string()).await?;
            }
            return Ok(());
        }
    }

    tracing::info!(
        delivery_id,
        event_name,
        pandadoc_document_id,
        status = new_status,
        "pandadoc webhook: nenhum contract_documents com esse pandadoc_document_id (e sem metadata.subscriber_id) — só log"
    );
    Ok(())
}

async fn ensure_acceptance(state: &AppState, subscriber_id: &str, document_id: &str) -> Result<(), String> {
    // Idempotente: não duplica se já houver aceite pandadoc pra este document_id.
    let existing: Option<(i64,)> = sqlx::query_as(
        "SELECT 1::bigint FROM contract_acceptances \
         WHERE document_id = $1::uuid AND channel LIKE 'pandadoc%' LIMIT 1",
    )
    .bind(document_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("acceptance check: {e}"))?;
    if existing.is_some() {
        return Ok(());
    }

    let version_id: Option<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT template_version_id FROM contract_documents WHERE id = $1::uuid",
    )
    .bind(document_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| format!("acceptance version: {e}"))?;

    sqlx::query(
        "INSERT INTO contract_acceptances \
         (kind, template_version_id, document_id, subscriber_id, acceptor_role, accepted, channel) \
         VALUES ('platform_subscription', $1, $2::uuid, $3, 'lojista', true, 'pandadoc_webhook')",
    )
    .bind(version_id.map(|v| v.0))
    .bind(document_id)
    .bind(subscriber_id)
    .execute(&state.pool)
    .await
    .map_err(|e| format!("insert acceptance: {e}"))?;

    tracing::info!(
        subscriber_id,
        document_id,
        "pandadoc webhook: contract_acceptance registrado (pandadoc_webhook)"
    );
    Ok(())
}

fn first_recipient_email(data: &Value) -> Option<String> {
    data.get("recipients")
        .and_then(|r| r.as_array())
        .and_then(|arr| arr.first())
        .and_then(|r| r.get("email"))
        .and_then(|e| e.as_str())
        .map(|s| s.to_string())
}

fn first_recipient_name(data: &Value) -> Option<String> {
    let r = data
        .get("recipients")
        .and_then(|r| r.as_array())
        .and_then(|arr| arr.first())?;
    let first = r.get("first_name").and_then(|v| v.as_str()).unwrap_or("");
    let last = r.get("last_name").and_then(|v| v.as_str()).unwrap_or("");
    let name = format!("{first} {last}").trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}
