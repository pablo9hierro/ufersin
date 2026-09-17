//! Webhook do Mercado Pago Point/POS -- endpoint dedicado (nunca reusa o
//! path do webhook de Pix/Cartão que já existe). Mesmo padrão tolerante:
//! sempre responde 200 (nunca gera retry-storm), dedupe explícito via
//! `mp_point_webhook_events` (status de Point Order não é naturalmente
//! idempotente por estado, mesmo raciocínio de `delivery_webhooks.rs`).

use axum::{extract::State, Json};

use crate::point::PointOrderStatus;
use crate::state::AppState;

async fn already_processed(pool: &sqlx::PgPool, external_event_id: &str) -> bool {
    let id = uuid::Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO mp_point_webhook_events (id, external_event_id) VALUES ($1, $2) \
         ON CONFLICT (external_event_id) DO NOTHING RETURNING id",
    )
    .bind(&id)
    .bind(external_event_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    inserted.is_none()
}

pub async fn mercadopago_point_webhook(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // Notificação de Orders da Mercado Pago: {"id": "...", "type": "order", "data": {"id": "..."}}
    let event_id = payload
        .get("id")
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())));
    let Some(event_id) = event_id else {
        return Json(serde_json::json!({ "ok": true }));
    };
    if already_processed(&state.pool, &event_id).await {
        return Json(serde_json::json!({ "ok": true, "dedup": true }));
    }

    let Some(mp_order_id) = payload.get("data").and_then(|d| d.get("id")).and_then(|v| v.as_str()) else {
        return Json(serde_json::json!({ "ok": true }));
    };

    // Nunca confia no corpo do webhook como status final -- rebusca a Order
    // de verdade na Mercado Pago antes de gravar qualquer coisa (mesmo
    // princípio do webhook de Pix, `fetch_payment_details`).
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, tenant_id, order_id FROM mp_point_orders WHERE mp_order_id = $1",
    )
    .bind(mp_order_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some((local_id, tenant_id, order_id)) = row else {
        return Json(serde_json::json!({ "ok": true }));
    };

    let payment = match crate::tenant::load_tenant_payment(&state.pool, &tenant_id).await {
        Ok(p) => p,
        Err(_) => return Json(serde_json::json!({ "ok": true })),
    };
    let Some(token) = payment.mp_access_token() else {
        return Json(serde_json::json!({ "ok": true }));
    };

    let Ok(real) = crate::point::client::get_order(&state, token, mp_order_id).await else {
        return Json(serde_json::json!({ "ok": true }));
    };
    let status = PointOrderStatus::from_mp_status(real.status.as_deref().unwrap_or("unknown"));
    let _ = sqlx::query("UPDATE mp_point_orders SET status = $1, updated_at = now()::text WHERE id = $2")
        .bind(status.as_str())
        .bind(&local_id)
        .execute(&state.pool)
        .await;

    // Bandeira/código de autorização pro grupo `card` fiscal (NT 2025.001) --
    // só existem quando o pagamento de fato aprovou; busca o payment_id real
    // dentro da Order (não é o mesmo id da Order) e consulta os detalhes.
    if status.as_str() == "approved" {
        if let (Some(order_id), Some(payment_id)) = (
            &order_id,
            real.transactions.as_ref().and_then(|t| t.payments.first()).map(|p| p.id.as_str()),
        ) {
            if let Ok(details) = crate::mercadopago_link::fetch_payment_details(&state, token, payment_id).await {
                let _ = sqlx::query(
                    "UPDATE orders SET card_brand = $1, card_authorization_code = $2, updated_at = now()::text \
                     WHERE tenant_id = $3 AND id = $4",
                )
                .bind(&details.payment_method_id)
                .bind(&details.authorization_code)
                .bind(&tenant_id)
                .bind(order_id)
                .execute(&state.pool)
                .await;
            }
        }
    }

    Json(serde_json::json!({ "ok": true }))
}
