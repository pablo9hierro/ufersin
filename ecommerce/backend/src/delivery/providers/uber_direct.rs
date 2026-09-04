//! Uber Direct -- implementado contra a spec OpenAPI oficial da "Direct API"
//! v1.0.1 (Create Quote, Create Delivery, Get Delivery), colada pelo usuário
//! nesta sessão a partir do developer.uber.com/dashboard (Redoc renderizado
//! client-side, inacessível por fetch automatizado -- por isso o texto
//! bruto da spec foi a fonte real usada aqui, não treinamento).
//!
//! ⚠️ O QUE AINDA NÃO ESTÁ CONFIRMADO:
//! - **Cancel Delivery**: a spec colada foi cortada antes dessa seção (só a
//!   tabela de conteúdo confirmou que o endpoint existe). Path assumido por
//!   convenção REST (`POST .../deliveries/{id}/cancel`) -- se estiver
//!   errado, falha limpo com 404 (não silenciosamente).
//! - **Formato do endereço estruturado**: `pickup_address`/`dropoff_address`
//!   são strings JSON obrigatórias com `street_address`/`city`/`state`/
//!   `zip_code`/`country` -- confirmado pela spec. O que NÃO está confirmado
//!   é se a Uber aceita esses campos vazios/aproximados: nosso modelo interno
//!   (`DeliveryAddress`) só guarda um endereço em texto livre, sem
//!   city/state/zip capturados em lugar nenhum do sistema (nem
//!   `orders.address`, nem `tenants.pickup_address`). `build_address_json`
//!   abaixo joga o texto inteiro em `street_address[0]` e deixa
//!   city/state/zip vazios, `country: "BR"` fixo -- é uma aposta educada,
//!   só fica confirmada com uma cotação real bem-sucedida.
//! - Nunca testado contra credenciais válidas nesta sessão (a única
//!   tentativa deu "client secret mismatch" -- provável erro de
//!   transcrição de uma credencial vista só por screenshot).

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::AppError;

use super::super::{
    DeliveryAddress, DeliveryCreateRequest, DeliveryHandle, DeliveryQuote, DeliveryQuoteRequest,
    DeliveryStatus, NormalizedDeliveryEvent,
};

const AUTH_URL: &str = "https://auth.uber.com/oauth/v2/token";
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

/// Corpo de `pickup_address`/`dropoff_address` -- a Uber exige uma STRING
/// JSON (não um objeto aninhado) contendo isso serializado, ver
/// `build_address_json`.
#[derive(Debug, Serialize)]
struct UberAddressJson {
    street_address: Vec<String>,
    city: String,
    state: String,
    zip_code: String,
    country: String,
}

/// Nosso `DeliveryAddress.address` é texto livre (sem city/state/zip
/// capturados em lugar nenhum do sistema hoje) -- todo o texto vai pra
/// `street_address[0]`, o resto fica vazio. Ver aviso no topo do arquivo.
fn build_address_json(addr: &DeliveryAddress) -> String {
    let json = UberAddressJson {
        street_address: vec![addr.address.clone()],
        city: String::new(),
        state: String::new(),
        zip_code: String::new(),
        country: "BR".to_string(),
    };
    serde_json::to_string(&json).unwrap_or_default()
}

impl UberDirectProvider {
    pub fn new(http: reqwest::Client, credentials: UberDirectCredentials) -> Self {
        Self { http, base_url: DEFAULT_BASE_URL.to_string(), credentials }
    }

