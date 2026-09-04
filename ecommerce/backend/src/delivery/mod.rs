//! Entregas terceirizadas (Uber Direct / 99Entrega) -- módulo isolado,
//! provider-agnostic. O resto do Resolutoo nunca fala com Uber/99
//! diretamente, só com os tipos daqui (`Delivery*`) e com
//! `orchestrator::DeliveryOrchestrator`.
//!
//! Dispatch por enum (não `Box<dyn Trait>`): o projeto não tem `async-trait`
//! como dependência, e trait nativa com `async fn` não suporta objeto dyn
//! sem essa crate. Com só 2 providers hoje (e a arquitetura pedindo "fácil
//! de adicionar um terceiro depois", não "genérico ao infinito agora"), um
//! enum com um `match` central é a versão mais simples que atende os dois
//! requisitos -- adicionar um provider novo é uma variante + um braço de
//! match, tudo centralizado aqui.

pub mod orchestrator;
pub mod providers;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use providers::uber_direct::UberDirectProvider;

/// Bate com o CHECK constraint de `provider` nas tabelas
/// `delivery_provider_credentials`/`deliveries`/`delivery_attempts`.
/// 99Entrega foi abortado (sem credenciais/docs reais disponiveis) -- so
/// Uber Direct por enquanto. Enum fica pronto pra uma proxima variante.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderCode {
    UberDirect,
}

impl ProviderCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderCode::UberDirect => "uber_direct",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "uber_direct" => Some(ProviderCode::UberDirect),
            _ => None,
        }
    }
}

/// Status normalizado -- nunca deixa o status cru do provider vazar pro
/// resto do sistema (frontend, WhatsApp, etc). Bate com o CHECK constraint
/// de `deliveries.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    QuoteRequested,
    Created,
    CourierAssigned,
    EnRouteToPickup,
    PickedUp,
    EnRouteToDropoff,
    Delivered,
    Cancelled,
    Failed,
}

