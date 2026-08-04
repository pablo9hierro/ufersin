use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::coupons;
use crate::error::AppError;
use crate::gateway::{self, BillingCycle, PaymentMethod};
use crate::plans;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct AssinarPlanoInput {
    pub plano: String,
    #[serde(default = "default_method")]
    pub metodo: PaymentMethod,
    /// mensal (default) | semestral (6 meses com 5% de desconto).
    #[serde(default = "default_cycle")]
    pub ciclo: String,
    /// Cupom opcional — validado e aplicado só no servidor.
    pub cupom: Option<String>,
    /// Ignorado de propósito se o cliente mandar (anti-tamper).
    #[serde(default)]
    pub valor: Option<f64>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub price: Option<f64>,
}
fn default_method() -> PaymentMethod {
    PaymentMethod::Cartao
}
fn default_cycle() -> String {
    "mensal".to_string()
}

#[derive(Debug, Serialize)]
pub struct AssinaturaCriada {
    pub id: String,
    pub checkout_url: Option<String>,
    pub pix_qr_code: Option<String>,
    pub pix_qr_base64: Option<String>,
    /// Homologação AbacatePay (`abc_dev_`) — front pode oferecer "Simular pagamento".
    pub sandbox: bool,
    pub valor_mensal: f64,
    pub valor_cobrado: f64,
}

/// Atrela um plano à conta já existente e dispara a cobrança recorrente.
/// Preço vem exclusivamente de `platform_plans` (+ cupom server-side).
pub async fn assinar_plano(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<AssinarPlanoInput>,
) -> Result<Json<AssinaturaCriada>, AppError> {
    // Qualquer valor enviado pelo cliente é descartado.
    let _ignored = (body.valor, body.amount, body.price);

    let cycle = BillingCycle::parse(&body.ciclo)
        .ok_or_else(|| AppError::BadRequest("ciclo inválido — use mensal ou semestral".to_string()))?;

    let list_monthly = plans::monthly_price(&state.pool, &body.plano).await?;

    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT loja_nome, email, status FROM subscribers WHERE id = $1")
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    let (loja_nome, email, status) =
        row.ok_or_else(|| AppError::NotFound("conta não encontrada — finalize o cadastro primeiro".to_string()))?;
    if matches!(status.as_str(), "ativo" | "pausado") {
        return Err(AppError::BadRequest("essa conta já tem uma assinatura ativa".to_string()));
    }

    let monthly = if let Some(code) = body.cupom.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let (after, _) = coupons::redeem_on_subscribe(&state.pool, &claims.sub, &body.plano, code).await?;
        after
    } else {
        list_monthly
    };

    let valor = gateway::charge_amount(monthly, cycle);
    let gateway_kind = gateway::resolve_gateway_kind(&state);
    let reason = format!(
        "Assinatura Resolutoo ({}/{}) — {}",
        body.plano,
        cycle.as_str(),
        loja_nome.trim()
    );
    let charge = gateway::create_subscription(
        &state,
        gateway_kind,
        &reason,
        email.trim(),
        &body.plano,
        valor,
        cycle,
        &claims.sub,
        body.metodo,
    )
    .await?;

    let (status, onboarding) = if charge.sandbox && charge.external_id.starts_with("mock-") {
        ("ativo", "aguardando_onboarding")
    } else {
        ("pendente", "aguardando_pagamento")
    };

    sqlx::query(
        "UPDATE subscribers SET plan_code = $1, gateway = $2, valor_mensal = $3, billing_cycle = $4, status = $5, \
         onboarding_status = $6, mp_preapproval_id = $7, updated_at = now() WHERE id = $8",
    )
    .bind(&body.plano)
    .bind(gateway_kind)
    .bind(monthly)
    .bind(cycle.as_str())
    .bind(status)
    .bind(onboarding)
    .bind(&charge.external_id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    if status == "ativo" {
        let slug: Option<(Option<String>,)> =
            sqlx::query_as("SELECT slug FROM subscribers WHERE id = $1")
                .bind(&claims.sub)
                .fetch_optional(&state.pool)
                .await?;
        if let Some((Some(slug),)) = slug {
            let slug = slug.trim();
            if !slug.is_empty() {
                if let Err(e) =
                    crate::routes::onboarding::sync_ecommerce_tenant_status(&state, slug, "ativo").await
                {
                    tracing::warn!("sync ecommerce tenant online after subscribe failed: {e:?}");
                }
            }
        }
    }

    Ok(Json(AssinaturaCriada {
        id: claims.sub,
        checkout_url: charge.checkout_url,
        pix_qr_code: charge.pix_qr_code,
        pix_qr_base64: charge.pix_qr_base64,
        sandbox: charge.sandbox,
        valor_mensal: monthly,
        valor_cobrado: valor,
    }))
}

#[derive(Debug, Serialize)]
pub struct StatusAssinatura {
    pub status: String,
    pub onboarding_status: String,
    pub sandbox: bool,
}

