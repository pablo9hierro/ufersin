//! Webhooks de entrega. Mesmo padrão tolerante do Mercado Pago: assinatura é
//! best-effort (loga, nunca hard-falha), sempre responde 200 pra não gerar
//! retry infinito do provider, e dedupe explícito via
//! `delivery_webhook_events` (seção 19) porque, ao contrário de
//! `payment_status`, uma transição de status de entrega não é naturalmente
//! idempotente.

use axum::{extract::State, http::HeaderMap, Json};

use crate::delivery::providers::uber_direct;
use crate::error::AppError;
use crate::state::AppState;

async fn already_processed(pool: &sqlx::PgPool, provider: &str, external_event_id: &str) -> Result<bool, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO delivery_webhook_events (id, provider, external_event_id, payload) \
         VALUES ($1, $2, $3, '{}'::jsonb) \
         ON CONFLICT (provider, external_event_id) DO NOTHING \
         RETURNING id",
    )
    .bind(&id)
    .bind(provider)
    .bind(external_event_id)
    .fetch_optional(pool)
    .await?;
    Ok(inserted.is_none())
}

pub async fn uber_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Json<serde_json::Value> {
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return Json(serde_json::json!({ "ok": true })),
    };

    let event = match uber_direct::parse_webhook(&payload) {
        Ok(e) => e,
        Err(_) => return Json(serde_json::json!({ "ok": true })),
    };

    let signing_key: Option<String> = sqlx::query_scalar(
        "SELECT credentials->>'webhook_signing_key' FROM delivery_provider_credentials \
         WHERE provider = 'uber_direct' AND credentials->>'webhook_signing_key' IS NOT NULL \
         LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let signature_header = headers.get("X-Uber-Signature").and_then(|v| v.to_str().ok());
    let _signature_ok = uber_direct::verify_signature(signing_key.as_deref(), signature_header, &body);

    match already_processed(&state.pool, "uber_direct", &event.external_event_id).await {
        Ok(true) => return Json(serde_json::json!({ "ok": true, "dedup": true })),
        Ok(false) => {}
        Err(_) => return Json(serde_json::json!({ "ok": true })),
    }

    let _ = sqlx::query(
        "UPDATE deliveries SET status = $1, updated_at = now()::text \
         WHERE id = (SELECT delivery_id FROM delivery_attempts WHERE external_delivery_id = $2 ORDER BY attempt_number DESC LIMIT 1)",
    )
    .bind(event.status.as_str())
    .bind(&event.external_delivery_id)
    .execute(&state.pool)
    .await;

    Json(serde_json::json!({ "ok": true }))
}
