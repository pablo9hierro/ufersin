use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct MercadoPagoWebhookQuery {
    /// Classic IPN: `topic=payment&id=…` or `type=payment&data.id=…`
    pub topic: Option<String>,
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub id: Option<String>,
    #[serde(rename = "data.id")]
    pub data_id: Option<String>,
}

/// Mercado Pago notifications for on-site Pix/card (`POST /v1/payments`).
///
/// **Configure in MP dashboard (Your integrations → Webhooks):**
/// `https://ufersin-api-production.up.railway.app/api/webhooks/mercadopago`
/// Events: `payment` (created/updated). Also set per-payment via `notification_url`.
///
/// Always re-fetches the payment with `MP_ACCESS_TOKEN` before activating —
/// never trusts the body alone. Always returns 200 to avoid retry storms.
pub async fn mercadopago_webhook(
    State(state): State<AppState>,
    Query(q): Query<MercadoPagoWebhookQuery>,
    body: Bytes,
) -> StatusCode {
    let payment_id = extract_mp_payment_id(&q, &body);
    let Some(payment_id) = payment_id else {
        tracing::debug!("mercadopago webhook: no payment id — ack");
        return StatusCode::OK;
    };

    match crate::routes::assinatura::activate_from_mp_payment_id(&state, &payment_id).await {
        Ok(true) => {
            tracing::info!(payment_id, "mercadopago webhook: activated or already ativo");
        }
        Ok(false) => {
            tracing::debug!(payment_id, "mercadopago webhook: no activation needed");
        }
        Err(e) => {
            tracing::warn!(payment_id, error = ?e, "mercadopago webhook: activate failed");
        }
    }

    StatusCode::OK
}

fn extract_mp_payment_id(q: &MercadoPagoWebhookQuery, body: &Bytes) -> Option<String> {
    let topic = q
        .topic
        .as_deref()
        .or(q.type_.as_deref())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(topic.as_str(), "payment" | "payments" | "") {
        if let Some(id) = q
            .data_id
            .as_deref()
            .or(q.id.as_deref())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            // Avoid treating merchant_order ids when topic is wrong — still ok, activate will no-op
            return Some(id.to_string());
        }
    }

    if body.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_slice(body).ok()?;
    let action = v
        .get("action")
        .and_then(|a| a.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let type_ = v
        .get("type")
        .or_else(|| v.get("topic"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !action.is_empty() && !action.contains("payment") && type_ != "payment" {
        return None;
    }
    if !type_.is_empty() && type_ != "payment" && !action.contains("payment") {
        return None;
    }
    v.get("data")
        .and_then(|d| d.get("id"))
        .and_then(|id| match id {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .or_else(|| {
            v.get("id").and_then(|id| match id {
                Value::String(s) if s.chars().all(|c| c.is_ascii_digit()) => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
        })
}