impl DeliveryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            DeliveryStatus::QuoteRequested => "quote_requested",
            DeliveryStatus::Created => "created",
            DeliveryStatus::CourierAssigned => "courier_assigned",
            DeliveryStatus::EnRouteToPickup => "en_route_to_pickup",
            DeliveryStatus::PickedUp => "picked_up",
            DeliveryStatus::EnRouteToDropoff => "en_route_to_dropoff",
            DeliveryStatus::Delivered => "delivered",
            DeliveryStatus::Cancelled => "cancelled",
            DeliveryStatus::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DeliveryAddress {
    pub address: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub name: Option<String>,
    pub phone: Option<String>,
    /// Confirmado por teste real: sem isso a Uber geocodifica errado (ver
    /// 0048_delivery_city_state.sql). `None` faz o provider mandar string
    /// vazia -- funciona, mas arrisca geocodificação ruim.
    pub city: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DeliveryQuoteRequest {
    pub pickup: DeliveryAddress,
    pub dropoff: DeliveryAddress,
    /// Referência pro pedido (aparece no dashboard do provider, quando suportado).
    pub order_reference: String,
}

#[derive(Debug, Clone)]
pub struct DeliveryQuote {
    pub provider: ProviderCode,
    /// Alguns providers (Uber Direct) exigem reenviar o id da cotação na
    /// criação -- guardado aqui, opaco pro resto do sistema.
    pub external_quote_id: Option<String>,
    pub amount: f64,
    pub eta_minutes: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct DeliveryCreateRequest {
    pub quote: DeliveryQuote,
    pub pickup: DeliveryAddress,
    pub dropoff: DeliveryAddress,
    pub order_reference: String,
}

#[derive(Debug, Clone)]
pub struct DeliveryHandle {
    pub external_delivery_id: String,
    pub status: DeliveryStatus,
    pub tracking_url: Option<String>,
    pub provider_cost: Option<f64>,
    pub raw: serde_json::Value,
}

/// Evento normalizado de webhook, já com o `external_event_id` usado pra
/// dedupe em `delivery_webhook_events` (seção 19).
#[derive(Debug, Clone)]
pub struct NormalizedDeliveryEvent {
    pub external_delivery_id: String,
    pub external_event_id: String,
    /// `None` quando o evento não carrega status de entrega (ex.:
    /// `event.refund_request`) -- o webhook route pula o UPDATE nesse caso.
    pub status: Option<DeliveryStatus>,
    pub raw: serde_json::Value,
}

/// Um provider concreto (Uber Direct ou 99Entrega, hoje). Ver comentário no
/// topo do arquivo sobre por que isso é um enum e não `dyn Trait`.
pub enum Provider {
    UberDirect(UberDirectProvider),
}

impl Provider {
    pub fn code(&self) -> ProviderCode {
        match self {
            Provider::UberDirect(_) => ProviderCode::UberDirect,
        }
    }

    pub async fn quote(&self, req: &DeliveryQuoteRequest) -> Result<DeliveryQuote, AppError> {
        match self {
            Provider::UberDirect(p) => p.quote(req).await,
        }
    }

    pub async fn create(&self, req: &DeliveryCreateRequest) -> Result<DeliveryHandle, AppError> {
        match self {
            Provider::UberDirect(p) => p.create(req).await,
        }
    }

    pub async fn get(&self, external_id: &str) -> Result<DeliveryHandle, AppError> {
        match self {
            Provider::UberDirect(p) => p.get(external_id).await,
        }
    }

    pub async fn cancel(&self, external_id: &str) -> Result<(), AppError> {
        match self {
            Provider::UberDirect(p) => p.cancel(external_id).await,
        }
    }
}

/// Política de divergência entre o que o cliente pagou e o custo real do
/// provider (seções 10-12). Nunca gera cobrança nova automaticamente --
/// dentro do limite configurado, segue; fora, marca intervenção necessária.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffOutcome {
    /// Diferença dentro do limite (ou sem limite configurado) -- lojista absorve.
    Absorb,
    /// Diferença maior que `max_auto_diff` -- não seguir em silêncio.
    NeedsIntervention,
}

pub fn delivery_price_diff_policy(
    customer_fee: f64,
    provider_cost: f64,
    max_auto_diff: Option<f64>,
) -> DiffOutcome {
    let diff = (provider_cost - customer_fee).max(0.0);
    match max_auto_diff {
        Some(limit) if diff > limit => DiffOutcome::NeedsIntervention,
        _ => DiffOutcome::Absorb,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_within_limit_absorbs() {
        assert_eq!(delivery_price_diff_policy(15.0, 15.0, Some(5.0)), DiffOutcome::Absorb);
        assert_eq!(delivery_price_diff_policy(15.0, 18.0, Some(5.0)), DiffOutcome::Absorb);
    }

    #[test]
    fn diff_beyond_limit_needs_intervention() {
        assert_eq!(delivery_price_diff_policy(15.0, 42.0, Some(5.0)), DiffOutcome::NeedsIntervention);
    }

    #[test]
    fn no_limit_configured_always_absorbs() {
        assert_eq!(delivery_price_diff_policy(15.0, 500.0, None), DiffOutcome::Absorb);
    }

    #[test]
    fn provider_cheaper_than_customer_fee_absorbs() {
        assert_eq!(delivery_price_diff_policy(15.0, 10.0, Some(1.0)), DiffOutcome::Absorb);
    }

    #[test]
    fn provider_code_roundtrip() {
        assert_eq!(ProviderCode::parse("uber_direct"), Some(ProviderCode::UberDirect));
        assert_eq!(ProviderCode::parse("99entrega"), None);
        assert_eq!(ProviderCode::parse("garbage"), None);
        assert_eq!(ProviderCode::UberDirect.as_str(), "uber_direct");
    }
}
