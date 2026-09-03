//! Decide qual provider chamar e tenta na ordem configurada, nunca em
//! paralelo (seção 5 do pedido). Usado tanto pelo botão manual "Chamar
//! entrega" quanto pelo modo automático (chamado a partir de
//! `status_flow.rs` quando o pedido entra no status de entrega).

use sqlx::PgPool;

use crate::error::AppError;

use super::providers::uber_direct::UberDirectProvider;
use super::{DeliveryAddress, DeliveryCreateRequest, DeliveryHandle, DeliveryQuoteRequest, Provider, ProviderCode};

pub struct DispatchOutcome {
    pub delivery_id: String,
    pub attempt_number: i32,
    pub provider: ProviderCode,
    pub handle: DeliveryHandle,
}

/// Carrega as credenciais de um provider pro tenant e monta a struct
/// concreta. `None` quando o provider não está conectado -- orchestrator
/// trata isso como uma tentativa falha e segue pro próximo da lista.
/// Público pra `routes/delivery.rs` reusar no endpoint de cotação/teste de
/// conexão sem duplicar a lógica de carregar credenciais.
pub async fn build_provider_for_test(
    pool: &PgPool,
    http: &reqwest::Client,
    tenant_id: &str,
    code: ProviderCode,
) -> Option<Provider> {
    build_provider(pool, http, tenant_id, code).await
}

async fn build_provider(
    pool: &PgPool,
    http: &reqwest::Client,
    tenant_id: &str,
    code: ProviderCode,
) -> Option<Provider> {
    match code {
        ProviderCode::UberDirect => {
            let row: Option<(serde_json::Value,)> = sqlx::query_as(
                "SELECT credentials FROM delivery_provider_credentials \
                 WHERE tenant_id = $1 AND provider = 'uber_direct' AND status = 'conectado'",
            )
            .bind(tenant_id)
            .fetch_optional(pool)
            .await
            .ok()?;
            let (creds_json,) = row?;
            let creds = serde_json::from_value(creds_json).ok()?;
            Some(Provider::UberDirect(UberDirectProvider::new(http.clone(), creds)))
        }
    }
}

