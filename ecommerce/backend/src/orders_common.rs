use sqlx::PgExecutor;

use crate::error::AppError;
use crate::models::{OrderDto, OrderItemDto, OrderRow};

/// Generic over `PgExecutor` so callers can pass either `&state.pool` (rare
/// — only where there's genuinely no tenant to scope by yet) or a
/// tenant-scoped transaction (`&mut *tx` from `tenant::tenant_tx`, the
/// normal case) through the same helper.
pub async fn fetch_order_row<'e, E>(executor: E, tenant_id: &str, id: &str) -> Result<Option<OrderRow>, AppError>
where
    E: PgExecutor<'e>,
{
    let row: Option<OrderRow> = sqlx::query_as("SELECT * FROM orders WHERE tenant_id = $1 AND id = $2")
        .bind(tenant_id)
        .bind(id)
        .fetch_optional(executor)
        .await?;
    Ok(row)
}

pub async fn fetch_items<'e, E>(executor: E, tenant_id: &str, order_id: &str) -> Result<Vec<OrderItemDto>, AppError>
where
    E: PgExecutor<'e>,
{
    let items: Vec<OrderItemDto> = sqlx::query_as(
        "SELECT id, product_id, product_name, unit_price, quantity FROM order_items \
         WHERE tenant_id = $1 AND order_id = $2",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(executor)
    .await?;
    Ok(items)
}

/// Needs two executor uses (row + items) — callers pass a transaction here,
/// never a bare pool reference twice, since `PgPool` is `Copy`-cheap to
/// reborrow but a `Transaction` isn't; taking `&mut PgConnection` twice via
/// reborrow is the reason this isn't generic like the two helpers above.
pub async fn fetch_order_dto(
    conn: &mut sqlx::PgConnection,
    tenant_id: &str,
    id: &str,
) -> Result<Option<OrderDto>, AppError> {
    let Some(row) = fetch_order_row(&mut *conn, tenant_id, id).await? else {
        return Ok(None);
    };
    let items = fetch_items(&mut *conn, tenant_id, id).await?;
    Ok(Some(OrderDto::from_row(row, items)))
}

pub async fn row_to_dto(
    conn: &mut sqlx::PgConnection,
    tenant_id: &str,
    row: OrderRow,
) -> Result<OrderDto, AppError> {
    let items = fetch_items(&mut *conn, tenant_id, &row.id).await?;
    Ok(OrderDto::from_row(row, items))
}

/// Short id used in customer-facing WhatsApp messages, e.g. "#a1b2c3d4".
pub fn short_id(id: &str) -> &str {
    &id[..id.len().min(8)]
}
