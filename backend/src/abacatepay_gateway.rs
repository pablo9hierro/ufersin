use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use tokio::sync::RwLock;

use crate::error::AppError;
use crate::gateway::{BillingCycle, GatewayCharge, PaymentMethod};
use crate::state::AppState;

// Cobrança da assinatura do lojista com a Rodoletas via AbacatePay.
// - Cartão: Checkout de assinatura recorrente (API v2 /subscriptions/create)
//   com produto MONTHLY ou SEMIANNUALLY.
// - Pix: QR Code avulso (API v1 /pixQrCode/create) no valor do período —
//   a AbacatePay ainda não faz recorrência Pix nesta integração.

const BASE_V1: &str = "https://api.abacatepay.com/v1";
const BASE_V2: &str = "https://api.abacatepay.com/v2";

/// Cache em memória dos product ids AbacatePay já criados nesta execução
/// (externalId -> product id público). Evita recriar produto a cada assinatura.
static PRODUCT_CACHE: std::sync::OnceLock<RwLock<HashMap<String, String>>> = std::sync::OnceLock::new();

fn product_cache() -> &'static RwLock<HashMap<String, String>> {
    PRODUCT_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
struct AbacateEnvelope<T> {
    data: Option<T>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AbacateProduct {
    id: String,
    #[serde(rename = "externalId")]
    external_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AbacateBilling {
    id: String,
    url: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AbacatePixData {
    id: String,
    #[serde(rename = "brCode")]
    br_code: Option<String>,
    #[serde(rename = "brCodeBase64")]
    br_code_base64: Option<String>,
    status: Option<String>,
}

fn cycle_api(cycle: BillingCycle) -> &'static str {
    match cycle {
        BillingCycle::Mensal => "MONTHLY",
        BillingCycle::Semestral => "SEMIANNUALLY",
    }
}

fn product_external_id(plan_code: &str, cycle: BillingCycle) -> String {
    format!("rodoletas-{plan_code}-{}", cycle.as_str())
}

fn product_name(plan_code: &str, cycle: BillingCycle) -> String {
    let plan = match plan_code {
        "essential" => "Essential",
        "management" => "Management",
        "premium" => "Premium",
        other => other,
    };
    match cycle {
        BillingCycle::Mensal => format!("Rodoletas {plan} — mensal"),
        BillingCycle::Semestral => format!("Rodoletas {plan} — semestral (−5%)"),
    }
}

async fn ensure_product(
    state: &AppState,
    token: &str,
    plan_code: &str,
    cycle: BillingCycle,
    amount_reais: f64,
) -> Result<String, AppError> {
    let external_id = product_external_id(plan_code, cycle);
    if let Some(id) = product_cache().read().await.get(&external_id).cloned() {
        return Ok(id);
    }

    let amount_centavos = (amount_reais * 100.0).round() as i64;
    let body = json!({
        "externalId": external_id,
        "name": product_name(plan_code, cycle),
        "price": amount_centavos,
        "currency": "BRL",
        "description": product_name(plan_code, cycle),
        "cycle": cycle_api(cycle),
    });

    let resp = state
        .http
        .post(format!("{BASE_V2}/products/create"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay product create failed: {e}")))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        // Produto já existe — tenta listar e achar pelo externalId.
        if text.contains("already") || text.contains("existe") || status.as_u16() == 409 {
            if let Some(id) = find_product_by_external_id(state, token, &external_id).await? {
                product_cache().write().await.insert(external_id, id.clone());
                return Ok(id);
            }
        }
        tracing::error!("abacatepay product create failed: {status} {text}");
        return Err(AppError::Internal("failed to create abacatepay product".to_string()));
    }

    let parsed: AbacateEnvelope<AbacateProduct> = serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("abacatepay product parse error: {e}")))?;
    if let Some(err) = parsed.error {
        tracing::error!("abacatepay product error: {err}");
        return Err(AppError::Internal("abacatepay rejected the product".to_string()));
    }
    let data = parsed
        .data
        .ok_or_else(|| AppError::Internal("abacatepay product response missing data".to_string()))?;
    product_cache().write().await.insert(external_id, data.id.clone());
    Ok(data.id)
}

async fn find_product_by_external_id(
    state: &AppState,
    token: &str,
    external_id: &str,
) -> Result<Option<String>, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_V2}/products/list"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay products list failed: {e}")))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let parsed: AbacateEnvelope<Vec<AbacateProduct>> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay products list parse error: {e}")))?;
    Ok(parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .find(|p| p.external_id.as_deref() == Some(external_id))
        .map(|p| p.id))
}

pub async fn create_subscription(
    state: &AppState,
    reason: &str,
    payer_email: &str,
    plan_code: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    external_reference: &str,
    method: PaymentMethod,
) -> Result<GatewayCharge, AppError> {
    match state.abacatepay_token.as_ref() {
        Some(token) => match method {
            PaymentMethod::Pix => create_pix_charge(state, token, reason, amount_reais, external_reference).await,
            PaymentMethod::Cartao | PaymentMethod::CartaoParcelado => {
                create_card_subscription(state, token, plan_code, amount_reais, cycle, payer_email, external_reference)
                    .await
            }
        },
        None => Ok(GatewayCharge {
            external_id: format!("mock-abacatepay-{}", uuid::Uuid::new_v4()),
            checkout_url: Some(format!(
                "{}/obrigado?id={}&mock=1",
                state.back_url.trim_end_matches("/obrigado").trim_end_matches('/'),
                external_reference
            )),
            pix_qr_code: Some("00020126580014BR.GOV.BCB.PIX0136MOCK-NAO-USAR-PARA-PAGAR6304ABCD".to_string()),
            pix_qr_base64: None,
        }),
    }
}

