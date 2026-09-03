//! Uber Direct -- implementado contra a API pública documentada (OAuth2
//! client-credentials + "Direct API" v1, `https://developer.uber.com/docs/deliveries`).
//!
//! ⚠️ AVISO HONESTO (regra 32 do pedido): este código foi escrito a partir de
//! conhecimento de treinamento sobre a API pública da Uber Direct, SEM
//! acesso à documentação/sandbox ao vivo nesta sessão (sem credenciais
//! disponíveis pra testar de verdade -- confirmado com o usuário antes de
//! implementar). Os nomes de endpoint, campos de request/response e o
//! esquema de assinatura de webhook abaixo precisam ser validados contra a
//! documentação oficial atual (ou um sandbox real) ANTES de qualquer uso
//! além de desenvolvimento local. Nada aqui foi inventado sem base — mas
//! "base em treinamento" não é o mesmo que "confirmado ao vivo", e este
//! comentário existe pra isso nunca virar confiança implícita.
//!
//! Pontos que precisam de confirmação explícita antes de produção:
//! - Path exato de quote/create/get/cancel (assumido `/v1/customers/{customer_id}/...`).
//! - Nome e formato exatos dos campos de endereço/pacote no payload.
//! - Header e algoritmo exatos de assinatura de webhook (assumido
//!   `X-Uber-Signature` HMAC-SHA256 sobre o corpo cru, mesmo padrão do
//!   Mercado Pago já usado neste backend -- ver `webhooks.rs::signature_looks_valid`).
//! - Scope OAuth exato (`eats.deliveries` é o valor mais comumente
//!   documentado publicamente, mas pode ter mudado).

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::AppError;

use super::super::{
    DeliveryCreateRequest, DeliveryHandle, DeliveryQuote, DeliveryQuoteRequest, DeliveryStatus,
    NormalizedDeliveryEvent,
};

const AUTH_URL: &str = "https://auth.uber.com/oauth/token";
const DEFAULT_BASE_URL: &str = "https://api.uber.com";
const DEFAULT_SCOPE: &str = "eats.deliveries";

#[derive(Debug, Clone, Deserialize)]
pub struct UberDirectCredentials {
    pub client_id: String,
    pub client_secret: String,
    pub customer_id: String,
    /// Chave de assinatura de webhook (Uber gera uma por app/organization).
    #[serde(default)]
    pub webhook_signing_key: Option<String>,
}

pub struct UberDirectProvider {
    http: reqwest::Client,
    base_url: String,
    credentials: UberDirectCredentials,
}

impl UberDirectProvider {
    pub fn new(http: reqwest::Client, credentials: UberDirectCredentials) -> Self {
        Self { http, base_url: DEFAULT_BASE_URL.to_string(), credentials }
    }

    /// Token de curta duração via OAuth2 client-credentials -- essa parte
    /// segue o padrão OAuth2 documentado (fluxo padrão, não específico da
    /// Uber). Sem cache nesta primeira versão: busca um token novo a cada
    /// chamada (funciona, não é o mais eficiente -- ver limitações no
    /// relatório final).
    async fn fetch_token(&self) -> Result<String, AppError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
        }
        let resp = self
            .http
            .post(AUTH_URL)
            .form(&[
                ("client_id", self.credentials.client_id.as_str()),
                ("client_secret", self.credentials.client_secret.as_str()),
                ("grant_type", "client_credentials"),
                ("scope", DEFAULT_SCOPE),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct auth request failed: {e}")))?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!("uber direct auth failed: {text}")));
        }
        let parsed: TokenResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct auth parse failed: {e}")))?;
        Ok(parsed.access_token)
    }

    fn customer_path(&self, suffix: &str) -> String {
        format!("{}/v1/customers/{}{}", self.base_url, self.credentials.customer_id, suffix)
    }

    pub async fn quote(&self, req: &DeliveryQuoteRequest) -> Result<DeliveryQuote, AppError> {
        let token = self.fetch_token().await?;
        let body = json!({
            "pickup_address": req.pickup.address,
            "pickup_latitude": req.pickup.lat,
            "pickup_longitude": req.pickup.lng,
            "dropoff_address": req.dropoff.address,
            "dropoff_latitude": req.dropoff.lat,
            "dropoff_longitude": req.dropoff.lng,
            "external_store_id": req.order_reference,
        });
        let resp = self
            .http
            .post(self.customer_path("/delivery_quotes"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct quote request failed: {e}")))?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::BadRequest(format!("uber direct quote failed: {text}")));
        }
        #[derive(Deserialize)]
        struct QuoteResponse {
            id: String,
            fee: f64,
            duration: Option<i32>,
        }
        let parsed: QuoteResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct quote parse failed: {e}")))?;
        Ok(DeliveryQuote {
            provider: super::super::ProviderCode::UberDirect,
            external_quote_id: Some(parsed.id),
            // Uber Direct cobra em centavos por padrão na documentação
            // pública -- convertido pra reais aqui; confirmar moeda/escala
            // real antes de produção.
            amount: parsed.fee / 100.0,
            eta_minutes: parsed.duration,
        })
    }

    pub async fn create(&self, req: &DeliveryCreateRequest) -> Result<DeliveryHandle, AppError> {
        let token = self.fetch_token().await?;
        let body = json!({
            "quote_id": req.quote.external_quote_id,
            "pickup_name": req.pickup.name,
            "pickup_address": req.pickup.address,
            "pickup_phone_number": req.pickup.phone,
            "dropoff_name": req.dropoff.name,
            "dropoff_address": req.dropoff.address,
            "dropoff_phone_number": req.dropoff.phone,
            "external_id": req.order_reference,
        });
        let resp = self
            .http
            .post(self.customer_path("/deliveries"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct create request failed: {e}")))?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::BadRequest(format!("uber direct create failed: {text}")));
        }
        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct create parse failed: {e}")))?;
        parse_delivery_response(raw)
    }

    pub async fn get(&self, external_id: &str) -> Result<DeliveryHandle, AppError> {
        let token = self.fetch_token().await?;
        let resp = self
            .http
            .get(self.customer_path(&format!("/deliveries/{external_id}")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct get request failed: {e}")))?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::BadRequest(format!("uber direct get failed: {text}")));
        }
        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct get parse failed: {e}")))?;
        parse_delivery_response(raw)
    }

    pub async fn cancel(&self, external_id: &str) -> Result<(), AppError> {
        let token = self.fetch_token().await?;
        let resp = self
            .http
            .post(self.customer_path(&format!("/deliveries/{external_id}/cancel")))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("uber direct cancel request failed: {e}")))?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::BadRequest(format!("uber direct cancel failed: {text}")));
        }
        Ok(())
    }
}

