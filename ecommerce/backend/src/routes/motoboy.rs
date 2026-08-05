use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::auth::{self, MotoboyUser, SunsetMotoboySession};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::google_routes::{self, Ponto};
use crate::models::{
    OrderDto, OrderRow, RequestLocationInput, RequestLocationResult, SkippedOrder,
    UpdateStatusInput,
};
use crate::orders_common::{self, fetch_order_dto, fetch_order_row, row_to_dto};
use crate::state::AppState;
use crate::status_flow;
use crate::tenant;
use crate::whatsapp;

#[derive(Debug, Deserialize)]
pub struct StartRunInput {
    pub order_ids: Vec<String>,
}

/// Calcula a melhor ordem de entrega do lote com distância REAL de rua
/// (Google Routes computeRouteMatrix) e só então chama a RPC
/// sunset.motoboy_start_run já com a ordem pronta — toda a validação de
/// negócio (pedido disponível, motoboy sem corrida ativa etc.) continua
/// morando só na RPC, aqui só decide a ORDEM antes de chamar ela.
///
/// NOTE (Fase 1B pendente): motoboy_start_run é uma RPC Postgres que só
/// existe hoje via supabase/*.sql (não portada pras migrations locais
/// ainda), e o token é repassado pra ela sem decodificar — a RPC faz sua
/// própria validação de sessão. Localmente essa chamada falha até essa RPC
/// ser portada; o resto da função (resolver o tenant e otimizar a rota) já
/// funciona e já está corretamente isolado por tenant.
pub async fn start_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<StartRunInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("missing authorization header".to_string()))?;

    if input.order_ids.is_empty() {
        return Err(AppError::BadRequest("select at least one order to start a run".to_string()));
    }

    let (_motoboy_id, tenant_id) = auth::lookup_session_token(&state.pool, token, &["motoboy"]).await?;
    features::require_feature(&state.pool, &tenant_id, Feature::Motoboy).await?;

    let precomputed = if state.google_routes_key.is_some() {
        match otimizar_com_google(&state, &tenant_id, &input.order_ids).await {
            Ok(ordered) => Some(ordered),
            Err(e) => {
                tracing::warn!("google route optimization failed, falling back to straight-line heuristic: {e:?}");
                None
            }
        }
    } else {
        None
    };

    let run: serde_json::Value = match precomputed {
        Some(ordered) => sqlx::query_scalar("SELECT motoboy_start_run($1, $2, $3)")
            .bind(token)
            .bind(&input.order_ids)
            .bind(&ordered)
            .fetch_one(&state.pool)
            .await?,
        None => sqlx::query_scalar("SELECT motoboy_start_run($1, $2)")
            .bind(token)
            .bind(&input.order_ids)
            .fetch_one(&state.pool)
            .await?,
    };

    Ok(Json(run))
}

async fn otimizar_com_google(
    state: &AppState,
    tenant_id: &str,
    order_ids: &[String],
) -> Result<Vec<String>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, tenant_id).await?;

    let (store_lat, store_lng): (f64, f64) =
        sqlx::query_as("SELECT store_lat, store_lng FROM shipping_settings WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&mut *tx)
            .await?;
    let loja = Ponto { lat: store_lat, lng: store_lng };

    let rows: Vec<(String, f64, f64)> = sqlx::query_as(
        "SELECT id, customer_lat, customer_lng FROM orders \
         WHERE tenant_id = $1 AND id = ANY($2) AND customer_lat IS NOT NULL AND customer_lng IS NOT NULL",
    )
    .bind(tenant_id)
    .bind(order_ids)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    if rows.len() != order_ids.len() {
        return Err(AppError::Internal("some orders are missing coordinates".to_string()));
    }

    let by_id: HashMap<&str, (f64, f64)> = rows.iter().map(|(id, lat, lng)| (id.as_str(), (*lat, *lng))).collect();
    let paradas: Vec<Ponto> = order_ids
        .iter()
        .map(|id| {
            let (lat, lng) = by_id[id.as_str()];
            Ponto { lat, lng }
        })
        .collect();

    let ordem = google_routes::otimizar_ordem_paradas(state, loja, &paradas).await?;
    Ok(ordem.into_iter().map(|i| order_ids[i].clone()).collect())
}

#[derive(Debug, Deserialize)]
pub struct OrdersQuery {
    pub status: String,
}