async fn create_card_subscription(
    state: &AppState,
    token: &str,
    plan_code: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    payer_email: &str,
    external_reference: &str,
) -> Result<GatewayCharge, AppError> {
    let product_id = ensure_product(state, token, plan_code, cycle, amount_reais).await?;
    let completion = if state.back_url.is_empty() {
        format!("https://resolutoo.com/obrigado?id={external_reference}")
    } else if state.back_url.contains('?') {
        format!("{}&id={external_reference}", state.back_url)
    } else {
        format!("{}?id={external_reference}", state.back_url)
    };
    let return_url = completion
        .split('?')
        .next()
        .unwrap_or("https://resolutoo.com/obrigado")
        .replace("/obrigado", "/assinar");

    let body = json!({
        "items": [{ "id": product_id, "quantity": 1 }],
        "methods": ["CARD"],
        "externalId": external_reference,
        "completionUrl": completion,
        "returnUrl": return_url,
        "metadata": {
            "email": payer_email,
            "plan": plan_code,
            "cycle": cycle.as_str(),
        }
    });

    let resp = state
        .http
        .post(format!("{BASE_V2}/subscriptions/create"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay subscription create failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("abacatepay subscription create failed: {status} {text}");
        return Err(AppError::Internal("failed to create abacatepay subscription".to_string()));
    }

    let parsed: AbacateEnvelope<AbacateBilling> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay subscription parse error: {e}")))?;
    if let Some(err) = parsed.error {
        tracing::error!("abacatepay subscription error: {err}");
        return Err(AppError::Internal("abacatepay rejected the subscription".to_string()));
    }
    let data = parsed
        .data
        .ok_or_else(|| AppError::Internal("abacatepay subscription response missing data".to_string()))?;

    Ok(GatewayCharge {
        external_id: data.id,
        checkout_url: data.url,
        pix_qr_code: None,
        pix_qr_base64: None,
    })
}

async fn create_pix_charge(
    state: &AppState,
    token: &str,
    reason: &str,
    amount_reais: f64,
    external_reference: &str,
) -> Result<GatewayCharge, AppError> {
    let amount_centavos = (amount_reais * 100.0).round() as i64;
    let body = json!({
        "amount": amount_centavos,
        "expiresIn": 3600,
        "description": reason,
        "externalId": external_reference,
    });
    let resp = state
        .http
        .post(format!("{BASE_V1}/pixQrCode/create"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("abacatepay create pix failed: {status} {text}");
        return Err(AppError::Internal("failed to create abacatepay charge".to_string()));
    }

    let parsed: AbacateEnvelope<AbacatePixData> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
    if let Some(err) = parsed.error {
        tracing::error!("abacatepay returned an error: {err}");
        return Err(AppError::Internal("abacatepay rejected the charge".to_string()));
    }
    let data = parsed
        .data
        .ok_or_else(|| AppError::Internal("abacatepay response missing data".to_string()))?;

    Ok(GatewayCharge {
        external_id: data.id,
        checkout_url: None,
        pix_qr_code: data.br_code,
        pix_qr_base64: data.br_code_base64,
    })
}

pub async fn get_status(state: &AppState, external_id: &str) -> Result<String, AppError> {
    if external_id.starts_with("mock-") {
        return Ok("PENDING".to_string());
    }
    let token = state
        .abacatepay_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("abacatepay not configured".to_string()))?;

    // Checkout de assinatura (bill_*) — API v2.
    if external_id.starts_with("bill_") {
        let resp = state
            .http
            .get(format!("{BASE_V2}/subscriptions/get"))
            .bearer_auth(token)
            .query(&[("id", external_id)])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Internal("failed to fetch abacatepay subscription status".to_string()));
        }
        let parsed: AbacateEnvelope<AbacateBilling> = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
        return Ok(parsed.data.and_then(|d| d.status).unwrap_or_else(|| "PENDING".to_string()));
    }

    // Pix avulso — API v1.
    let resp = state
        .http
        .get(format!("{BASE_V1}/pixQrCode/check"))
        .bearer_auth(token)
        .query(&[("id", external_id)])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal("failed to fetch abacatepay charge status".to_string()));
    }
    let parsed: AbacateEnvelope<AbacatePixData> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
    Ok(parsed.data.and_then(|d| d.status).unwrap_or_else(|| "PENDING".to_string()))
}

pub async fn cancel(state: &AppState, external_id: &str) -> Result<(), AppError> {
    if external_id.starts_with("mock-") || !external_id.starts_with("bill_") {
        return Ok(());
    }
    let Some(token) = state.abacatepay_token.as_ref().as_ref() else {
        return Ok(());
    };
    let resp = state
        .http
        .post(format!("{BASE_V2}/subscriptions/cancel"))
        .bearer_auth(token)
        .json(&json!({ "id": external_id }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay cancel failed: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::warn!("abacatepay cancel non-success: {text}");
    }
    Ok(())
}

/// Webhook da AbacatePay (billing.paid / subscription events).
pub async fn handle_webhook(payload: &serde_json::Value) -> Option<(String, String)> {
    let event = payload.get("event").and_then(|v| v.as_str())?;
    let external_id = payload
        .get("data")?
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("data")?.get("billing")?.get("id").and_then(|v| v.as_str()))?
        .to_string();
    let status = match event {
        "billing.paid" | "pixQrCode.paid" | "subscription.paid" | "checkout.paid" => "PAID",
        _ => return None,
    };
    Some((external_id, status.to_string()))
}
