use axum::extract::{Multipart, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{hash_password, AdminTenant, AdminUser};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::models::{
    Category, CategoryInput, FinanceiroSummary, LucroSummary, MotoboyDto, MotoboyInput, MotoboyRow,
    OrderDto, OrderRow, ProductDto, ProductInput, ProductRow, SetStoreHoursInput,
    SetStoreManualStatusInput, StatusCount, StoreHourDay, StoreHourInterval, StoreStatusDto,
    TopProduct, UpdateStatusInput,
};
use crate::orders_common::row_to_dto;
use crate::state::AppState;
use crate::status_flow;
use crate::storage;
use crate::tenant;
use crate::whatsapp;

// ---------- Categories ----------

pub async fn list_categories(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<Category>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<Category> = sqlx::query_as("SELECT id, name FROM categories WHERE tenant_id = $1 ORDER BY name")
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn create_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CategoryInput>,
) -> Result<Json<Category>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(&claims.tenant_id)
        .bind(&input.name)
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                AppError::BadRequest("category name already exists".to_string())
            }
            other => other.into(),
        })?;
    tx.commit().await?;
    Ok(Json(Category { id, name: input.name }))
}

pub async fn update_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CategoryInput>,
) -> Result<Json<Category>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("UPDATE categories SET name = $1 WHERE tenant_id = $2 AND id = $3")
        .bind(&input.name)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("category not found".to_string()));
    }
    tx.commit().await?;
    Ok(Json(Category { id, name: input.name }))
}

pub async fn delete_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM categories WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("category not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Products ----------

const PRODUCT_SELECT: &str = "SELECT p.*, c.name as category_name FROM products p \
    LEFT JOIN categories c ON c.id = p.category_id";

pub async fn list_products(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<ProductDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProductRow> =
        sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 ORDER BY p.name"))
            .bind(&claims.tenant_id)
            .fetch_all(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(ProductDto::from).collect()))
}

pub async fn get_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<ProductDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<ProductRow> =
        sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
            .bind(&claims.tenant_id)
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    tx.commit().await?;
    match row {
        Some(r) => Ok(Json(r.into())),
        None => Err(AppError::NotFound("product not found".to_string())),
    }
}

pub async fn create_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<ProductInput>,
) -> Result<Json<ProductDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.active.unwrap_or(true);
    let barcode = input
        .barcode
        .as_ref()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active, cost_price, low_stock_threshold, barcode) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.name)
    .bind(&input.description)
    .bind(input.price)
    .bind(input.quantity)
    .bind(&input.image_url)
    .bind(&input.category_id)
    .bind(active as i64)
    .bind(input.cost_price)
    .bind(input.low_stock_threshold)
    .bind(&barcode)
    .execute(&mut *tx)
    .await?;

    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<ProductInput>,
) -> Result<Json<ProductDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let active = input.active.unwrap_or(true);
    let barcode = input
        .barcode
        .as_ref()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    let result = sqlx::query(
        "UPDATE products SET name = $1, description = $2, price = $3, quantity = $4, image_url = $5, \
         category_id = $6, active = $7, cost_price = $8, low_stock_threshold = $9, barcode = $10 \
         WHERE tenant_id = $11 AND id = $12",
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(input.price)
    .bind(input.quantity)
    .bind(&input.image_url)
    .bind(&input.category_id)
    .bind(active as i64)
    .bind(input.cost_price)
    .bind(input.low_stock_threshold)
    .bind(&barcode)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("product not found".to_string()));
    }

    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

/// Multipart upload ("file" field) -> Supabase Storage, returns
/// `{"url": "..."}` to save as the product's image_url. Only the image
/// bytes ever leave the browser — the service_role key that authorizes the
/// write stays server-side.
pub async fn upload_product_image(
    State(state): State<AppState>,
    _admin: AdminTenant,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("invalid upload: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let ext = storage::extension_for(&content_type);
        let filename = format!("{}.{ext}", Uuid::new_v4());
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("invalid upload: {e}")))?;

        let url = storage::upload_image(&state, &filename, &content_type, bytes.to_vec()).await?;
        return Ok(Json(serde_json::json!({ "url": url })));
    }
    Err(AppError::BadRequest("no file field in upload".to_string()))
}

pub async fn delete_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM products WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("product not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Motoboys ----------

pub async fn list_motoboys(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<MotoboyDto>>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<MotoboyRow> = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 ORDER BY name")
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(MotoboyDto::from).collect()))
}

