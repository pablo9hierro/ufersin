use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;
use crate::gateway::{GatewayCharge, PaymentMethod};
use crate::state::AppState;

// Camada preparada, ainda sem credencial (ABACATEPAY_API_KEY vazio = modo
// mock) — mesmo padrão mock/real já usado no motor de e-commerce pro Pix
// do cliente final (ver ecommerce/backend/src/abacatepay.rs), aqui pro
// lado da COBRANÇA RECORRENTE DA PLATAFORMA (assinatura do lojista com a
// Rodoletas), não a venda do lojista pro cliente final dele — são dois
// contextos de cobrança diferentes que só por coincidência usam o mesmo
// gateway. A API pública da AbacatePay hoje é PIX-first; cartão/parcelado
// ficam documentados como "ainda não suportados por esse gateway" até a
// AbacatePay abrir esses produtos e a integração real ser feita.

const BASE_URL: &str = "https://api.abacatepay.com/v1";

#[derive(Debug, Deserialize)]
struct AbacatePixResponse {
    data: Option<AbacatePixData>,
    error: Option<serde_json::Value>,
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

pub async fn create_subscription(
    state: &AppState,
    reason: &str,
    _payer_email: &str,
    valor_mensal: f64,
    external_reference: &str,
    method: PaymentMethod,
) -> Result<GatewayCharge, AppError> {
    if !matches!(method, PaymentMethod::Pix) {
        return Err(AppError::BadRequest(
            "a AbacatePay hoje só processa cobrança via Pix nesta integração — escolha Pix ou mude pro Mercado Pago para cartão".to_string(),
        ));
    }

    match state.abacatepay_token.as_ref() {
        Some(token) => {
            let amount_centavos = (valor_mensal * 100.0).round() as i64;
            let body = json!({
                "amount": amount_centavos,
                "expiresIn": 3600,
                "description": reason,
                "externalId": external_reference,
            });
            let resp = state
                .http
                .post(format!("{BASE_URL}/pixQrCode/create"))
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

            let parsed: AbacatePixResponse = resp
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
            if let Some(err) = parsed.error {
                tracing::error!("abacatepay returned an error: {err}");
                return Err(AppError::Internal("abacatepay rejected the charge".to_string()));
            }
            let data = parsed.data.ok_or_else(|| AppError::Internal("abacatepay response missing data".to_string()))?;

            Ok(GatewayCharge {
                external_id: data.id,
                checkout_url: None,
                pix_qr_code: data.br_code,
                pix_qr_base64: data.br_code_base64,
            })
        }
        None => Ok(GatewayCharge {
            external_id: format!("mock-abacatepay-{}", uuid::Uuid::new_v4()),
            checkout_url: None,
            pix_qr_code: Some("00020126580014BR.GOV.BCB.PIX0136MOCK-NAO-USAR-PARA-PAGAR6304ABCD".to_string()),
            pix_qr_base64: None,
        }),
    }
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

    let resp = state
        .http
        .get(format!("{BASE_URL}/pixQrCode/check"))
        .bearer_auth(token)
        .query(&[("id", external_id)])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal("failed to fetch abacatepay charge status".to_string()));
    }
    let parsed: AbacatePixResponse = resp.json().await.map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
    Ok(parsed.data.and_then(|d| d.status).unwrap_or_else(|| "PENDING".to_string()))
}

pub async fn cancel(_state: &AppState, _external_id: &str) -> Result<(), AppError> {
    // PIX avulso não tem "assinatura" pra cancelar no gateway (cada
    // cobrança já nasce e morre sozinha) — cancelar aqui é só local
    // (subscribers.status), então não há chamada de API real a fazer.
    Ok(())
}

/// Webhook da AbacatePay (billing.paid etc) — preparado, não testado com
/// tráfego real ainda (sem credencial). Formato aproximado do que a
/// AbacatePay documenta; ajustar se o formato real divergir quando a
/// integração for ligada de verdade.
pub async fn handle_webhook(payload: &serde_json::Value) -> Option<(String, String)> {
    let event = payload.get("event").and_then(|v| v.as_str())?;
    let external_id = payload.get("data")?.get("id").and_then(|v| v.as_str())?.to_string();
    let status = match event {
        "billing.paid" | "pixQrCode.paid" => "PAID",
        _ => return None,
    };
    Some((external_id, status.to_string()))
}
