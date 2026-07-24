use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::Value;

use crate::abacatepay_gateway;
use crate::state::AppState;

/// Webhook da AbacatePay — preparado, sem tráfego real ainda (gateway em
/// modo mock até ter credencial). Sempre responde 200 pra AbacatePay nunca
/// retry-stormar por eventos que não reconhecemos, mesmo padrão já usado
/// no motor de e-commerce pro webhook da Evolution API.
pub async fn abacatepay_webhook(State(state): State<AppState>, Json(payload): Json<Value>) -> StatusCode {
    let Some((external_id, status)) = abacatepay_gateway::handle_webhook(&payload).await else {
        return StatusCode::OK;
    };
    if status != "PAID" {
        return StatusCode::OK;
    }

    let result = sqlx::query(
        "UPDATE subscribers SET status = 'ativo', \
         onboarding_status = CASE WHEN onboarding_status = 'aguardando_pagamento' THEN 'aguardando_onboarding' ELSE onboarding_status END, \
         updated_at = now() WHERE mp_preapproval_id = $1",
    )
    .bind(&external_id)
    .execute(&state.pool)
    .await;

    if let Err(e) = result {
        tracing::warn!("abacatepay webhook: failed to update subscriber for charge {external_id}: {e:?}");
    }

    StatusCode::OK
}