pub async fn get_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<MotoboyDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<MotoboyRow> = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    match row {
        Some(r) => Ok(Json(r.into())),
        None => Err(AppError::NotFound("motoboy not found".to_string())),
    }
}

pub async fn create_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<MotoboyInput>,
) -> Result<Json<MotoboyDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) else {
        return Err(AppError::BadRequest("password is required to create a motoboy".to_string()));
    };
    let hash = hash_password(password)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.active.unwrap_or(true);

    sqlx::query(
        "INSERT INTO motoboys (id, tenant_id, name, phone, email, password_hash, active) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.name)
    .bind(&input.phone)
    .bind(&input.email)
    .bind(&hash)
    .bind(active as i64)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("email already in use".to_string())
        }
        other => other.into(),
    })?;

    let row: MotoboyRow = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<MotoboyInput>,
) -> Result<Json<MotoboyDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let active = input.active.unwrap_or(true);

    if let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) {
        let hash = hash_password(password)?;
        let result = sqlx::query(
            "UPDATE motoboys SET name = $1, phone = $2, email = $3, password_hash = $4, active = $5 \
             WHERE tenant_id = $6 AND id = $7",
        )
        .bind(&input.name)
        .bind(&input.phone)
        .bind(&input.email)
        .bind(&hash)
        .bind(active as i64)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("motoboy not found".to_string()));
        }
    } else {
        let result = sqlx::query(
            "UPDATE motoboys SET name = $1, phone = $2, email = $3, active = $4 WHERE tenant_id = $5 AND id = $6",
        )
        .bind(&input.name)
        .bind(&input.phone)
        .bind(&input.email)
        .bind(active as i64)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("motoboy not found".to_string()));
        }
    }

    let row: MotoboyRow = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn delete_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("motoboy not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Orders ----------

#[derive(Debug, Deserialize)]
pub struct OrdersQuery {
    pub status: Option<String>,
}

pub async fn list_orders(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<OrdersQuery>,
) -> Result<Json<Vec<OrderDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<OrderRow> = match q.status {
        Some(status) => {
            sqlx::query_as(
                "SELECT * FROM orders WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC",
            )
            .bind(&claims.tenant_id)
            .bind(status)
            .fetch_all(&mut *tx)
            .await?
        }
        None => {
            sqlx::query_as("SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC")
                .bind(&claims.tenant_id)
                .fetch_all(&mut *tx)
                .await?
        }
    };

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }
    tx.commit().await?;
    Ok(Json(result))
}

