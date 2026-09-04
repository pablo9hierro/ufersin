//! Admin-facing: configuração de entregas terceirizadas + despacho por
//! pedido. Tudo atrás de `AdminUser` (tenant isolado pelas claims) +
//! `Feature::EntregaTerceirizada` (liberado só por linha em `feature_flags`
//! -- nunca por hardcode de slug/tenant aqui).

use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AdminUser;
use crate::delivery::{self, orchestrator, DeliveryAddress, ProviderCode};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::orders_common;
use crate::state::AppState;
use crate::tenant;

async fn require_beta(pool: &sqlx::PgPool, tenant_id: &str) -> Result<(), AppError> {
    features::require_feature(pool, tenant_id, Feature::EntregaTerceirizada).await
}

#[derive(Debug, Serialize)]
pub struct DeliverySettingsDto {
    pub mode: String,
    pub primary_provider: Option<String>,
    pub fallback_provider: Option<String>,
    pub max_auto_diff: Option<f64>,
    pub providers: Vec<ProviderStatusDto>,
}

#[derive(Debug, Serialize)]
pub struct ProviderStatusDto {
    pub provider: String,
    pub status: String,
    pub connected_at: Option<String>,
}

pub async fn get_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<DeliverySettingsDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let settings: Option<(String, Option<String>, Option<String>, Option<f64>)> = sqlx::query_as(
        "SELECT mode, primary_provider, fallback_provider, max_auto_diff \
         FROM tenant_delivery_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let (mode, primary_provider, fallback_provider, max_auto_diff) =
        settings.unwrap_or(("manual".to_string(), None, None, None));

    let providers: Vec<ProviderStatusDto> = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT provider, status, connected_at FROM delivery_provider_credentials WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|(provider, status, connected_at)| ProviderStatusDto { provider, status, connected_at })
    .collect();

    Ok(Json(DeliverySettingsDto { mode, primary_provider, fallback_provider, max_auto_diff, providers }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateDeliverySettingsInput {
    pub mode: String,
    pub primary_provider: Option<String>,
    pub fallback_provider: Option<String>,
    pub max_auto_diff: Option<f64>,
}

pub async fn update_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<UpdateDeliverySettingsInput>,
) -> Result<Json<DeliverySettingsDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if !matches!(body.mode.as_str(), "manual" | "automatico") {
        return Err(AppError::BadRequest("mode deve ser 'manual' ou 'automatico'".to_string()));
    }
    for p in [body.primary_provider.as_deref(), body.fallback_provider.as_deref()].into_iter().flatten() {
        if ProviderCode::parse(p).is_none() {
            return Err(AppError::BadRequest(format!("provider inválido: {p}")));
        }
    }
    if let Some(diff) = body.max_auto_diff {
        if !diff.is_finite() || diff < 0.0 {
            return Err(AppError::BadRequest("max_auto_diff deve ser um número não-negativo".to_string()));
        }
    }
    sqlx::query(
        "INSERT INTO tenant_delivery_settings (tenant_id, mode, primary_provider, fallback_provider, max_auto_diff) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
           mode = EXCLUDED.mode, primary_provider = EXCLUDED.primary_provider, \
           fallback_provider = EXCLUDED.fallback_provider, max_auto_diff = EXCLUDED.max_auto_diff, \
           updated_at = now()::text",
    )
    .bind(&claims.tenant_id)
    .bind(&body.mode)
    .bind(&body.primary_provider)
    .bind(&body.fallback_provider)
    .bind(body.max_auto_diff)
    .execute(&state.pool)
    .await?;

    get_settings(State(state), AdminUser(claims)).await
}

#[derive(Debug, Deserialize)]
pub struct SaveCredentialsInput {
    /// Formato livre por provider -- pra Uber Direct: client_id,
    /// client_secret, customer_id, webhook_signing_key (opcional). Nunca
    /// devolvido de volta pro frontend em texto puro.
    pub credentials: serde_json::Value,
}