    /// Token de curta duração via OAuth2 client-credentials. Sem cache
    /// nesta primeira versão: busca um token novo a cada chamada (funciona,
    /// não é o mais eficiente -- ver limitações no relatório final).
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
            "pickup_address": build_address_json(&req.pickup),
            "pickup_latitude": req.pickup.lat,
            "pickup_longitude": req.pickup.lng,
            "dropoff_address": build_address_json(&req.dropoff),
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
        // Campos confirmados contra a spec OpenAPI oficial (Create Quote
        // 200): kind, id, created, expires, fee, currency, currency_type,
        // dropoff_eta, duration, pickup_duration, dropoff_deadline.
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
            // fee vem em centavos (confirmado pela spec: "$10.99 => 1099").
            amount: parsed.fee / 100.0,
            eta_minutes: parsed.duration,
        })
    }

    pub async fn create(&self, req: &DeliveryCreateRequest) -> Result<DeliveryHandle, AppError> {
        let token = self.fetch_token().await?;
        // manifest_items é obrigatório na spec -- item genérico mínimo
        // (size default "small" quando omitido, confirmado pela spec).
        let manifest_items = json!([{
            "name": format!("Pedido #{}", req.order_reference),
            "quantity": 1,
        }]);
        let body = json!({
            "quote_id": req.quote.external_quote_id,
            "pickup_name": req.pickup.name,
            "pickup_address": build_address_json(&req.pickup),
            "pickup_phone_number": req.pickup.phone,
            "pickup_latitude": req.pickup.lat,
            "pickup_longitude": req.pickup.lng,
            "dropoff_name": req.dropoff.name,
            "dropoff_address": build_address_json(&req.dropoff),
            "dropoff_phone_number": req.dropoff.phone,
            "dropoff_latitude": req.dropoff.lat,
            "dropoff_longitude": req.dropoff.lng,
            "manifest_items": manifest_items,
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

    /// ⚠️ Path não confirmado pela spec (cortada antes desta seção) --
    /// convenção REST, ver aviso no topo do arquivo.
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

/// Valores confirmados pela spec: pending, pickup, pickup_complete,
/// dropoff, delivered, canceled, returned.
fn normalize_status(uber_status: &str) -> DeliveryStatus {
    match uber_status {
        "pending" => DeliveryStatus::Created,
        "pickup" => DeliveryStatus::CourierAssigned,
        "pickup_complete" => DeliveryStatus::EnRouteToPickup,
        "dropoff" => DeliveryStatus::EnRouteToDropoff,
        "delivered" => DeliveryStatus::Delivered,
        "canceled" | "cancelled" | "returned" => DeliveryStatus::Cancelled,
        _ => DeliveryStatus::Failed,
    }
}

/// Formato real do webhook (confirmado pela spec + payload de exemplo
/// colado pelo usuário): `kind` é o tipo do evento
/// (`event.delivery_status` | `event.courier_update` | `event.refund_request`),
/// `id` é o id do próprio evento (usado direto pro dedupe -- muito melhor
/// que inventar uma chave sintética). Status de entrega só existe pra
/// delivery_status/courier_update, e mesmo assim só de forma confiável
/// dentro de `data.status` (courier_update não tem status no top-level);
/// refund_request não tem status de entrega nenhum.
#[derive(Debug, Deserialize, Serialize)]
struct UberWebhookPayload {
    id: String,
    kind: String,
    delivery_id: String,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

/// Valida a assinatura (best-effort, mesmo padrão tolerante do webhook do
/// Mercado Pago -- loga e segue mesmo se a assinatura não bater, porque a
/// defesa real é sempre re-consultar `GET /deliveries/{id}` antes de
/// confiar no conteúdo, nunca confiar cegamente no corpo do webhook).
/// Aceita `x-uber-signature` OU `x-postmates-signature` -- a spec confirma
/// que ambos são válidos pros eventos delivery_status/courier_update
/// (refund_request só aceita x-uber-signature, mas verificar os dois aqui
/// não enfraquece isso, só é mais tolerante em ambos os casos).
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
    // data.status é a fonte mais confiável (presente em delivery_status e
    // courier_update); cai pro status top-level se data vier ausente;
    // refund_request não tem nenhum dos dois -- fica None, o webhook route
    // trata isso como "não atualiza status, só loga o evento".
    let status_raw = parsed
        .data
        .as_ref()
        .and_then(|d| d.get("status"))
        .and_then(|s| s.as_str())
        .or(parsed.status.as_deref());
    Ok(NormalizedDeliveryEvent {
        external_delivery_id: parsed.delivery_id,
        external_event_id: parsed.id,
        status: status_raw.map(normalize_status),
        raw: payload.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_known_statuses() {
        assert_eq!(normalize_status("delivered"), DeliveryStatus::Delivered);
        assert_eq!(normalize_status("pickup_complete"), DeliveryStatus::EnRouteToPickup);
        assert_eq!(normalize_status("canceled"), DeliveryStatus::Cancelled);
        assert_eq!(normalize_status("returned"), DeliveryStatus::Cancelled);
    }

    #[test]
    fn unknown_status_maps_to_failed_not_panic() {
        assert_eq!(normalize_status("something_new_uber_added"), DeliveryStatus::Failed);
    }

    #[test]
    fn address_builds_valid_json_string() {
        let addr = DeliveryAddress {
            address: "Rua Teste, 123".to_string(),
            lat: Some(-7.1),
            lng: Some(-34.8),
            name: None,
            phone: None,
        };
        let json_str = build_address_json(&addr);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed["street_address"][0], "Rua Teste, 123");
        assert_eq!(parsed["country"], "BR");
    }

    #[test]
    fn parses_real_delivery_status_webhook_using_data_status() {
        // Payload resumido do exemplo real colado pelo usuário (doc oficial).
        let payload = json!({
            "id": "evt_Bouz7BhPTYGDz9FFQNgODw",
            "kind": "event.delivery_status",
            "delivery_id": "del_QbLowiwHQM-b4e8YmOZNOw",
            "status": "delivered",
            "data": { "status": "delivered" }
        });
        let ev = parse_webhook(&payload).unwrap();
        assert_eq!(ev.external_event_id, "evt_Bouz7BhPTYGDz9FFQNgODw");
        assert_eq!(ev.external_delivery_id, "del_QbLowiwHQM-b4e8YmOZNOw");
        assert_eq!(ev.status, Some(DeliveryStatus::Delivered));
    }

    #[test]
    fn parses_real_courier_update_webhook_status_only_in_data() {
        // courier_update não tem status no top-level, só dentro de data.
        let payload = json!({
            "id": "evt_WNjLziAJT4eiOKgPsLNtbw",
            "kind": "event.courier_update",
            "delivery_id": "del_y_aY8RuTQ0CRKu2aFXe8qQ",
            "location": {"lat": 40.71093, "lng": -74.0119},
            "data": { "status": "pickup" }
        });
        let ev = parse_webhook(&payload).unwrap();
        assert_eq!(ev.status, Some(DeliveryStatus::CourierAssigned));
    }

    #[test]
    fn refund_webhook_has_no_delivery_status() {
        let payload = json!({
            "id": "evt_nyNh-zBTR-uxdQjq5kYxhg",
            "kind": "event.refund_request",
            "delivery_id": "del_G_8_eeo4Q5WrYpYkATt6SA",
            "data": { "id": "6817a070-115e-4ca9-8266-c245fe18a2d6" }
        });
        let ev = parse_webhook(&payload).unwrap();
        assert_eq!(ev.status, None);
    }
}