/// Despacha uma entrega pro pedido, tentando o provider primário e, se
/// falhar, o fallback (se configurado) -- nunca os dois ao mesmo tempo.
/// Idempotente contra corrida: o índice único parcial em `deliveries`
/// garante que só uma chamada concorrente cria a linha; a segunda recebe
/// `AppError::Conflict` em vez de despachar duas entregas reais (seção 30).
pub async fn dispatch(
    pool: &PgPool,
    http: &reqwest::Client,
    tenant_id: &str,
    order_id: &str,
    pickup: DeliveryAddress,
    dropoff: DeliveryAddress,
    customer_delivery_fee: f64,
) -> Result<DispatchOutcome, AppError> {
    let settings: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT mode, primary_provider, fallback_provider FROM tenant_delivery_settings WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    let Some((_mode, primary, fallback)) = settings else {
        return Err(AppError::BadRequest(
            "configure um provider de entrega em Entregas terceirizadas antes de despachar".to_string(),
        ));
    };
    let mut candidates = Vec::new();
    if let Some(p) = primary.as_deref().and_then(ProviderCode::parse) {
        candidates.push(p);
    }
    if let Some(f) = fallback.as_deref().and_then(ProviderCode::parse) {
        if !candidates.contains(&f) {
            candidates.push(f);
        }
    }
    if candidates.is_empty() {
        return Err(AppError::BadRequest(
            "nenhum provider de entrega configurado como primário".to_string(),
        ));
    }

    let delivery_id = uuid::Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO deliveries (id, tenant_id, order_id, status, customer_delivery_fee) \
         VALUES ($1, $2, $3, 'quote_requested', $4) \
         ON CONFLICT (order_id) WHERE status NOT IN ('cancelled', 'failed') DO NOTHING \
         RETURNING id",
    )
    .bind(&delivery_id)
    .bind(tenant_id)
    .bind(order_id)
    .bind(customer_delivery_fee)
    .fetch_optional(pool)
    .await?;
    let Some((delivery_id,)) = inserted else {
        return Err(AppError::Conflict(
            "já existe uma entrega em andamento pra este pedido".to_string(),
        ));
    };

    let order_reference = order_id.to_string();
    let mut attempt_number = 0i32;
    let mut last_error: Option<String> = None;

    for code in candidates {
        attempt_number += 1;
        let attempt_id = uuid::Uuid::new_v4().to_string();

        let Some(provider) = build_provider(pool, http, tenant_id, code).await else {
            record_failed_attempt(pool, &attempt_id, &delivery_id, attempt_number, code, "provider não conectado").await?;
            last_error = Some(format!("{} não conectado", code.as_str()));
            continue;
        };

        let quote_req = DeliveryQuoteRequest {
            pickup: pickup.clone(),
            dropoff: dropoff.clone(),
            order_reference: order_reference.clone(),
        };
        let quote = match provider.quote(&quote_req).await {
            Ok(q) => q,
            Err(e) => {
                record_failed_attempt(pool, &attempt_id, &delivery_id, attempt_number, code, &e.message().to_string()).await?;
                last_error = Some(e.message().to_string());
                continue;
            }
        };

        let create_req = DeliveryCreateRequest {
            quote: quote.clone(),
            pickup: pickup.clone(),
            dropoff: dropoff.clone(),
            order_reference: order_reference.clone(),
        };
        match provider.create(&create_req).await {
            Ok(handle) => {
                record_success_attempt(pool, &attempt_id, &delivery_id, attempt_number, code, &quote, &handle).await?;
                sqlx::query("UPDATE deliveries SET status = $1, updated_at = now()::text WHERE id = $2")
                    .bind(handle.status.as_str())
                    .bind(&delivery_id)
                    .execute(pool)
                    .await?;
                return Ok(DispatchOutcome {
                    delivery_id,
                    attempt_number,
                    provider: code,
                    handle,
                });
            }
            Err(e) => {
                record_failed_attempt(pool, &attempt_id, &delivery_id, attempt_number, code, &e.message().to_string()).await?;
                last_error = Some(e.message().to_string());
            }
        }
    }

    sqlx::query("UPDATE deliveries SET status = 'failed', updated_at = now()::text WHERE id = $1")
        .bind(&delivery_id)
        .execute(pool)
        .await?;
    Err(AppError::BadRequest(format!(
        "não foi possível despachar a entrega — {}",
        last_error.unwrap_or_else(|| "nenhum provider disponível".to_string())
    )))
}

async fn record_failed_attempt(
    pool: &PgPool,
    attempt_id: &str,
    delivery_id: &str,
    attempt_number: i32,
    provider: ProviderCode,
    reason: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO delivery_attempts (id, delivery_id, attempt_number, provider, status, failure_reason, failed_at) \
         VALUES ($1, $2, $3, $4, 'failed', $5, now()::text)",
    )
    .bind(attempt_id)
    .bind(delivery_id)
    .bind(attempt_number)
    .bind(provider.as_str())
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

async fn record_success_attempt(
    pool: &PgPool,
    attempt_id: &str,
    delivery_id: &str,
    attempt_number: i32,
    provider: ProviderCode,
    quote: &super::DeliveryQuote,
    handle: &DeliveryHandle,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO delivery_attempts \
         (id, delivery_id, attempt_number, provider, external_delivery_id, status, quote_amount, provider_cost, raw_response) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(attempt_id)
    .bind(delivery_id)
    .bind(attempt_number)
    .bind(provider.as_str())
    .bind(&handle.external_delivery_id)
    .bind(handle.status.as_str())
    .bind(quote.amount)
    .bind(handle.provider_cost)
    .bind(&handle.raw)
    .execute(pool)
    .await?;
    Ok(())
}
