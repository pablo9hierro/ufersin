use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::{generate_code, hash_password, make_token};
use crate::error::AppError;
use crate::gateway::{self, PaymentMethod};
use crate::state::AppState;

fn valid_plan(code: &str) -> bool {
    matches!(code, "essential" | "management" | "premium")
}

fn plan_price(code: &str, default_price: f64) -> f64 {
    match code {
        "essential" => 60.0,
        "management" => 250.0,
        "premium" => 350.0,
        _ => default_price,
    }
}

#[derive(Debug, Deserialize)]
pub struct NovaAssinatura {
    pub loja_nome: String,
    pub responsavel_nome: String,
    pub whatsapp: String,
    pub email: String,
    pub senha: String,
    #[serde(default = "default_plan")]
    pub plano: String,
    #[serde(default = "default_method")]
    pub metodo: PaymentMethod,
}
fn default_plan() -> String {
    "essential".to_string()
}
fn default_method() -> PaymentMethod {
    PaymentMethod::Cartao
}

#[derive(Debug, Serialize)]
pub struct AssinaturaCriada {
    pub id: String,
    pub token: String,
    pub checkout_url: Option<String>,
    pub pix_qr_code: Option<String>,
    pub pix_qr_base64: Option<String>,
}

/// Cria a conta do lojista (cadastro) + a assinatura recorrente no gateway
/// escolhido, e devolve tanto o link de checkout hospedado (cartão) quanto
/// o QR Pix (quando aplicável) pra o front decidir o que mostrar. Emite
/// token na hora — o lojista já fica "logado" mesmo antes de confirmar
/// e-mail/pagamento, pra não travar o fluxo Landing -> Checkout ->
/// Onboarding atrás de um login separado.
pub async fn criar_assinatura(
    State(state): State<AppState>,
    Json(body): Json<NovaAssinatura>,
) -> Result<Json<AssinaturaCriada>, AppError> {
    if body.loja_nome.trim().is_empty() || body.responsavel_nome.trim().is_empty() {
        return Err(AppError::BadRequest("nome da loja e do responsável são obrigatórios".to_string()));
    }
    if !body.email.contains('@') {
        return Err(AppError::BadRequest("e-mail inválido".to_string()));
    }
    if body.senha.len() < 8 {
        return Err(AppError::BadRequest("a senha precisa ter pelo menos 8 caracteres".to_string()));
    }
    let plano = if valid_plan(&body.plano) { body.plano.as_str() } else { "essential" };

    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM subscribers WHERE lower(email) = lower($1)")
        .bind(body.email.trim())
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Err(AppError::BadRequest("já existe uma conta com esse e-mail — faça login".to_string()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let password_hash = hash_password(&body.senha)?;
    let valor = plan_price(plano, state.valor_padrao);
    let verification_code = generate_code();
    let gateway_kind = gateway::resolve_gateway_kind(&state);

    sqlx::query(
        "INSERT INTO subscribers
            (id, loja_nome, responsavel_nome, whatsapp, email, password_hash, plan_code, gateway,
             valor_mensal, status, verification_code, verification_expires_at, onboarding_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', $10, now() + interval '30 minutes', 'aguardando_pagamento')",
    )
    .bind(&id)
    .bind(body.loja_nome.trim())
    .bind(body.responsavel_nome.trim())
    .bind(body.whatsapp.trim())
    .bind(body.email.trim())
    .bind(&password_hash)
    .bind(plano)
    .bind(gateway_kind)
    .bind(valor)
    .bind(&verification_code)
    .execute(&state.pool)
    .await?;

    // TODO Fase 3: sem provedor de e-mail/SMS configurado ainda — o código
    // só é logado por enquanto (mesmo mock já usado em outras partes desta
    // base de código pra Pix/WhatsApp sem credencial configurada).
    tracing::info!("[verificação de e-mail — MOCK] {}: código {}", body.email.trim(), verification_code);

    let reason = format!("Assinatura Rodoletas ({plano}) — {}", body.loja_nome.trim());
    let charge = gateway::create_subscription(&state, gateway_kind, &reason, body.email.trim(), valor, &id, body.metodo).await?;

    sqlx::query("UPDATE subscribers SET mp_preapproval_id = $1, updated_at = now() WHERE id = $2")
        .bind(&charge.external_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let token = make_token(&state.jwt_secret, &id, body.email.trim());
    Ok(Json(AssinaturaCriada {
        id,
        token,
        checkout_url: charge.checkout_url,
        pix_qr_code: charge.pix_qr_code,
        pix_qr_base64: charge.pix_qr_base64,
    }))
}

#[derive(Debug, Serialize)]
pub struct StatusAssinatura {
    pub status: String,
    pub onboarding_status: String,
}

/// O front chama isso em polling depois de redirecionar o lojista pro
/// checkout — quando o gateway confirma o pagamento, o status muda de
/// "pendente" pra "ativo" (consultado ao vivo na API do gateway, não fica
/// esperando webhook).
pub async fn status_assinatura(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StatusAssinatura>, AppError> {
    let row: Option<(Option<String>, String, String, String)> =
        sqlx::query_as("SELECT mp_preapproval_id, status, gateway, onboarding_status FROM subscribers WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual, gateway_kind, onboarding_status) =
        row.ok_or_else(|| AppError::NotFound("assinatura não encontrada".to_string()))?;

    let Some(preapproval_id) = preapproval_id else {
        return Ok(Json(StatusAssinatura { status: status_atual, onboarding_status }));
    };

    let gw_status = gateway::get_status(&state, &gateway_kind, &preapproval_id).await?;
    let novo_status = match gw_status.as_str() {
        "authorized" | "PAID" => "ativo",
        "paused" => "pausado",
        "cancelled" => "cancelado",
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

    Ok(Json(StatusAssinatura { status: novo_status.to_string(), onboarding_status: novo_onboarding.to_string() }))
}
