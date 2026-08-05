//! Mercado Pago Payments API (store Pix) — charge + full refund.
//!
//! Tenant access token comes from `tenants.plataforma_credenciais.token`
//! (synced from Resolutoo subscribers). Never logged.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::abacatepay::PixResult;
use crate::error::AppError;
use crate::state::AppState;

const BASE_URL: &str = "https://api.mercadopago.com";

#[derive(Debug, Deserialize)]
struct MpPaymentResponse {
    id: Option<serde_json::Value>,
    status: Option<String>,
    point_of_interaction: Option<MpPoi>,
}

#[derive(Debug, Deserialize)]
struct MpPoi {
    transaction_data: Option<MpTxData>,
}

#[derive(Debug, Deserialize)]
struct MpTxData {
    qr_code: Option<String>,
    qr_code_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpRefundResponse {
    id: Option<serde_json::Value>,
    status: Option<String>,
}

fn payment_id_string(v: &Option<serde_json::Value>) -> Option<String> {
    match v {
        Some(serde_json::Value::Number(n)) => Some(n.to_string()),
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// Mercado Pago validates `payer.first_name`/`last_name` as two separate
/// required fields (confirmed via MP's own official integration plugin
/// error strings — "Payer firstname required." / "Payer lastname
/// required.") — a bare single-word name like "Cliente balcão" (the PDV
/// walk-in default) still needs to produce a non-empty last_name.
fn split_payer_name(name: &str) -> (String, String) {
    let trimmed = name.trim();
    match trimmed.split_once(char::is_whitespace) {
        Some((first, rest)) if !rest.trim().is_empty() => {
            (first.chars().take(60).collect(), rest.trim().chars().take(60).collect())
        }
        _ => {
            let base = if trimmed.is_empty() { "Cliente" } else { trimmed };
            (base.chars().take(60).collect(), base.chars().take(60).collect())
        }
    }
}

/// Masked preview for logs — never the full secret (same idea as the
/// frontend's `maskMpAccessToken`). `len=0` in the log immediately tells
/// you the stored credential is empty, without needing the real value.
fn mask_token_for_log(token: &str) -> String {
    let len = token.chars().count();
    if len == 0 {
        return "<empty>".to_string();
    }
    let head: String = token.chars().take(8).collect();
    format!("{head}...(len={len})")
}

/// Mercado Pago access tokens are always `APP_USR-...` (production) or
/// `TEST-...` (sandbox), single-line, no surrounding quotes/whitespace.
/// Catching an obviously-malformed token HERE — instead of only finding
/// out from Mercado Pago's generic "authorization value not present" once
/// it's already too late to give the lojista a clear reason — turns a
/// silent/confusing failure into something actionable immediately.
fn validate_mp_token_shape(token: &str) -> Result<(), AppError> {
    if token.is_empty() {
        return Err(AppError::BadRequest(
            "Access Token do Mercado Pago está vazio no cadastro da loja — informe o token de novo em Meu plano → Financeiro.".to_string(),
        ));
    }
    if token.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'') {
        return Err(AppError::BadRequest(
            "Access Token do Mercado Pago cadastrado parece corrompido (tem espaço ou aspas) — copie o token de novo do painel do Mercado Pago e salve em Meu plano → Financeiro.".to_string(),
        ));
    }
    if !(token.starts_with("APP_USR-") || token.starts_with("TEST-")) {
        return Err(AppError::BadRequest(
            "Access Token do Mercado Pago cadastrado não parece válido (deveria começar com \"APP_USR-\" ou \"TEST-\") — confira e salve de novo em Meu plano → Financeiro.".to_string(),
        ));
    }
    // Tokens reais da Mercado Pago (produção ou teste) têm bem mais que 60
    // caracteres (prefixo + client id + client secret + sequência, ex.:
    // "APP_USR-1234567890123456-012345-<32 chars hex>-123456789"). Um
    // token bem mais curto que isso quase sempre é cópia incompleta (só
    // parte do valor foi colada) — confirmado em produção: um lojista com
    // token de 44 caracteres levava exatamente o "authorization value not
    // present" genérico da Mercado Pago, sem nenhuma pista de que a causa
    // era o próprio valor salvo estar cortado.
    if token.chars().count() < 60 {
        return Err(AppError::BadRequest(
            "Access Token do Mercado Pago cadastrado parece incompleto (curto demais pra um token real) — normalmente é cópia parcial do valor. Copie o token INTEIRO do painel do Mercado Pago (Suas integrações → sua aplicação → Credenciais de produção) e salve de novo em Meu plano → Financeiro.".to_string(),
        ));
    }
    Ok(())
}

/// Creates a Pix charge via `POST /v1/payments` with `payment_method_id=pix`.
pub async fn create_pix_charge(
    state: &AppState,
    access_token: &str,
    store_name: &str,
    total: f64,
    customer_name: &str,
    customer_email: Option<&str>,
    external_reference: &str,
) -> Result<PixResult, AppError> {
    validate_mp_token_shape(access_token)?;
    tracing::info!(
        "mercado pago create pix: token={} order={external_reference}",
        mask_token_for_log(access_token)
    );

    let email = customer_email
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("cliente@resolutoo.local");
    // Mercado Pago valida first_name/last_name como campos separados —
    // mandar só first_name (como antes) é rejeitado em produção.
    let (first_name, last_name) = split_payer_name(customer_name);

    let body = json!({
        "transaction_amount": (total * 100.0).round() / 100.0,
        "description": format!("Pedido {store_name}"),
        "payment_method_id": "pix",
        "external_reference": external_reference,
        "payer": {
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
        }
    });

    let resp = state
        .http
        .post(format!("{BASE_URL}/v1/payments"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago create pix failed: {status} {text}");
        return Err(AppError::BadRequest(friendly_mp_pix_error(&text)));
    }

    let parsed: MpPaymentResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago parse error: {e}")))?;

    let payment_id = payment_id_string(&parsed.id)
        .ok_or_else(|| AppError::Internal("mercado pago response missing payment id".to_string()))?;

    let tx = parsed
        .point_of_interaction
        .and_then(|p| p.transaction_data)
        .ok_or_else(|| AppError::Internal("mercado pago response missing pix qr".to_string()))?;

    let qr_code = tx
        .qr_code
        .ok_or_else(|| AppError::Internal("mercado pago response missing qr_code".to_string()))?;
    let raw_b64 = tx.qr_code_base64.unwrap_or_default();
    let qr_code_base64 = if raw_b64.is_empty() {
        String::new()
    } else if raw_b64.starts_with("data:") {
        raw_b64
    } else {
        format!("data:image/png;base64,{raw_b64}")
    };

    let _ = parsed.status; // pending until paid
    Ok(PixResult {
        payment_id,
        qr_code,
        qr_code_base64,
    })
}

#[derive(Debug, Deserialize)]
struct MpErrorCause {
    code: Option<serde_json::Value>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpErrorBody {
    message: Option<String>,
    cause: Option<Vec<MpErrorCause>>,
}

/// Turns a raw Mercado Pago error response into a message the lojista can
/// actually act on, instead of the generic "failed to create..." this
/// used to always return regardless of the real reason. Erro 13253 ("sem
/// chave Pix cadastrada") is the best-documented, most common cause of a
/// production access_token failing to create a Pix charge while the same
/// code works fine against a TEST- token — special-cased here because the
/// raw Mercado Pago message doesn't tell a non-technical lojista what to
/// actually go do about it.
fn friendly_mp_pix_error(body: &str) -> String {
    let Ok(parsed) = serde_json::from_str::<MpErrorBody>(body) else {
        return "Mercado Pago recusou a cobrança Pix — tente de novo em instantes.".to_string();
    };

    let code_13253 = parsed.cause.as_ref().is_some_and(|causes| {
        causes.iter().any(|c| match &c.code {
            Some(serde_json::Value::Number(n)) => n.as_i64() == Some(13253),
            Some(serde_json::Value::String(s)) => s == "13253",
            _ => false,
        })
    });
    if code_13253 {
        return "Sua conta Mercado Pago ainda não tem uma chave Pix cadastrada — entre no app ou site do Mercado Pago (com a MESMA conta do Access Token cadastrado aqui), vá em \"Suas chaves Pix\" e cadastre uma chave antes de gerar cobranças por QR Code.".to_string();
    }

    let cause_desc = parsed
        .cause
        .as_ref()
        .and_then(|causes| causes.first())
        .and_then(|c| c.description.clone());
    cause_desc
        .or(parsed.message)
        .unwrap_or_else(|| "Mercado Pago recusou a cobrança Pix — tente de novo em instantes.".to_string())
}

/// Full refund via `POST /v1/payments/{id}/refunds` (empty body = full amount).
/// Returns refund id string. Treats `approved` and `in_process` as success
/// (Pix Bacen contingency may return in_process).
pub async fn refund_payment(
    state: &AppState,
    access_token: &str,
    payment_id: &str,
) -> Result<String, AppError> {
    if payment_id.starts_with("mock-") {
        return Ok(format!("mock-refund-{payment_id}"));
    }

    let resp = state
        .http
        .post(format!("{BASE_URL}/v1/payments/{payment_id}/refunds"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .header("X-Render-In-Process-Refunds", "true")
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago refund request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago refund failed: {status} {text}");
        return Err(AppError::BadRequest(
            "Não foi possível estornar o Pix automaticamente — tente de novo ou estorne no painel Mercado Pago"
                .to_string(),
        ));
    }

    let parsed: MpRefundResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago refund parse error: {e}")))?;

    let refund_status = parsed.status.unwrap_or_default().to_ascii_lowercase();
    if !matches!(refund_status.as_str(), "approved" | "in_process" | "") {
        tracing::error!("mercado pago refund unexpected status: {refund_status}");
        return Err(AppError::BadRequest(
            "Não foi possível estornar o Pix automaticamente — tente de novo ou estorne no painel Mercado Pago"
                .to_string(),
        ));
    }

    Ok(payment_id_string(&parsed.id).unwrap_or_else(|| format!("refund-{payment_id}")))
}

/// Poll payment status (`approved` → paid).
pub async fn get_payment_status(
    state: &AppState,
    access_token: &str,
    payment_id: &str,
) -> Result<String, AppError> {
    if payment_id.starts_with("mock-") {
        return Ok("pending".to_string());
    }

    let resp = state
        .http
        .get(format!("{BASE_URL}/v1/payments/{payment_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago get payment failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago get payment failed: {status} {text}");
        return Err(AppError::Internal("failed to fetch mercado pago payment status".to_string()));
    }

    let parsed: MpPaymentResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago parse error: {e}")))?;
    Ok(parsed.status.unwrap_or_else(|| "pending".to_string()))
}