pub async fn save_credentials(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(provider): Path<String>,
    Json(body): Json<SaveCredentialsInput>,
) -> Result<Json<ProviderStatusDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let Some(code) = ProviderCode::parse(&provider) else {
        return Err(AppError::BadRequest(format!("provider inválido: {provider}")));
    };
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO delivery_provider_credentials (id, tenant_id, provider, credentials, status, connected_at) \
         VALUES ($1, $2, $3, $4, 'conectado', now()::text) \
         ON CONFLICT (tenant_id, provider) DO UPDATE SET \
           credentials = EXCLUDED.credentials, status = 'conectado', connected_at = now()::text, updated_at = now()::text",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(code.as_str())
    .bind(&body.credentials)
    .execute(&state.pool)
    .await?;
    Ok(Json(ProviderStatusDto {
        provider: code.as_str().to_string(),
        status: "conectado".to_string(),
        connected_at: Some(chrono::Utc::now().to_rfc3339()),
    }))
}

/// "Testar conexão" -- pra Uber Direct, tenta buscar um token OAuth (não
/// cria nada).
pub async fn test_connection(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(provider): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let Some(code) = ProviderCode::parse(&provider) else {
        return Err(AppError::BadRequest(format!("provider inválido: {provider}")));
    };
    let quote_probe = delivery::DeliveryQuoteRequest {
        pickup: DeliveryAddress { address: "probe".to_string(), lat: Some(0.0), lng: Some(0.0), name: None, phone: None },
        dropoff: DeliveryAddress { address: "probe".to_string(), lat: Some(0.0), lng: Some(0.0), name: None, phone: None },
        order_reference: "connection-test".to_string(),
    };
    let provider_impl = orchestrator::build_provider_for_test(&state.pool, &state.http, &claims.tenant_id, code)
        .await
        .ok_or_else(|| AppError::BadRequest(format!("{} não conectado", code.as_str())))?;
    match provider_impl.quote(&quote_probe).await {
        Ok(_) => Ok(Json(serde_json::json!({ "ok": true }))),
        Err(e) => Err(e),
    }
}

fn tenant_id_str(claims: &crate::auth::Claims) -> &str {
    &claims.tenant_id
}

async fn load_addresses(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    order: &crate::models::OrderRow,
) -> Result<(DeliveryAddress, DeliveryAddress), AppError> {
    let store: Option<(Option<f64>, Option<f64>)> =
        sqlx::query_as("SELECT store_lat, store_lng FROM shipping_settings WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_optional(pool)
            .await?;
    let tenant_row: Option<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT t.name, t.pickup_address, COALESCE(o.phone, '') \
         FROM tenants t JOIN organizations o ON o.id = t.organization_id \
         WHERE t.id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    let (store_lat, store_lng) = store.unwrap_or((None, None));
    let (tenant_name, pickup_address, org_phone) =
        tenant_row.unwrap_or(("Loja".to_string(), None, String::new()));

    // Uber Direct exige telefone no formato "+<dígitos>" (regex
    // ^\+[0-9]+$) tanto pra pickup quanto dropoff -- normaliza os dois do
    // mesmo jeito que o resto do backend já normaliza WhatsApp
    // (`whatsapp::digits_only`), só prefixando o "+".
    let pickup_phone = {
        let digits = crate::whatsapp::digits_only(&org_phone);
        if digits.is_empty() { None } else { Some(format!("+{digits}")) }
    };
    let dropoff_phone = format!("+{}", crate::whatsapp::digits_only(&order.customer_whatsapp));

    let pickup = DeliveryAddress {
        address: pickup_address.unwrap_or_default(),
        lat: store_lat,
        lng: store_lng,
        name: Some(tenant_name),
        phone: pickup_phone,
    };
    let dropoff = DeliveryAddress {
        address: order.address.clone().unwrap_or_default(),
        lat: order.customer_lat,
        lng: order.customer_lng,
        name: Some(order.customer_name.clone()),
        phone: Some(dropoff_phone),
    };
    Ok((pickup, dropoff))
}

pub async fn quote_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let tenant_id = tenant_id_str(&claims).to_string();
    let mut tx = tenant::tenant_tx(&state.pool, &tenant_id).await?;
    let order = orders_common::fetch_order_row(&mut *tx, &tenant_id, &order_id)
        .await?
        .ok_or_else(|| AppError::NotFound("pedido não encontrado".to_string()))?;
    tx.commit().await?;
    let (pickup, dropoff) = load_addresses(&state.pool, &tenant_id, &order).await?;

    let settings: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT primary_provider, fallback_provider FROM tenant_delivery_settings WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_optional(&state.pool)
            .await?;
    let (primary, fallback) = settings.unwrap_or((None, None));
    let mut codes: Vec<ProviderCode> = [primary, fallback]
        .into_iter()
        .flatten()
        .filter_map(|s| ProviderCode::parse(&s))
        .collect();
    if codes.is_empty() {
        codes = vec![ProviderCode::UberDirect];
    }

    let mut results = Vec::new();
    for code in codes {
        let req = delivery::DeliveryQuoteRequest {
            pickup: pickup.clone(),
            dropoff: dropoff.clone(),
            order_reference: order_id.clone(),
        };
        let Some(provider) = orchestrator::build_provider_for_test(&state.pool, &state.http, &tenant_id, code).await
        else {
            results.push(serde_json::json!({ "provider": code.as_str(), "error": "não conectado" }));
            continue;
        };
        match provider.quote(&req).await {
            Ok(q) => results.push(serde_json::json!({
                "provider": code.as_str(),
                "amount": q.amount,
                "eta_minutes": q.eta_minutes,
            })),
            Err(e) => results.push(serde_json::json!({ "provider": code.as_str(), "error": e.message().to_string() })),
        }
    }
    Ok(Json(results))
}

