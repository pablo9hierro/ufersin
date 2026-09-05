//! Entregas terceirizadas (Uber Direct) pra coleta/entrega de aparelho em
//! reparo -- espelha `routes/delivery.rs`, mas o "dono" da entrega é uma
//! `eletronicos.service_requests` em vez de um `orders`. Reaproveita 100%
//! do orchestrator/provider (ver `delivery/orchestrator.rs::DeliverableRef`
//! e migration 0049) -- só a origem do endereço/telefone muda.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use crate::auth::AdminUser;
use crate::delivery::{self, orchestrator, DeliveryAddress};
use crate::error::AppError;
use crate::routes::delivery::require_beta;
use crate::state::AppState;

/// "coleta" = buscar o aparelho na casa do cliente (pickup = cliente,
/// dropoff = loja). "entrega" = devolver o aparelho consertado (pickup =
/// loja, dropoff = cliente) -- direção invertida em relação ao fluxo de
/// `orders`, que só entrega.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Coleta,
    Entrega,
}

#[derive(Debug, Deserialize)]
pub struct DirectionQuery {
    pub direction: Direction,
}

struct ServiceRequestAddresses {
    customer_name: String,
    customer_phone: String,
    address: String,
    lat: Option<f64>,
    lng: Option<f64>,
    city: Option<String>,
    state: Option<String>,
    shipping_price: Option<f64>,
}

async fn load_service_request(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    id: &str,
) -> Result<ServiceRequestAddresses, AppError> {
    let row: Option<(String, String, Option<String>, Option<f64>, Option<f64>, Option<String>, Option<String>, Option<f64>)> =
        sqlx::query_as(
            "SELECT customer_name, customer_phone, address_label, address_lat, address_lng, \
                    address_city, address_state, estimated_quote_value::float8 \
             FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(tenant_id)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    let Some((customer_name, customer_phone, address, lat, lng, city, state, shipping_price)) = row else {
        return Err(AppError::NotFound("solicitação de serviço não encontrada".to_string()));
    };
    Ok(ServiceRequestAddresses {
        customer_name,
        customer_phone,
        address: address.unwrap_or_default(),
        lat,
        lng,
        city,
        state,
        shipping_price,
    })
}

/// Mesma ideia de `routes/delivery.rs::load_addresses`, mas com direção:
/// coleta busca na casa do cliente (pickup=cliente, dropoff=loja), entrega
/// devolve o aparelho (pickup=loja, dropoff=cliente).
async fn load_addresses(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    service_request_id: &str,
    direction: Direction,
) -> Result<(DeliveryAddress, DeliveryAddress, f64), AppError> {
    let sr = load_service_request(pool, tenant_id, service_request_id).await?;

    let store_row: Option<(String, Option<f64>, Option<f64>, String)> = sqlx::query_as(
        "SELECT t.name, s.store_lat, s.store_lng, s.store_address \
         FROM tenants t LEFT JOIN eletronicos.shipping_settings s ON s.tenant_id = t.id \
         WHERE t.id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    let (store_name, store_lat, store_lng, store_address) =
        store_row.unwrap_or(("Loja".to_string(), None, None, String::new()));

    let org_phone: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(o.phone, '') FROM tenants t JOIN organizations o ON o.id = t.organization_id WHERE t.id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    let store_phone = {
        let digits = crate::whatsapp::digits_only(&org_phone.map(|(p,)| p).unwrap_or_default());
        if digits.is_empty() { None } else { Some(format!("+{digits}")) }
    };
    let customer_phone = format!("+{}", crate::whatsapp::digits_only(&sr.customer_phone));

    // Reaproveita cidade/estado configurados em Entregas terceirizadas
    // (tenant_delivery_settings) só como fallback pro lado da loja quando o
    // service_request não tiver os próprios preenchidos.
    let (fallback_city, fallback_state): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT pickup_city, pickup_state FROM tenant_delivery_settings WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or((None, None));

    let store_addr = DeliveryAddress {
        address: store_address,
        lat: store_lat,
        lng: store_lng,
        name: Some(store_name),
        phone: store_phone,
        city: sr.city.clone().or_else(|| fallback_city.clone()),
        state: sr.state.clone().or_else(|| fallback_state.clone()),
    };
    let customer_addr = DeliveryAddress {
        address: sr.address,
        lat: sr.lat,
        lng: sr.lng,
        name: Some(sr.customer_name),
        phone: Some(customer_phone),
        city: sr.city.or(fallback_city),
        state: sr.state.or(fallback_state),
    };

    let fee = sr.shipping_price.unwrap_or(0.0);
    Ok(match direction {
        Direction::Coleta => (customer_addr, store_addr, fee),
        Direction::Entrega => (store_addr, customer_addr, fee),
    })
}

pub async fn quote_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Query(q): Query<DirectionQuery>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let (pickup, dropoff, _fee) = load_addresses(&state.pool, &claims.tenant_id, &id, q.direction).await?;

    let settings: Option<(Option<String>,)> =
        sqlx::query_as("SELECT primary_provider FROM tenant_delivery_settings WHERE tenant_id = $1")
            .bind(&claims.tenant_id)
            .fetch_optional(&state.pool)
            .await?;
    let Some(code) = settings.and_then(|(p,)| p).as_deref().and_then(crate::delivery::ProviderCode::parse) else {
        return Ok(Json(vec![serde_json::json!({ "error": "nenhum provider configurado" })]));
    };
    let req = delivery::DeliveryQuoteRequest { pickup, dropoff, order_reference: id.clone() };
    let Some(provider) = orchestrator::build_provider_for_test(&state.pool, &state.http, &claims.tenant_id, code).await
    else {
        return Ok(Json(vec![serde_json::json!({ "provider": code.as_str(), "error": "não conectado" })]));
    };
    match provider.quote(&req).await {
        Ok(q) => Ok(Json(vec![serde_json::json!({
            "provider": code.as_str(), "amount": q.amount, "eta_minutes": q.eta_minutes,
        })])),
        Err(e) => Ok(Json(vec![serde_json::json!({ "provider": code.as_str(), "error": e.message() })])),
    }
}