pub async fn list_orders(
    State(state): State<AppState>,
    MotoboyUser(claims): MotoboyUser,
    Query(q): Query<OrdersQuery>,
) -> Result<Json<Vec<OrderDto>>, AppError> {
    if !matches!(
        q.status.as_str(),
        "pedido_pronto" | "aguardando_localizacao" | "em_rota_de_entrega" | "concluido"
    ) {
        return Err(AppError::BadRequest("invalid status filter".to_string()));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<OrderRow> = if q.status == "pedido_pronto" {
        sqlx::query_as(
            "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'entrega' \
             AND status = 'pedido_pronto' AND motoboy_id IS NULL ORDER BY created_at ASC",
        )
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?
    } else if q.status == "em_rota_de_entrega" {
        // "entregue" is a short-lived transitional status (payment confirmation
        // may still be pending for non-pix orders) — it's shown in the same tab
        // as "em rota" so the motoboy can find it and finish the "Concluir" step.
        sqlx::query_as(
            "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'entrega' \
             AND status IN ('em_rota_de_entrega', 'entregue') AND motoboy_id = $2 \
             ORDER BY created_at DESC",
        )
        .bind(&claims.tenant_id)
        .bind(&claims.sub)
        .fetch_all(&mut *tx)
        .await?
    } else {
        sqlx::query_as(
            "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'entrega' AND status = $2 \
             AND motoboy_id = $3 ORDER BY created_at DESC",
        )
        .bind(&claims.tenant_id)
        .bind(&q.status)
        .bind(&claims.sub)
        .fetch_all(&mut *tx)
        .await?
    };

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }
    tx.commit().await?;
    Ok(Json(result))
}

pub async fn request_location(
    State(state): State<AppState>,
    MotoboyUser(claims): MotoboyUser,
    Json(input): Json<RequestLocationInput>,
) -> Result<Json<RequestLocationResult>, AppError> {
    let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let mut updated = Vec::new();
    let mut skipped = Vec::new();

    for order_id in input.order_ids {
        let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
        let Some(order) = fetch_order_row(&mut *tx, &claims.tenant_id, &order_id).await? else {
            skipped.push(SkippedOrder {
                id: order_id,
                reason: "order not found".to_string(),
            });
            continue;
        };

        if order.delivery_type != "entrega" {
            skipped.push(SkippedOrder {
                id: order_id,
                reason: "order is not a delivery order".to_string(),
            });
            continue;
        }
        if order.status != "pedido_pronto" {
            skipped.push(SkippedOrder {
                id: order_id,
                reason: format!("order is not in pedido_pronto (currently {})", order.status),
            });
            continue;
        }
        if order.motoboy_id.is_some() {
            skipped.push(SkippedOrder {
                id: order_id,
                reason: "order already assigned to a motoboy".to_string(),
            });
            continue;
        }

        sqlx::query(
            "UPDATE orders SET motoboy_id = $1, status = 'aguardando_localizacao', updated_at = now()::text \
             WHERE tenant_id = $2 AND id = $3",
        )
        .bind(&claims.sub)
        .bind(&claims.tenant_id)
        .bind(&order_id)
        .execute(&mut *tx)
        .await?;

        let digits = whatsapp::digits_only(&order.customer_whatsapp);
        let msg = format!(
            "Olá {}! Para agilizar sua entrega, envie sua localização atual aqui no WhatsApp 📍",
            order.customer_name
        );
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);

        let dto = fetch_order_dto(&mut tx, &claims.tenant_id, &order_id)
            .await?
            .ok_or_else(|| AppError::Internal("order vanished".to_string()))?;
        tx.commit().await?;
        updated.push(dto);
    }

    Ok(Json(RequestLocationResult { updated, skipped }))
}

pub async fn update_order_status(
    State(state): State<AppState>,
    MotoboyUser(claims): MotoboyUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateStatusInput>,
) -> Result<Json<OrderDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let Some(order) = fetch_order_row(&mut *tx, &claims.tenant_id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if order.motoboy_id.as_deref() != Some(claims.sub.as_str()) {
        return Err(AppError::Forbidden("order is not assigned to you".to_string()));
    }

    let set_paid = status_flow::motoboy_apply_transition(
        &order.status,
        &input.status,
        &order.payment_method,
        &order.payment_status,
        input.payment_confirmed,
    )?;

    if set_paid {
        sqlx::query(
            "UPDATE orders SET status = $1, payment_status = 'pago', updated_at = now()::text \
             WHERE tenant_id = $2 AND id = $3",
        )
        .bind(&input.status)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        // Only now — payment just got confirmed by the motoboy on delivery.
        orders_common::decrement_stock_for_order(&mut *tx, &claims.tenant_id, &id).await?;
    } else {
        sqlx::query(
            "UPDATE orders SET status = $1, updated_at = now()::text WHERE tenant_id = $2 AND id = $3",
        )
        .bind(&input.status)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }

    if input.status == "em_rota_de_entrega" {
        let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
        let digits = whatsapp::digits_only(&order.customer_whatsapp);
        whatsapp::notify(
            &state,
            &store.whatsapp_instance,
            &digits,
            "Seu pedido acabou de sair para entrega! Aguarde no local informado 🛵",
        );
    }

    let dto = fetch_order_dto(&mut tx, &claims.tenant_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

// ---------- WhatsApp (Evolution API) — own instance per motoboy ----------
//
// Each motoboy gets their own Evolution API instance ("motoboy-<id>"),
// separate from the store's own, so location-request messages go out from
// the motoboy's own number. Auth via SunsetMotoboySession (checks
// sunset.sessions directly), same reasoning as SunsetAdminSession.

fn motoboy_instance_name(motoboy_id: &str) -> String {
    format!("motoboy-{motoboy_id}")
}

pub async fn whatsapp_status(
    State(state): State<AppState>,
    session: SunsetMotoboySession,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Motoboy).await?;
    let instance = motoboy_instance_name(&session.subject_id);
    Ok(Json(whatsapp::connection_status(&state, &instance).await?))
}

pub async fn whatsapp_connect(
    State(state): State<AppState>,
    session: SunsetMotoboySession,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Motoboy).await?;
    let instance = motoboy_instance_name(&session.subject_id);
    Ok(Json(whatsapp::connect(&state, &instance).await?))
}