pub async fn update_order_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateStatusInput>,
) -> Result<Json<OrderDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let Some(order) = crate::orders_common::fetch_order_row(&mut *tx, &claims.tenant_id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if let Some(ref method) = input.payment_method {
        if !matches!(method.as_str(), "pix" | "cartao" | "dinheiro") {
            return Err(AppError::BadRequest(
                "payment_method must be pix, cartao or dinheiro".to_string(),
            ));
        }
    }

    // Optional settlement metadata (pay-at-pickup form) before transition.
    let payment_method = input
        .payment_method
        .as_deref()
        .unwrap_or(order.payment_method.as_str())
        .to_string();
    let customer_name = input
        .customer_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(order.customer_name.as_str())
        .to_string();
    let customer_whatsapp = input
        .customer_whatsapp
        .as_deref()
        .map(|s| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| order.customer_whatsapp.clone());

    let meta_changed = input.payment_method.is_some()
        || input.customer_name.is_some()
        || input.customer_whatsapp.is_some();
    if meta_changed {
        sqlx::query(
            "UPDATE orders SET payment_method = $1, customer_name = $2, customer_whatsapp = $3, \
             updated_at = now()::text WHERE tenant_id = $4 AND id = $5",
        )
        .bind(&payment_method)
        .bind(&customer_name)
        .bind(&customer_whatsapp)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }

    // Metadata-only PATCH (stay on same status) — used before generating PIX QR.
    if input.status == order.status {
        let dto = row_to_dto(
            &mut tx,
            &claims.tenant_id,
            crate::orders_common::fetch_order_row(&mut *tx, &claims.tenant_id, &id)
                .await?
                .ok_or_else(|| AppError::NotFound("order not found".to_string()))?,
        )
        .await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    // Essential admin delivery tray — Management/Premium keep delivery on the
    // motoboy queue; refuse admin `entregas` transitions when Motoboy is on.
    if status_flow::is_admin_delivery_transition(&order.status, &input.status) {
        if features::has_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await? {
            return Err(AppError::Forbidden(
                "entregas pelo admin só estão disponíveis em planos sem motoboy".to_string(),
            ));
        }
    }

    let set_paid = status_flow::admin_apply_transition(
        &order.status,
        &input.status,
        &order.delivery_type,
        &payment_method,
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

    if input.status == "retiradas" {
        let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
        let digits = whatsapp::digits_only(&customer_whatsapp);
        let msg = format!(
            "Seu pedido está pronto! Pode vir buscar 😊 Local de retirada: {}",
            store.pickup_address
        );
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    if input.status == "entregas" {
        let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
        let digits = whatsapp::digits_only(&customer_whatsapp);
        let msg =
            "Seu pedido saiu para entrega! Em breve você recebe. Qualquer dúvida, fale com a loja pelo WhatsApp."
                .to_string();
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    let dto = crate::orders_common::fetch_order_dto(&mut tx, &claims.tenant_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::AdminCancelInput>,
) -> Result<Json<OrderDto>, AppError> {
    let reason = input.reason.trim().to_string();
    let note = input.note.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);

    if reason == crate::cancel::ADMIN_REASON_OUTRO && note.is_none() {
        return Err(AppError::BadRequest(
            "justificativa obrigatória quando o motivo é Outro".to_string(),
        ));
    }
    if reason != crate::cancel::ADMIN_REASON_CLIENTE && reason != crate::cancel::ADMIN_REASON_OUTRO {
        return Err(AppError::BadRequest(
            "motivo inválido — use \"A pedido do cliente\" ou \"Outro\"".to_string(),
        ));
    }

    let payment = tenant::load_tenant_payment(&state.pool, &claims.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let Some(order) = crate::orders_common::fetch_order_row(&mut *tx, &claims.tenant_id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if !crate::cancel::admin_can_cancel(&order.status) {
        return Err(AppError::BadRequest(
            "não é possível cancelar um pedido concluído ou já cancelado".to_string(),
        ));
    }

    crate::cancel::apply_cancel(
        &state,
        &mut *tx,
        &claims.tenant_id,
        &order,
        &payment,
        crate::cancel::CancelInput {
            cancel_by: "admin",
            cancel_reason: reason,
            cancel_note: note,
        },
    )
    .await?;

    let dto = crate::orders_common::fetch_order_dto(&mut tx, &claims.tenant_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;

    // Notify customer (best-effort).
    let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = "Seu pedido foi cancelado pela loja. Se pagou via Pix online, o estorno é automático quando a loja usa Mercado Pago; caso contrário a loja acerta a devolução manualmente.".to_string();
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);

    Ok(Json(dto))
}

// ---------- Financeiro ----------

pub async fn financeiro(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<FinanceiroSummary>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let total_revenue: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(total), 0)::double precision FROM orders \
         WHERE tenant_id = $1 AND payment_status = 'pago'",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;

    let total_orders: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM orders WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .fetch_one(&mut *tx)
        .await?;

    let status_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*) FROM orders WHERE tenant_id = $1 GROUP BY status",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let orders_by_status = status_rows
        .into_iter()
        .map(|(status, count)| StatusCount { status, count })
        .collect();

    // SUM() over bigint/double precision in Postgres returns numeric, so the
    // aggregates are cast explicitly back to the types sqlx expects here.
    let top_rows: Vec<(String, String, i64, f64)> = sqlx::query_as(
        "SELECT oi.product_id, oi.product_name, SUM(oi.quantity)::bigint as qty, \
         SUM(oi.unit_price * oi.quantity)::double precision as rev \
         FROM order_items oi JOIN orders o ON o.id = oi.order_id \
         WHERE o.tenant_id = $1 AND o.payment_status = 'pago' \
         GROUP BY oi.product_id, oi.product_name ORDER BY qty DESC LIMIT 10",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let top_products = top_rows
        .into_iter()
        .map(|(product_id, product_name, quantity_sold, revenue)| TopProduct {
            product_id,
            product_name,
            quantity_sold,
            revenue,
        })
        .collect();

    let recent_rows: Vec<OrderRow> = sqlx::query_as(
        "SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut recent_orders = Vec::with_capacity(recent_rows.len());
    for row in recent_rows {
        recent_orders.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }

    let pdv_rows: Vec<OrderRow> = sqlx::query_as(
        "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao' \
         ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let (pdv_total_sales, pdv_total_count): (f64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total), 0)::double precision, COUNT(*)::bigint \
         FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao'",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    let mut pdv_sales = Vec::with_capacity(pdv_rows.len());
    for row in pdv_rows {
        pdv_sales.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }

    tx.commit().await?;

    Ok(Json(FinanceiroSummary {
        total_revenue: total_revenue.0,
        total_orders: total_orders.0,
        orders_by_status,
        top_products,
        recent_orders,
        pdv_sales,
        pdv_total_sales,
        pdv_total_count,
        total_discount_given: 0.0,
        motoboys: vec![],
        avg_delivery_minutes: 0.0,
    }))
}

#[derive(Debug, Deserialize)]
pub struct LucroQuery {
    /// YYYY-MM-DD inclusive
    pub from: String,
    /// YYYY-MM-DD inclusive
    pub to: String,
}

fn valid_iso_date(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let b = s.as_bytes();
    b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// Custo e lucro no intervalo. Inclui vendas de site e PDV (balcão) —
/// qualquer pedido com payment_status = 'pago'.
pub async fn financeiro_lucro(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<LucroQuery>,
) -> Result<Json<LucroSummary>, AppError> {
    if !valid_iso_date(&q.from) || !valid_iso_date(&q.to) {
        return Err(AppError::BadRequest(
            "from/to must be YYYY-MM-DD".to_string(),
        ));
    }
    if q.from > q.to {
        return Err(AppError::BadRequest(
            "from must be <= to".to_string(),
        ));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    // created_at é TEXT (now()::text); cast pra timestamptz cobre o intervalo
    // inclusivo [from 00:00, to+1day).
    let receita_row: (f64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total), 0)::double precision, COUNT(*)::bigint \
         FROM orders \
         WHERE tenant_id = $1 AND payment_status = 'pago' \
           AND created_at::timestamptz >= $2::date \
           AND created_at::timestamptz < ($3::date + interval '1 day')",
    )
    .bind(&claims.tenant_id)
    .bind(&q.from)
    .bind(&q.to)
    .fetch_one(&mut *tx)
    .await?;

    let custo_row: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(oi.quantity::double precision * COALESCE(p.cost_price, 0)), 0)::double precision \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id \
         WHERE o.tenant_id = $1 AND o.payment_status = 'pago' \
           AND o.created_at::timestamptz >= $2::date \
           AND o.created_at::timestamptz < ($3::date + interval '1 day')",
    )
    .bind(&claims.tenant_id)
    .bind(&q.from)
    .bind(&q.to)
    .fetch_one(&mut *tx)
    .await?;

    let incomplete: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id \
         WHERE o.tenant_id = $1 AND o.payment_status = 'pago' \
           AND o.created_at::timestamptz >= $2::date \
           AND o.created_at::timestamptz < ($3::date + interval '1 day') \
           AND (p.cost_price IS NULL)",
    )
    .bind(&claims.tenant_id)
    .bind(&q.from)
    .bind(&q.to)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let receita = receita_row.0;
    let custo = custo_row.0;
    Ok(Json(LucroSummary {
        from: q.from,
        to: q.to,
        receita,
        custo,
        lucro: receita - custo,
        orders_count: receita_row.1,
        incomplete_cost: incomplete.0 > 0,
    }))
}

#[derive(Debug, Deserialize)]
pub struct NotifyOrderInput {
    pub order_id: String,
}

/// Fired by the frontend right after moving an order to pedido_pronto.
/// Message text is built here (not trusted from the client) and varies by
/// delivery_type.
pub async fn notify_order_ready(
    State(state): State<AppState>,
    admin: AdminTenant,
    Json(input): Json<NotifyOrderInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &admin.tenant_id).await?;
    let Some(order) =
        crate::orders_common::fetch_order_row(&mut *tx, &admin.tenant_id, &input.order_id).await?
    else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    tx.commit().await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = if order.delivery_type == "retirada" {
        format!(
            "Olá, {}! Seu pedido está pronto para retirada 🎉 Te esperamos na loja!",
            order.customer_name
        )
    } else if features::has_feature(&state.pool, &admin.tenant_id, Feature::Motoboy).await? {
        format!(
            "Olá, {}! Seu pedido está pronto 🎉 Em breve o motoboy vai te chamar aqui pedindo sua localização.",
            order.customer_name
        )
    } else {
        format!(
            "Olá, {}! Seu pedido está pronto 🎉 Estamos organizando a entrega — a loja te avisa quando sair.",
            order.customer_name
        )
    };
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct NotifyCouponGrantInput {
    pub coupon_id: String,
    /// Template opcional do admin, com /nome e /cupom pra substituir por
    /// cliente — quando ausente, cai no texto automático de sempre. O link
    /// do site é sempre acrescentado no fim, não importa o que o admin
    /// escreveu.
    pub custom_message: Option<String>,
}

/// Fired right after the admin creates a cupom alvo (targeted coupon) from
/// a CRM filter, unless "não notificar clientes" was checked. Sends one
/// WhatsApp message per contemplated customer from the store's own
/// instance — same pattern as notify_order_ready, message built here so
/// the client can't spoof the discount text.
pub async fn notify_coupon_grant(
    State(state): State<AppState>,
    admin: AdminTenant,
    Json(input): Json<NotifyCouponGrantInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Cupons).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &admin.tenant_id).await?;

    let coupon: Option<(String, String, Option<String>, Option<f64>, i64)> = sqlx::query_as(
        "SELECT code, kind, discount_type, discount_value, notify_customers FROM sunset.coupons \
         WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&admin.tenant_id)
    .bind(&input.coupon_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let Some((code, kind, discount_type, discount_value, notify_customers)) = coupon else {
        return Err(AppError::NotFound("coupon not found".to_string()));
    };
    if notify_customers == 0 {
        return Ok(StatusCode::NO_CONTENT);
    }

    let discount_text = match (discount_type.as_deref(), discount_value) {
        (Some("percent"), Some(v)) => format!("{v}%"),
        (Some("fixed"), Some(v)) => format!("R$ {}", format!("{v:.2}").replace('.', ",")),
        _ => "desconto".to_string(),
    };
    let on_shipping = if kind == "frete" { " no frete" } else { "" };
    let default_msg = format!(
        "Você ganhou um cupom de desconto{on_shipping} na {}! 🎁\n\nCódigo: {code}\nDesconto: {discount_text}\n\nÉ só usar no checkout do site.",
        store.name
    );

    let recipients: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT DISTINCT g.customer_whatsapp, c.name
         FROM sunset.coupon_grants g
         LEFT JOIN sunset.customers c ON c.whatsapp = g.customer_whatsapp AND c.tenant_id = g.tenant_id
         WHERE g.tenant_id = $1 AND g.coupon_id = $2",
    )
    .bind(&admin.tenant_id)
    .bind(&input.coupon_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    tx.commit().await?;

    for (phone, name) in recipients {
        let digits = whatsapp::digits_only(&phone);
        if digits.is_empty() {
            continue;
        }
        let msg = match &input.custom_message {
            Some(template) if !template.trim().is_empty() => {
                let filled = template
                    .replace("/nome", name.as_deref().unwrap_or("cliente"))
                    .replace("/cupom", &code);
                format!("{filled}\n\n{}", state.frontend_public_url)
            }
            _ => default_msg.clone(),
        };
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    Ok(StatusCode::NO_CONTENT)
}

// Admin auth: JWT (Resolutoo) ou sessão sunset (legado) via AdminTenant.

async fn log_whatsapp_event(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    event_type: &str,
    previous_state: Option<&str>,
    new_state: Option<&str>,
) -> Result<(), AppError> {
    // Sempre via tenant_tx: RLS da tabela exige app.tenant_id. Pool cru
    // sem set_config gravava zero linhas / falhava em silêncio — Status
    // "Conectado" (Evolution) com histórico vazio.
    let mut tx = tenant::tenant_tx(pool, tenant_id).await?;
    // Evita spam: só grava se o new_state mudou em relação ao último evento.
    let last: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT new_state FROM whatsapp_connection_events \
         WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    if last.as_ref().and_then(|r| r.0.as_deref()) == new_state {
        tx.commit().await?;
        return Ok(());
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO whatsapp_connection_events (id, tenant_id, event_type, previous_state, new_state) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(event_type)
    .bind(previous_state)
    .bind(new_state)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn extract_wa_state(status: &serde_json::Value) -> String {
    status
        .pointer("/instance/state")
        .or_else(|| status.get("state"))
        .and_then(|v| v.as_str())
        .unwrap_or("desconhecido")
        .to_string()
}

pub async fn whatsapp_status(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let status = whatsapp::connection_status(&state, &store.whatsapp_instance).await?;
    let new_state = extract_wa_state(&status);
    let event_type = if new_state == "open" {
        "connected"
    } else if matches!(new_state.as_str(), "close" | "closed" | "logout") {
        "disconnected"
    } else {
        "status"
    };
    // Só registra connected/disconnected (transições relevantes pro histórico).
    if event_type != "status" {
        if let Err(e) = log_whatsapp_event(
            &state.pool,
            &admin.tenant_id,
            event_type,
            None,
            Some(&new_state),
        )
        .await
        {
            tracing::warn!("whatsapp event log failed: {e:?}");
        }
    }
    Ok(Json(status))
}

pub async fn whatsapp_connect(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let payload = whatsapp::connect(&state, &store.whatsapp_instance).await?;
    if let Err(e) = log_whatsapp_event(
        &state.pool,
        &admin.tenant_id,
        "qr",
        None,
        Some("qr"),
    )
    .await
    {
        tracing::warn!("whatsapp qr event log failed: {e:?}");
    }
    Ok(Json(payload))
}

pub async fn whatsapp_logout(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    whatsapp::logout(&state, &store.whatsapp_instance).await?;
    if let Err(e) = log_whatsapp_event(
        &state.pool,
        &admin.tenant_id,
        "disconnected",
        Some("open"),
        Some("close"),
    )
    .await
    {
        tracing::warn!("whatsapp disconnect event log failed: {e:?}");
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, serde::Serialize)]
pub struct WhatsAppConnectionEventDto {
    pub id: String,
    pub event_type: String,
    pub previous_state: Option<String>,
    pub new_state: Option<String>,
    /// RFC3339 — string estável pro front (`new Date(created_at)`).
    pub created_at: String,
}

pub async fn list_whatsapp_connection_events(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<Vec<WhatsAppConnectionEventDto>>, AppError> {
    // AdminTenant (JWT Railway OU sessão sunset) — igual status/connect.
    // AdminUser-only 401 em sessão legado + pool sem tenant_tx = histórico
    // vazio enquanto o card de Status mostrava "Conectado".
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &admin.tenant_id).await?;
    let rows: Vec<(String, String, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT id, event_type, previous_state, new_state, created_at \
             FROM whatsapp_connection_events WHERE tenant_id = $1 \
             ORDER BY created_at DESC LIMIT 100",
        )
        .bind(&admin.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, event_type, previous_state, new_state, created_at)| {
                WhatsAppConnectionEventDto {
                    id,
                    event_type,
                    previous_state,
                    new_state,
                    created_at: created_at.to_rfc3339(),
                }
            })
            .collect(),
    ))
}

#[derive(Debug, serde::Serialize)]
pub struct OnboardingGateDto {
    pub onboarding_hours_done: bool,
}

pub async fn get_onboarding_gate(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<OnboardingGateDto>, AppError> {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT COALESCE(onboarding_hours_done, false) FROM tenants WHERE id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    Ok(Json(OnboardingGateDto {
        onboarding_hours_done: row.map(|r| r.0).unwrap_or(false),
    }))
}

// ---------- Horário / status da loja ----------

async fn ensure_default_hours(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
) -> Result<(), AppError> {
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM store_hours WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&mut **tx)
            .await?;
    if count.0 > 0 {
        return Ok(());
    }
    let default_intervals = serde_json::json!([{ "opens_at": "09:00", "closes_at": "18:00" }]);
    for day in 0i16..=6 {
        sqlx::query(
            "INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals) \
             VALUES ($1, $2, true, $3) ON CONFLICT DO NOTHING",
        )
        .bind(tenant_id)
        .bind(day)
        .bind(&default_intervals)
        .execute(&mut **tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO store_status (tenant_id, manually_closed) VALUES ($1, false) \
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn get_store_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<StoreStatusDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_default_hours(&mut tx, &claims.tenant_id).await?;

    let rows: Vec<(i16, bool, serde_json::Value)> = sqlx::query_as(
        "SELECT day_of_week, is_open, intervals FROM store_hours \
         WHERE tenant_id = $1 ORDER BY day_of_week",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;

    let hours: Vec<StoreHourDay> = rows
        .into_iter()
        .map(|(day_of_week, is_open, intervals)| {
            let intervals: Vec<StoreHourInterval> =
                serde_json::from_value(intervals).unwrap_or_default();
            StoreHourDay {
                day_of_week,
                is_open,
                intervals,
            }
        })
        .collect();

    let status: (bool, Option<String>) = sqlx::query_as(
        "SELECT manually_closed, manual_closed_reason FROM store_status WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or((false, None));

    tx.commit().await?;

    let hours_done: (bool,) = sqlx::query_as(
        "SELECT COALESCE(onboarding_hours_done, false) FROM tenants WHERE id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or((false,));

    Ok(Json(StoreStatusDto {
        hours,
        manually_closed: status.0,
        manual_closed_reason: status.1,
        onboarding_hours_done: hours_done.0,
    }))
}

pub async fn set_store_hours(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<SetStoreHoursInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_default_hours(&mut tx, &claims.tenant_id).await?;

    for h in &body.hours {
        if !(0..=6).contains(&h.day_of_week) {
            return Err(AppError::BadRequest("day_of_week deve ser 0..6".to_string()));
        }
        let intervals = serde_json::to_value(&h.intervals)
            .map_err(|e| AppError::Internal(format!("intervals json: {e}")))?;
        sqlx::query(
            "INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (tenant_id, day_of_week) DO UPDATE SET \
             is_open = EXCLUDED.is_open, intervals = EXCLUDED.intervals",
        )
        .bind(&claims.tenant_id)
        .bind(h.day_of_week)
        .bind(h.is_open)
        .bind(&intervals)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("UPDATE tenants SET onboarding_hours_done = true, updated_at = now()::text WHERE id = $1")
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true, "onboarding_hours_done": true })))
}

pub async fn set_store_manual_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<SetStoreManualStatusInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.manually_closed && body.reason.as_deref().unwrap_or("").trim().is_empty() {
        // Motivo só é obrigatório no front quando fecha no horário aberto;
        // no backend aceitamos vazio (lojista pode fechar sem mensagem).
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_default_hours(&mut tx, &claims.tenant_id).await?;
    let reason = if body.manually_closed {
        body.reason.as_deref().map(str::trim).filter(|s| !s.is_empty())
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO store_status (tenant_id, manually_closed, manual_closed_reason) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
         manually_closed = EXCLUDED.manually_closed, \
         manual_closed_reason = EXCLUDED.manual_closed_reason",
    )
    .bind(&claims.tenant_id)
    .bind(body.manually_closed)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- Frete (R$/km + raio máximo) ----------

#[derive(Debug, serde::Serialize)]
pub struct ShippingSettingsDto {
    pub price_per_km: f64,
    pub max_km: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateShippingSettingsInput {
    pub price_per_km: f64,
    pub max_km: Option<f64>,
}

async fn ensure_shipping_settings(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) \
         VALUES ($1, 1.5, 0, 0) ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn get_shipping_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<ShippingSettingsDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Pedidos).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_shipping_settings(&mut tx, &claims.tenant_id).await?;
    let row: (f64, Option<f64>) = sqlx::query_as(
        "SELECT price_per_km, max_km FROM shipping_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(ShippingSettingsDto {
        price_per_km: row.0,
        max_km: row.1,
    }))
}

pub async fn update_shipping_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<UpdateShippingSettingsInput>,
) -> Result<Json<ShippingSettingsDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Pedidos).await?;
    if !body.price_per_km.is_finite() || body.price_per_km < 0.0 {
        return Err(AppError::BadRequest(
            "price_per_km must be a non-negative number".to_string(),
        ));
    }
    if let Some(max_km) = body.max_km {
        if !max_km.is_finite() || max_km <= 0.0 {
            return Err(AppError::BadRequest(
                "max_km must be a positive number".to_string(),
            ));
        }
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_shipping_settings(&mut tx, &claims.tenant_id).await?;
    sqlx::query(
        "UPDATE shipping_settings SET price_per_km = $2, max_km = $3 WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .bind(body.price_per_km)
    .bind(body.max_km)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(ShippingSettingsDto {
        price_per_km: body.price_per_km,
        max_km: body.max_km,
    }))
}