pub async fn dispatch_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Query(q): Query<DirectionQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let (pickup, dropoff, fee) = load_addresses(&state.pool, &claims.tenant_id, &id, q.direction).await?;

    let outcome = orchestrator::dispatch(
        &state.pool,
        &state.http,
        &claims.tenant_id,
        orchestrator::DeliverableRef::ServiceRequest(&id),
        pickup,
        dropoff,
        fee,
    )
    .await?;

    Ok(Json(serde_json::json!({
        "delivery_id": outcome.delivery_id,
        "provider": outcome.provider.as_str(),
        "attempt_number": outcome.attempt_number,
        "status": outcome.handle.status.as_str(),
        "tracking_url": outcome.handle.tracking_url,
    })))
}

pub async fn get_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, status FROM deliveries WHERE tenant_id = $1 AND service_request_id = $2::uuid ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((delivery_id, status)) = row else {
        return Err(AppError::NotFound("nenhuma entrega despachada pra esta solicitação".to_string()));
    };
    let attempts: Vec<(i32, String, Option<String>, String, Option<f64>, Option<f64>, Option<String>)> = sqlx::query_as(
        "SELECT attempt_number, provider, external_delivery_id, status, quote_amount, provider_cost, failure_reason \
         FROM delivery_attempts WHERE delivery_id = $1 ORDER BY attempt_number",
    )
    .bind(&delivery_id)
    .fetch_all(&state.pool)
    .await?;
    let provider = attempts.last().map(|a| a.1.clone());
    let attempts_json: Vec<_> = attempts
        .into_iter()
        .map(|(n, provider, ext_id, status, quote, cost, reason)| {
            serde_json::json!({
                "attempt_number": n, "provider": provider, "external_delivery_id": ext_id,
                "status": status, "quote_amount": quote, "provider_cost": cost, "failure_reason": reason,
            })
        })
        .collect();
    Ok(Json(serde_json::json!({
        "delivery_id": delivery_id, "status": status, "provider": provider, "attempts": attempts_json,
    })))
}

pub async fn cancel_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM deliveries WHERE tenant_id = $1 AND service_request_id = $2::uuid AND status NOT IN ('cancelled','failed','delivered')",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((delivery_id,)) = row else {
        return Err(AppError::NotFound("nenhuma entrega ativa pra cancelar".to_string()));
    };
    let attempt: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT provider, external_delivery_id FROM delivery_attempts \
         WHERE delivery_id = $1 AND status != 'failed' ORDER BY attempt_number DESC LIMIT 1",
    )
    .bind(&delivery_id)
    .fetch_optional(&state.pool)
    .await?;
    if let Some((provider, Some(external_id))) = attempt {
        if let Some(code) = crate::delivery::ProviderCode::parse(&provider) {
            if let Some(provider_impl) =
                orchestrator::build_provider_for_test(&state.pool, &state.http, &claims.tenant_id, code).await
            {
                provider_impl.cancel(&external_id).await?;
            }
        }
    }
    sqlx::query("UPDATE deliveries SET status = 'cancelled', updated_at = now()::text WHERE id = $1")
        .bind(&delivery_id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Chamado por `update_service_request_status` quando o modo é automático:
/// `em_busca` -> despacha coleta, `em_entrega` -> despacha entrega. Erros
/// aqui nunca bloqueiam a troca de status em si (fire-and-forget, mesmo
/// espírito do WhatsApp -- lojista sempre pode despachar manualmente
/// depois se a automática falhar).
pub async fn maybe_auto_dispatch(pool: &sqlx::PgPool, http: &reqwest::Client, tenant_id: &str, service_request_id: &str, new_status: &str) {
    let direction = match new_status {
        "em_busca" => Direction::Coleta,
        "em_entrega" => Direction::Entrega,
        _ => return,
    };
    let mode: Option<(String,)> =
        sqlx::query_as("SELECT mode FROM tenant_delivery_settings WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    if mode.map(|(m,)| m).as_deref() != Some("automatico") {
        return;
    }
    let Ok((pickup, dropoff, fee)) = load_addresses(pool, tenant_id, service_request_id, direction).await else {
        tracing::warn!("auto-dispatch: não foi possível montar endereços pra service_request {service_request_id}");
        return;
    };
    if let Err(e) = orchestrator::dispatch(
        pool,
        http,
        tenant_id,
        orchestrator::DeliverableRef::ServiceRequest(service_request_id),
        pickup,
        dropoff,
        fee,
    )
    .await
    {
        tracing::warn!("auto-dispatch falhou pra service_request {service_request_id}: {}", e.message());
    }
}