pub async fn dispatch_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let tenant_id = tenant_id_str(&claims).to_string();
    let mut tx = tenant::tenant_tx(&state.pool, &tenant_id).await?;
    let order = orders_common::fetch_order_row(&mut *tx, &tenant_id, &order_id)
        .await?
        .ok_or_else(|| AppError::NotFound("pedido não encontrado".to_string()))?;
    tx.commit().await?;
    let (pickup, dropoff) = load_addresses(&state.pool, &tenant_id, &order).await?;

    let outcome = orchestrator::dispatch(
        &state.pool,
        &state.http,
        &tenant_id,
        &order_id,
        pickup,
        dropoff,
        order.shipping_price,
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

#[derive(Debug, Serialize)]
pub struct DeliveryStatusDto {
    pub delivery_id: String,
    pub status: String,
    pub provider: Option<String>,
    pub attempts: Vec<serde_json::Value>,
}

pub async fn get_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<DeliveryStatusDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, status FROM deliveries WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at DESC LIMIT 1")
            .bind(&claims.tenant_id)
            .bind(&order_id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((delivery_id, status)) = row else {
        return Err(AppError::NotFound("nenhuma entrega despachada pra este pedido".to_string()));
    };
    let attempts: Vec<(i32, String, Option<String>, String, Option<f64>, Option<f64>, Option<String>)> = sqlx::query_as(
        "SELECT attempt_number, provider, external_delivery_id, status, quote_amount, provider_cost, failure_reason \
         FROM delivery_attempts WHERE delivery_id = $1 ORDER BY attempt_number",
    )
    .bind(&delivery_id)
    .fetch_all(&state.pool)
    .await?;
    let last_provider = attempts.last().map(|a| a.1.clone());
    let attempts_json = attempts
        .into_iter()
        .map(|(n, provider, ext_id, status, quote, cost, reason)| {
            serde_json::json!({
                "attempt_number": n, "provider": provider, "external_delivery_id": ext_id,
                "status": status, "quote_amount": quote, "provider_cost": cost, "failure_reason": reason,
            })
        })
        .collect();
    Ok(Json(DeliveryStatusDto { delivery_id, status, provider: last_provider, attempts: attempts_json }))
}

pub async fn cancel_delivery(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM deliveries WHERE tenant_id = $1 AND order_id = $2 AND status NOT IN ('cancelled','failed','delivered')",
    )
    .bind(&claims.tenant_id)
    .bind(&order_id)
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
        if let Some(code) = ProviderCode::parse(&provider) {
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
