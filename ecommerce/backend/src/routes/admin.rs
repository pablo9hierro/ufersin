use axum::extract::{Multipart, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{hash_password, AdminUser, SunsetAdminOrVendedorSession, SunsetAdminSession};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::models::{
    Category, CategoryInput, FinanceiroSummary, MotoboyDto, MotoboyInput, MotoboyRow, OrderDto,
    OrderRow, ProductDto, ProductInput, ProductRow, StatusCount, TopProduct, UpdateStatusInput,
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
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
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
    let result = sqlx::query(
        "UPDATE products SET name = $1, description = $2, price = $3, quantity = $4, image_url = $5, \
         category_id = $6, active = $7 WHERE tenant_id = $8 AND id = $9",
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(input.price)
    .bind(input.quantity)
    .bind(&input.image_url)
    .bind(&input.category_id)
    .bind(active as i64)
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
    _admin: SunsetAdminSession,
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

    let set_paid = status_flow::admin_apply_transition(
        &order.status,
        &input.status,
        &order.delivery_type,
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
        let digits = whatsapp::digits_only(&order.customer_whatsapp);
        let msg = format!(
            "Seu pedido está pronto! Pode vir buscar 😊 Local de retirada: {}",
            store.pickup_address
        );
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    let dto = crate::orders_common::fetch_order_dto(&mut tx, &claims.tenant_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
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
    tx.commit().await?;

    Ok(Json(FinanceiroSummary {
        total_revenue: total_revenue.0,
        total_orders: total_orders.0,
        orders_by_status,
        top_products,
        recent_orders,
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
    session: SunsetAdminOrVendedorSession,
    Json(input): Json<NotifyOrderInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &session.tenant_id).await?;
    let Some(order) =
        crate::orders_common::fetch_order_row(&mut *tx, &session.tenant_id, &input.order_id).await?
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
    } else {
        format!(
            "Olá, {}! Seu pedido está pronto 🎉 Em breve o motoboy vai te chamar aqui pedindo sua localização.",
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
    session: SunsetAdminSession,
    Json(input): Json<NotifyCouponGrantInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Cupons).await?;
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &session.tenant_id).await?;

    let coupon: Option<(String, String, Option<String>, Option<f64>, i64)> = sqlx::query_as(
        "SELECT code, kind, discount_type, discount_value, notify_customers FROM sunset.coupons \
         WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&session.tenant_id)
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
    .bind(&session.tenant_id)
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

// ---------- WhatsApp (Evolution API) ----------
//
// Admin auth here uses SunsetAdminSession (checks sunset.sessions directly),
// not the JWT AdminUser above — the frontend's admin login moved to a
// Supabase RPC session, but these 3 routes still need to live in Rust
// because they touch the Evolution API key, which must stay off the browser.

pub async fn whatsapp_status(
    State(state): State<AppState>,
    session: SunsetAdminSession,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    Ok(Json(whatsapp::connection_status(&state, &store.whatsapp_instance).await?))
}

pub async fn whatsapp_connect(
    State(state): State<AppState>,
    session: SunsetAdminSession,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    Ok(Json(whatsapp::connect(&state, &store.whatsapp_instance).await?))
}

pub async fn whatsapp_logout(
    State(state): State<AppState>,
    session: SunsetAdminSession,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &session.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &session.tenant_id).await?;
    whatsapp::logout(&state, &store.whatsapp_instance).await?;
    Ok(StatusCode::NO_CONTENT)
}
