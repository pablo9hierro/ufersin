use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::Value;

use crate::abacatepay_gateway;
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