pub async fn whatsapp_logout(
    State(state): State<AppState>,
    session: SunsetMotoboySession,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Motoboy).await?;
    let instance = motoboy_instance_name(&session.subject_id);
    whatsapp::logout(&state, &instance).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Notifications sent from the motoboy's own instance ----------
//
// Message text is always built here from the order + motoboy rows (never
// trusted from the client), the same way the store-side ones in
// admin.rs/public.rs work.

async fn motoboy_name(state: &AppState, tenant_id: &str, motoboy_id: &str) -> Result<String, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, tenant_id).await?;
    let row: Option<(String,)> = sqlx::query_as("SELECT name FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(tenant_id)
        .bind(motoboy_id)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(row.map(|(n,)| n).unwrap_or_else(|| "seu entregador".to_string()))
}

#[derive(Debug, Deserialize)]
pub struct NotifyLocationRequestInput {
    pub order_ids: Vec<String>,
}

/// Sent right after sunset.motoboy_request_location already updated the DB
/// (that RPC only touches the database; this is the actual WhatsApp send).
pub async fn notify_location_request(
    State(state): State<AppState>,
    session: SunsetMotoboySession,
    Json(input): Json<NotifyLocationRequestInput>,
) -> Result<StatusCode, AppError> {
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    let instance = motoboy_instance_name(&session.subject_id);
    let name = motoboy_name(&state, &session.tenant_id, &session.subject_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &session.tenant_id).await?;
    for order_id in input.order_ids {
        let Some(order) = fetch_order_row(&mut *tx, &session.tenant_id, &order_id).await? else {
            continue;
        };
        let digits = whatsapp::digits_only(&order.customer_whatsapp);
        let msg = format!(
            "Olá, {}!\n\nSou {name}, entregador da {} 🛵\nPor gentileza, me envia sua localização fixa aqui no WhatsApp pra eu poder iniciar a corrida de entrega até você.",
            order.customer_name, store.name
        );
        whatsapp::notify(&state, &instance, &digits, &msg);
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct NotifyEnRouteInput {
    pub order_id: String,
}

/// Sent when the motoboy starts a delivery run (order moves straight to
/// em_rota_de_entrega — see sunset.motoboy_start_run). Includes a tracking
/// link so the customer can watch the delivery live on /consultar.
pub async fn notify_en_route(
    State(state): State<AppState>,
    session: SunsetMotoboySession,
    Json(input): Json<NotifyEnRouteInput>,
) -> Result<StatusCode, AppError> {
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    let instance = motoboy_instance_name(&session.subject_id);
    let name = motoboy_name(&state, &session.tenant_id, &session.subject_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &session.tenant_id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &session.tenant_id, &input.order_id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    tx.commit().await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = if state.frontend_public_url.is_empty() {
        format!(
            "Olá, {}! Aqui é {name}, seu entregador da {} 🛵 Já estou a caminho, chego jajá!",
            order.customer_name, store.name
        )
    } else {
        format!(
            "Olá, {}! Aqui é {name}, seu entregador da {} 🛵 Já estou a caminho, chego jajá!\n\nAcompanhe a entrega em tempo real: {}/consultar?order={}",
            order.customer_name,
            store.name,
            state.frontend_public_url.trim_end_matches('/'),
            order.id
        )
    };
    whatsapp::notify(&state, &instance, &digits, &msg);
    Ok(StatusCode::NO_CONTENT)
}
