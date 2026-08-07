//! Mercado Pago — link de pagamento (Checkout Pro) e cartão tokenizado
//! (Checkout Transparente). Mesmo token por tenant que `mercadopago.rs`
//! (Pix) já usa — `tenants.plataforma_credenciais.token`, nunca a conta da
//! plataforma (essa fica em `ufersin/backend`, cobra assinatura, é outro
//! sistema inteiro).
//!
//! PAN/CVV crus JAMAIS chegam aqui — o frontend tokeniza o cartão via SDK
//! oficial da Mercado Pago (`cardForm()`/Secure Fields) e só manda o
//! `card_token` resultante.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

const BASE_URL: &str = "https://api.mercadopago.com";

#[derive(Debug, Deserialize)]
struct MpPreferenceResponse {
    id: Option<String>,
    init_point: Option<String>,
    sandbox_init_point: Option<String>,
}

pub struct PaymentLinkResult {
    pub preference_id: String,
    pub init_point: String,
}

/// Link de pagamento hospedado pela própria Mercado Pago (Checkout Pro) —
/// `POST /checkout/preferences`. Usado quando o lojista (checkout público
/// ou PDV) escolhe "Link de pagamento": manda essa URL pro cliente
/// completar no celular DELE, nunca no dispositivo do lojista.
pub async fn create_payment_link(
    state: &AppState,
    access_token: &str,
    store_name: &str,
    total: f64,
    order_id: &str,
    back_url: &str,
    notification_url: Option<&str>,
) -> Result<PaymentLinkResult, AppError> {
    let mut body = json!({
        "items": [{
            "title": format!("Pedido {store_name}"),
            "quantity": 1,
            "unit_price": (total * 100.0).round() / 100.0,
            "currency_id": "BRL",
        }],
        "external_reference": order_id,
        "back_urls": {
            "success": back_url,
            "failure": back_url,
            "pending": back_url,
        },
        "auto_return": "approved",
    });
    if let Some(url) = notification_url {
        body["notification_url"] = json!(url);
    }

    let resp = state
        .http
        .post(format!("{BASE_URL}/checkout/preferences"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago preference request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago create preference failed: {status} {text}");
        return Err(AppError::BadRequest(
            "Mercado Pago recusou a criação do link de pagamento — tente de novo em instantes.".to_string(),
        ));
    }

    let parsed: MpPreferenceResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago preference parse error: {e}")))?;

    let preference_id = parsed
        .id
        .ok_or_else(|| AppError::Internal("mercado pago preference response missing id".to_string()))?;
    // `init_point` (produção) sempre existe pra token de conta live; contas
    // TEST- só devolvem `sandbox_init_point` — mesma distinção que o resto
    // do código já trata (ver PAYMENT_MODE em ufersin/backend).
    let init_point = parsed
        .init_point
        .or(parsed.sandbox_init_point)
        .ok_or_else(|| AppError::Internal("mercado pago preference response missing init_point".to_string()))?;

    Ok(PaymentLinkResult { preference_id, init_point })
}

#[derive(Debug, Deserialize)]
struct MpPaymentResponse {
    id: Option<serde_json::Value>,
    status: Option<String>,
    status_detail: Option<String>,
}

pub struct CardChargeResult {
    pub payment_id: String,
    /// `approved` | `in_process` | `rejected` | ... (status cru da Mercado
    /// Pago — quem chama decide o que fazer com cada um).
    pub status: String,
    pub status_detail: Option<String>,
}

/// Cobrança de cartão via `POST /v1/payments` com um `card_token` já
/// tokenizado no navegador do cliente (Checkout Transparente). Nunca
/// recebe PAN/CVV — só o token resultante do SDK oficial da Mercado Pago.
#[allow(clippy::too_many_arguments)]
pub async fn create_card_payment(
    state: &AppState,
    access_token: &str,
    store_name: &str,
    total: f64,
    card_token: &str,
    payment_method_id: &str,
    installments: i32,
    payer_email: &str,
    order_id: &str,
) -> Result<CardChargeResult, AppError> {
    let body = json!({
        "transaction_amount": (total * 100.0).round() / 100.0,
        "token": card_token,
        "description": format!("Pedido {store_name}"),
        "installments": installments.max(1),
        "payment_method_id": payment_method_id,
        "external_reference": order_id,
        "payer": { "email": payer_email },
    });

    let resp = state
        .http
        .post(format!("{BASE_URL}/v1/payments"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago card payment request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago create card payment failed: {status} {text}");
        return Err(AppError::BadRequest(
            "Mercado Pago recusou o pagamento com cartão — confira os dados do cartão e tente de novo."
                .to_string(),
        ));
    }

    let parsed: MpPaymentResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago card payment parse error: {e}")))?;

    let payment_id = match &parsed.id {
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => return Err(AppError::Internal("mercado pago card payment response missing id".to_string())),
    };

    Ok(CardChargeResult {
        payment_id,
        status: parsed.status.unwrap_or_else(|| "pending".to_string()),
        status_detail: parsed.status_detail,
    })
}

#[derive(Debug, Deserialize)]
struct MpPaymentDetailsResponse {
    status: Option<String>,
    external_reference: Option<String>,
}

pub struct PaymentDetails {
    pub status: String,
    /// `order.id` — sempre foi isso que este código já manda como
    /// `external_reference` em toda cobrança (Pix, link, cartão).
    pub external_reference: Option<String>,
}

/// `GET /v1/payments/:id` — usado pelo webhook pra rebuscar o pagamento
/// direto na Mercado Pago em vez de confiar em qualquer coisa que veio no
/// corpo da notificação (a notificação em si só avisa "algo mudou", nunca é
/// tratada como fonte de verdade).
pub async fn fetch_payment_details(
    state: &AppState,
    access_token: &str,
    payment_id: &str,
) -> Result<PaymentDetails, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_URL}/v1/payments/{payment_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago fetch payment failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago fetch payment failed: {status} {text}");
        return Err(AppError::Internal("failed to fetch mercado pago payment".to_string()));
    }

    let parsed: MpPaymentDetailsResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago payment parse error: {e}")))?;

    Ok(PaymentDetails {
        status: parsed.status.unwrap_or_else(|| "pending".to_string()),
        external_reference: parsed.external_reference,
    })
}
