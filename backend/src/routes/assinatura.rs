use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::error::AppError;
use crate::gateway::{self, BillingCycle, PaymentMethod};
use crate::state::AppState;

fn valid_plan(code: &str) -> bool {
    matches!(code, "essential" | "management" | "premium")
}

fn plan_monthly_price(code: &str, default_price: f64) -> f64 {
    match code {
        "essential" => 60.0,
        "management" => 250.0,
        "premium" => 350.0,
        _ => default_price,
    }
}

#[derive(Debug, Deserialize)]
pub struct AssinarPlanoInput {
    pub plano: String,
    #[serde(default = "default_method")]
    pub metodo: PaymentMethod,
    /// mensal (default) | semestral (6 meses com 5% de desconto).
    #[serde(default = "default_cycle")]
    pub ciclo: String,
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
}

/// Atrela um plano à conta já existente e dispara a cobrança recorrente.
/// Permite retry quando status é `pendente` / `cancelado` / `sem_assinatura`
/// (bloqueia só `ativo` e `pausado`).
pub async fn assinar_plano(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<AssinarPlanoInput>,
) -> Result<Json<AssinaturaCriada>, AppError> {
    if !valid_plan(&body.plano) {
        return Err(AppError::BadRequest("plano inválido".to_string()));
    }
    let cycle = BillingCycle::parse(&body.ciclo)
        .ok_or_else(|| AppError::BadRequest("ciclo inválido — use mensal ou semestral".to_string()))?;

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

    let monthly = plan_monthly_price(&body.plano, state.valor_padrao);
    let valor = gateway::charge_amount(monthly, cycle);
    let gateway_kind = gateway::resolve_gateway_kind(&state);
    let reason = format!(
        "Assinatura Rodoletas ({}/{}) — {}",
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

    sqlx::query(
        "UPDATE subscribers SET plan_code = $1, gateway = $2, valor_mensal = $3, billing_cycle = $4, status = 'pendente', \
         onboarding_status = 'aguardando_pagamento', mp_preapproval_id = $5, updated_at = now() WHERE id = $6",
    )
    .bind(&body.plano)
    .bind(gateway_kind)
    .bind(monthly)
    .bind(cycle.as_str())
    .bind(&charge.external_id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(AssinaturaCriada {
        id: claims.sub,
        checkout_url: charge.checkout_url,
        pix_qr_code: charge.pix_qr_code,
        pix_qr_base64: charge.pix_qr_base64,
        sandbox: charge.sandbox,
    }))
}

#[derive(Debug, Serialize)]
pub struct StatusAssinatura {
    pub status: String,
    pub onboarding_status: String,
    pub sandbox: bool,
}

/// O front chama isso em polling depois de redirecionar o lojista pro
/// checkout — quando o gateway confirma o pagamento, o status muda de
/// "pendente" pra "ativo".
pub async fn status_assinatura(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StatusAssinatura>, AppError> {
    let sandbox = gateway::sandbox_mode(&state);
    let row: Option<(Option<String>, String, Option<String>, String)> =
        sqlx::query_as("SELECT mp_preapproval_id, status, gateway, onboarding_status FROM subscribers WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status) =
        row.ok_or_else(|| AppError::NotFound("assinatura não encontrada".to_string()))?;

    let (Some(preapproval_id), Some(gateway_kind)) = (preapproval_id, gateway_kind) else {
        return Ok(Json(StatusAssinatura {
            status: status_atual,
            onboarding_status,
            sandbox,
        }));
    };

    let gw_status = gateway::get_status(&state, &gateway_kind, &preapproval_id).await?;
    let novo_status = match gw_status.as_str() {
        "authorized" | "PAID" | "ACTIVE" | "active" | "paid" | "COMPLETED" | "completed" => "ativo",
        "paused" | "PAUSED" => "pausado",
        "cancelled" | "CANCELLED" | "canceled" => "cancelado",
        _ => "pendente",
    };

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
    }

    Ok(Json(StatusAssinatura {
        status: novo_status.to_string(),
        onboarding_status: novo_onboarding.to_string(),
        sandbox,
    }))
}

/// Homologação: marca a assinatura como paga sem cobrança real.
/// Só funciona com chave `abc_dev_` / mock.
pub async fn simular_pagamento(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<StatusAssinatura>, AppError> {
    if !gateway::sandbox_mode(&state) {
        return Err(AppError::BadRequest(
            "simulação só disponível em homologação (chave abc_dev_)".to_string(),
        ));
    }

    let row: Option<(Option<String>, String, Option<String>, String)> =
        sqlx::query_as("SELECT mp_preapproval_id, status, gateway, onboarding_status FROM subscribers WHERE id = $1")
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status) =
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

    Ok(Json(StatusAssinatura {
        status: "ativo".to_string(),
        onboarding_status: novo_onboarding.to_string(),
        sandbox: true,
    }))
}
