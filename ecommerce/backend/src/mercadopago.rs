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
    let email = customer_email
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("cliente@resolutoo.local");

    let body = json!({
        "transaction_amount": (total * 100.0).round() / 100.0,
        "description": format!("Pedido {store_name}"),
        "payment_method_id": "pix",
        "external_reference": external_reference,
        "payer": {
            "email": email,
            "first_name": customer_name.chars().take(60).collect::<String>(),
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
        return Err(AppError::Internal("failed to create mercado pago pix charge".to_string()));
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