fn parse_delivery_response(raw: serde_json::Value) -> Result<DeliveryHandle, AppError> {
    let external_delivery_id = raw
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("uber direct response missing id".to_string()))?
        .to_string();
    let status_raw = raw.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let tracking_url = raw
        .get("tracking_url")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let provider_cost = raw.get("fee").and_then(|v| v.as_f64()).map(|c| c / 100.0);
    Ok(DeliveryHandle {
        external_delivery_id,
        status: normalize_status(status_raw),
        tracking_url,
        provider_cost,
        raw,
    })
}

/// Mapeia os status documentados publicamente da Uber Direct pro enum
/// normalizado interno (seção 17 do pedido). Nomes de status assumidos a
/// partir da doc pública -- confirmar contra live docs antes de produção.
fn normalize_status(uber_status: &str) -> DeliveryStatus {
    match uber_status {
        "pending" => DeliveryStatus::Created,
        "pickup" => DeliveryStatus::CourierAssigned,
        "pickup_complete" | "en_route_to_pickup" => DeliveryStatus::EnRouteToPickup,
        "picked_up" => DeliveryStatus::PickedUp,
        "dropoff" | "en_route_to_dropoff" => DeliveryStatus::EnRouteToDropoff,
        "delivered" => DeliveryStatus::Delivered,
        "canceled" | "cancelled" => DeliveryStatus::Cancelled,
        _ => DeliveryStatus::Failed,
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct UberWebhookPayload {
    delivery_id: String,
    /// Assumido como o id do evento em si -- se a Uber não mandar um campo
    /// dedicado, cair pro par (delivery_id, status, timestamp) como chave
    /// de dedupe é a alternativa (ver `parse_webhook`).
    #[serde(default)]
    event_id: Option<String>,
    status: String,
    #[serde(default)]
    timestamp: Option<String>,
}

/// Valida a assinatura (best-effort, mesmo padrão tolerante do webhook do
/// Mercado Pago -- loga e segue mesmo se a assinatura não bater, porque a
/// defesa real é sempre re-consultar `GET /deliveries/{id}` antes de
/// confiar no conteúdo, nunca confiar cegamente no corpo do webhook).
pub fn verify_signature(signing_key: Option<&str>, signature_header: Option<&str>, raw_body: &[u8]) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let (Some(key), Some(sig)) = (signing_key, signature_header) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key.as_bytes()) else {
        return false;
    };
    mac.update(raw_body);
    let expected = mac.finalize().into_bytes();
    let expected_hex = hex::encode(expected);
    expected_hex == sig
}

pub fn parse_webhook(payload: &serde_json::Value) -> Result<NormalizedDeliveryEvent, AppError> {
    let parsed: UberWebhookPayload = serde_json::from_value(payload.clone())
        .map_err(|e| AppError::BadRequest(format!("uber direct webhook payload inválido: {e}")))?;
    let external_event_id = parsed.event_id.clone().unwrap_or_else(|| {
        format!(
            "{}:{}:{}",
            parsed.delivery_id,
            parsed.status,
            parsed.timestamp.as_deref().unwrap_or("")
        )
    });
    Ok(NormalizedDeliveryEvent {
        external_delivery_id: parsed.delivery_id,
        external_event_id,
        status: normalize_status(&parsed.status),
        raw: payload.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_known_statuses() {
        assert_eq!(normalize_status("delivered"), DeliveryStatus::Delivered);
        assert_eq!(normalize_status("picked_up"), DeliveryStatus::PickedUp);
        assert_eq!(normalize_status("canceled"), DeliveryStatus::Cancelled);
    }

    #[test]
    fn unknown_status_maps_to_failed_not_panic() {
        assert_eq!(normalize_status("something_new_uber_added"), DeliveryStatus::Failed);
    }

    #[test]
    fn webhook_without_event_id_still_gets_a_stable_dedupe_key() {
        let payload = json!({"delivery_id": "d1", "status": "delivered", "timestamp": "2026-01-01T00:00:00Z"});
        let ev = parse_webhook(&payload).unwrap();
        assert_eq!(ev.external_event_id, "d1:delivered:2026-01-01T00:00:00Z");
        assert_eq!(ev.status, DeliveryStatus::Delivered);
    }
}