pub async fn status_assinatura(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StatusAssinatura>, AppError> {
    let sandbox = gateway::sandbox_mode(&state);
    let row: Option<(Option<String>, String, Option<String>, String, Option<String>)> =
        sqlx::query_as(
            "SELECT mp_preapproval_id, status, gateway, onboarding_status, slug FROM subscribers WHERE id = $1",
        )
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status, slug) =
        row.ok_or_else(|| AppError::NotFound("assinatura não encontrada".to_string()))?;

    let (Some(preapproval_id), Some(gateway_kind)) = (preapproval_id, gateway_kind) else {
        return Ok(Json(StatusAssinatura {
            status: status_atual,
            onboarding_status,
            sandbox,
        }));
    };

    let gw_status = gateway::get_status(&state, &gateway_kind, &preapproval_id).await?;
    let mut novo_status = match gw_status.as_str() {
        "authorized" | "PAID" | "ACTIVE" | "active" | "paid" | "COMPLETED" | "completed" => "ativo",
        "paused" | "PAUSED" => "pausado",
        "cancelled" | "CANCELLED" | "canceled" => "cancelado",
        _ => "pendente",
    };

    if status_atual == "ativo" && novo_status == "pendente" {
        novo_status = "ativo";
    }

    let novo_onboarding = if novo_status == "ativo" && onboarding_status == "aguardando_pagamento" {
        "aguardando_onboarding"
    } else {
        onboarding_status.as_str()
    };

    if novo_status != status_atual || novo_onboarding != onboarding_status {
        sqlx::query("UPDATE subscribers SET status = $1, onboarding_status = $2, updated_at = now() WHERE id = $3")
            .bind(novo_status)
            .bind(novo_onboarding)
            .bind(&id)
            .execute(&state.pool)
            .await?;

        if novo_status != status_atual {
            if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if let Err(e) =
                    crate::routes::onboarding::sync_ecommerce_tenant_status(&state, slug, novo_status)
                        .await
                {
                    tracing::warn!("sync ecommerce tenant status after poll failed: {e:?}");
                }
            }
        }
    }

    Ok(Json(StatusAssinatura {
        status: novo_status.to_string(),
        onboarding_status: novo_onboarding.to_string(),
        sandbox,
    }))
}

pub async fn simular_pagamento(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<StatusAssinatura>, AppError> {
    if !gateway::sandbox_mode(&state) {
        return Err(AppError::BadRequest(
            "simulação só disponível em homologação (MP TEST-… / Abacate abc_dev_ / mock)".to_string(),
        ));
    }

    let row: Option<(Option<String>, String, Option<String>, String, Option<String>)> =
        sqlx::query_as(
            "SELECT mp_preapproval_id, status, gateway, onboarding_status, slug FROM subscribers WHERE id = $1",
        )
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status, slug) =
        row.ok_or_else(|| AppError::NotFound("assinatura não encontrada".to_string()))?;

    if status_atual == "ativo" {
        return Ok(Json(StatusAssinatura {
            status: "ativo".to_string(),
            onboarding_status,
            sandbox: true,
        }));
    }
    if !matches!(status_atual.as_str(), "pendente" | "sem_assinatura" | "cancelado") {
        return Err(AppError::BadRequest(format!(
            "não é possível simular pagamento com status '{status_atual}'"
        )));
    }

    if let (Some(ext_id), Some(gw)) = (preapproval_id.as_ref(), gateway_kind.as_ref()) {
        let _ = gateway::simulate_payment(&state, gw, ext_id).await;
    }

    let novo_onboarding = if onboarding_status == "aguardando_pagamento" || onboarding_status.is_empty() {
        "aguardando_onboarding"
    } else {
        onboarding_status.as_str()
    };

    sqlx::query(
        "UPDATE subscribers SET status = 'ativo', onboarding_status = $1, updated_at = now() WHERE id = $2",
    )
    .bind(novo_onboarding)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(e) = crate::routes::onboarding::sync_ecommerce_tenant_status(&state, slug, "ativo").await
        {
            tracing::warn!("sync ecommerce tenant online after simulate failed: {e:?}");
        }
    }

    Ok(Json(StatusAssinatura {
        status: "ativo".to_string(),
        onboarding_status: novo_onboarding.to_string(),
        sandbox: true,
    }))
}

#[derive(Debug, Serialize)]
pub struct CancelarPendenteResult {
    pub status: String,
}

/// Abandona tentativa de pagamento (`pendente`) — cancela no gateway (best-effort)
/// e volta a conta pra `sem_assinatura` pra o lojista poder escolher outro plano.
pub async fn cancelar_pendente(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<CancelarPendenteResult>, AppError> {
    let row: Option<(Option<String>, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT mp_preapproval_id, status, gateway, slug FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (preapproval_id, status, gateway_kind, slug) =
        row.ok_or_else(|| AppError::NotFound("conta não encontrada".to_string()))?;

    if status != "pendente" {
        return Err(AppError::BadRequest(format!(
            "só é possível cancelar tentativa com status pendente (atual: {status})"
        )));
    }

    if let (Some(ext_id), Some(gw)) = (preapproval_id.as_ref(), gateway_kind.as_ref()) {
        gateway::cancel(&state, gw, ext_id).await;
    }

    sqlx::query(
        "UPDATE subscribers SET status = 'sem_assinatura', onboarding_status = 'aguardando_pagamento', \
         mp_preapproval_id = NULL, updated_at = now() WHERE id = $1",
    )
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(e) =
            crate::routes::onboarding::sync_ecommerce_tenant_status(&state, slug, "sem_assinatura").await
        {
            tracing::warn!("sync ecommerce tenant after cancel-pending failed: {e:?}");
        }
    }

    Ok(Json(CancelarPendenteResult {
        status: "sem_assinatura".to_string(),
    }))
}
