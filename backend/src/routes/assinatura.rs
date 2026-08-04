use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::coupons;
use crate::error::AppError;
use crate::gateway::{self, BillingCycle, PaymentMethod};
use crate::mercadopago;
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
    /// Always null for platform Assinar — payment is on-site (no MP redirect).
    pub checkout_url: Option<String>,
    pub pix_qr_code: Option<String>,
    pub pix_qr_base64: Option<String>,
    /// Homologação — front pode oferecer "Simular pagamento".
    pub sandbox: bool,
    pub valor_mensal: f64,
    pub valor_cobrado: f64,
    /// `pix` | `card` | `done`
    pub payment_step: String,
}

/// Atrela um plano à conta já existente e dispara cobrança **on-site**
/// (Pix QR ou passo cartão). Nunca redireciona pra mercadopago.com.br.
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

    let row: Option<(
        String,
        String,
        String,
        Option<f64>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT loja_nome, email, status, valor_mensal, mp_preapproval_id, gateway, \
         onboarding_status, tenant_id, plan_code, slug, documento FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (
        loja_nome,
        email,
        status,
        existing_monthly,
        prev_ext_id,
        prev_gateway,
        onboarding_status,
        tenant_id,
        old_plan,
        slug,
        documento,
    ) = row.ok_or_else(|| AppError::NotFound("conta não encontrada — finalize o cadastro primeiro".to_string()))?;
    if matches!(status.as_str(), "ativo" | "pausado") {
        return Err(AppError::BadRequest("essa conta já tem uma assinatura ativa".to_string()));
    }

    // Reuse pending subscription when switching Pix ↔ cartão (same plan pricing).
    let reuse_pending = status == "pendente" && existing_monthly.is_some();

    let cupom_code = body
        .cupom
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_uppercase());

    let monthly = if reuse_pending {
        existing_monthly.unwrap_or(list_monthly)
    } else if let Some(ref code) = cupom_code {
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

    // Drop previous pending charge when switching payment method (best-effort).
    if reuse_pending {
        if let (Some(ext_id), Some(gw)) = (prev_ext_id.as_ref(), prev_gateway.as_ref()) {
            gateway::cancel(&state, gw, ext_id).await;
        }
    }

    let mut charge = gateway::create_subscription(
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
    // Hard guarantee: never hand a hosted-checkout URL to the front.
    charge.checkout_url = None;

    // Pix must always include copia-e-cola (or base64). Never leave the FE on "Gerando QR".
    // Never coerce a Pix request into the card step.
    if matches!(body.metodo, PaymentMethod::Pix) {
        let qr_empty = charge.pix_qr_code.as_deref().unwrap_or("").is_empty()
            && charge.pix_qr_base64.as_deref().unwrap_or("").is_empty();
        if charge.payment_step != "pix" || qr_empty {
            return Err(AppError::BadRequest(
                "não foi possível gerar o QR Pix — tente novamente".to_string(),
            ));
        }
    } else if charge.payment_step == "pix"
        && charge.pix_qr_code.as_deref().unwrap_or("").is_empty()
        && charge.pix_qr_base64.as_deref().unwrap_or("").is_empty()
    {
        return Err(AppError::BadRequest(
            "cobrança Pix criada sem QR — tente novamente ou use cartão".to_string(),
        ));
    }

    // Always pendente until Pix paid / card charged / simular — so Assinar can
    // render on-site payment UI (never auto-activate on create).
    // NEVER wipe store/onboarding data on re-subscribe: only flip status + plan.
    let status = "pendente";
    let has_store = tenant_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some()
        || slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_some()
        || documento
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_some()
        || onboarding_status == "provisionado";
    let onboarding = onboarding_for_resubscribe(
        &onboarding_status,
        has_store,
        old_plan.as_deref(),
        &body.plano,
    );

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

    Ok(Json(AssinaturaCriada {
        id: claims.sub,
        checkout_url: None,
        pix_qr_code: charge.pix_qr_code,
        pix_qr_base64: charge.pix_qr_base64,
        sandbox: charge.sandbox || gateway::sandbox_mode(&state),
        valor_mensal: monthly,
        valor_cobrado: valor,
        payment_step: charge.payment_step,
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
    let row: Option<(Option<String>, String, Option<String>, String, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT mp_preapproval_id, status, gateway, onboarding_status, slug, plan_code \
             FROM subscribers WHERE id = $1",
        )
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status, slug, plan_code) =
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

    // Only promote aguardando_pagamento → onboarding when this is a brand-new store.
    // If slug/tenant already exists, restore provisionado (same-plan re-subscribe recovery).
    let has_store = slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    let novo_onboarding = if novo_status == "ativo"
        && (onboarding_status == "aguardando_pagamento" || onboarding_status.is_empty())
    {
        if has_store {
            "provisionado"
        } else {
            "aguardando_onboarding"
        }
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
                if let Err(e) = crate::routes::onboarding::sync_ecommerce_tenant_status_with_plan(
                    &state,
                    slug,
                    novo_status,
                    plan_code.as_deref(),
                )
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

    let row: Option<(Option<String>, String, Option<String>, String, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT mp_preapproval_id, status, gateway, onboarding_status, slug, plan_code \
             FROM subscribers WHERE id = $1",
        )
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status, slug, plan_code) =
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

    let novo_onboarding = if onboarding_status == "aguardando_pagamento" || onboarding_status.is_empty()
    {
        let has_store = slug
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_some();
        if has_store {
            "provisionado"
        } else {
            "aguardando_onboarding"
        }
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
        if let Err(e) = crate::routes::onboarding::sync_ecommerce_tenant_status_with_plan(
            &state,
            slug,
            "ativo",
            plan_code.as_deref(),
        )
        .await
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

    // Preserve provisionado / tenant data — only abandon the pending charge.
    sqlx::query(
        "UPDATE subscribers SET status = 'sem_assinatura', \
         onboarding_status = CASE \
           WHEN tenant_id IS NOT NULL AND NULLIF(trim(tenant_id), '') IS NOT NULL THEN 'provisionado' \
           WHEN onboarding_status = 'provisionado' THEN 'provisionado' \
           ELSE 'aguardando_pagamento' \
         END, \
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

/// Decide onboarding_status when starting (re)subscribe payment.
/// Absolute rule: never downgrade a provisioned store back to full onboarding
/// unless this is a plan **upgrade** that needs complementary fields.
/// `has_store` = tenant_id OR slug OR documento OR already provisionado.
pub(crate) fn onboarding_for_resubscribe(
    current_onboarding: &str,
    has_store: bool,
    old_plan: Option<&str>,
    new_plan: &str,
) -> &'static str {
    let store_ready = has_store || current_onboarding == "provisionado";
    if !store_ready {
        return "aguardando_pagamento";
    }
    let upgrading = old_plan
        .map(|o| plans::is_upgrade(o, new_plan))
        .unwrap_or(false);
    if upgrading {
        // Complementary onboarding after pay (FE prefills; no wipe / re-provision).
        "aguardando_onboarding"
    } else {
        // Same plan (or downgrade): skip onboarding entirely after pay.
        "provisionado"
    }
}

#[cfg(test)]
mod tests {
    use super::onboarding_for_resubscribe;

    #[test]
    fn new_subscriber_awaits_payment() {
        assert_eq!(
            onboarding_for_resubscribe("aguardando_pagamento", false, None, "essential"),
            "aguardando_pagamento"
        );
    }

    #[test]
    fn same_plan_resubscribe_keeps_provisionado() {
        assert_eq!(
            onboarding_for_resubscribe("provisionado", true, Some("essential"), "essential"),
            "provisionado"
        );
    }

    #[test]
    fn upgrade_resubscribe_needs_complementary() {
        assert_eq!(
            onboarding_for_resubscribe("provisionado", true, Some("essential"), "management"),
            "aguardando_onboarding"
        );
        assert_eq!(
            onboarding_for_resubscribe("provisionado", true, Some("essential"), "premium"),
            "aguardando_onboarding"
        );
    }

    #[test]
    fn downgrade_resubscribe_skips_onboarding() {
        assert_eq!(
            onboarding_for_resubscribe("provisionado", true, Some("premium"), "essential"),
            "provisionado"
        );
    }

    #[test]
    fn tenant_id_alone_counts_as_store_ready() {
        assert_eq!(
            onboarding_for_resubscribe("aguardando_pagamento", true, Some("essential"), "essential"),
            "provisionado"
        );
    }
}

#[derive(Debug, Deserialize)]
pub struct PagarCartaoInput {
    pub card_number: String,
    pub card_holder: String,
    pub exp_month: String,
    pub exp_year: String,
    pub cvv: String,
    /// Aceitar cobrança recorrente em débito automático — opcional, default false.
    #[serde(default)]
    pub auto_debit: bool,
    pub card_token: Option<String>,
}

/// Cobra cartão **on-site** (sem redirect MP) e ativa a assinatura.
pub async fn pagar_cartao(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<PagarCartaoInput>,
) -> Result<Json<StatusAssinatura>, AppError> {
    let row: Option<(
        String,
        String,
        Option<String>,
        f64,
        String,
        Option<String>,
        String,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT email, status, gateway, COALESCE(valor_mensal, 0), billing_cycle, plan_code, \
         onboarding_status, slug FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let (email, status, gateway_kind, valor_mensal, billing_cycle, plan_code, onboarding_status, slug) =
        row.ok_or_else(|| AppError::NotFound("conta não encontrada".to_string()))?;

    if status != "pendente" {
        return Err(AppError::BadRequest(format!(
            "pagamento com cartão só com assinatura pendente (atual: {status})"
        )));
    }

    let cycle = BillingCycle::parse(&billing_cycle).unwrap_or(BillingCycle::Mensal);
    let amount = gateway::charge_amount(valor_mensal, cycle);
    let plan = plan_code.unwrap_or_else(|| "essential".to_string());
    let reason = format!("Assinatura Resolutoo ({}/{})", plan, cycle.as_str());

    let payment_id = mercadopago::pay_onsite_card(
        &state,
        email.trim(),
        amount,
        &claims.sub,
        &reason,
        &body.card_number,
        &body.card_holder,
        &body.exp_month,
        &body.exp_year,
        &body.cvv,
        body.card_token.as_deref(),
        body.auto_debit,
    )
    .await?;

    let gw = gateway_kind.unwrap_or_else(|| "mercadopago".to_string());
    let has_store = slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    let novo_onboarding = if onboarding_status == "aguardando_pagamento" || onboarding_status.is_empty()
    {
        if has_store {
            "provisionado"
        } else {
            "aguardando_onboarding"
        }
    } else {
        onboarding_status.as_str()
    };

    sqlx::query(
        "UPDATE subscribers SET status = 'ativo', onboarding_status = $1, mp_preapproval_id = $2, \
         gateway = $3, updated_at = now() WHERE id = $4",
    )
    .bind(novo_onboarding)
    .bind(&payment_id)
    .bind(&gw)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(e) = crate::routes::onboarding::sync_ecommerce_tenant_status_with_plan(
            &state,
            slug,
            "ativo",
            Some(plan.as_str()),
        )
        .await
        {
            tracing::warn!("sync ecommerce after card pay failed: {e:?}");
        }
    }

    Ok(Json(StatusAssinatura {
        status: "ativo".to_string(),
        onboarding_status: novo_onboarding.to_string(),
        sandbox: gateway::sandbox_mode(&state),
    }))
}
