use sqlx::{PgConnection, PgExecutor};

use crate::error::AppError;
use crate::formulation;
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

/// Decrements stock for every item of this order in one batched UPDATE.
/// Call this exactly once, at the moment `payment_status` actually
/// transitions to `'pago'` (never at order creation for a not-yet-paid
/// order) — every caller must check it's the one making that transition
/// happen before calling this, so stock is never decremented twice for
/// the same order.
///
/// Manual products (`origin_type = 'manual'`) keep the blind UPDATE of
/// always. ERP formulation products (`origin_type = 'erp_formulation'`)
/// NEVER have their `quantity` written here directly — instead the
/// INGREDIENTS they consume are decremented (`formulation::
/// consume_ingredients_for_order`) and the product's `quantity`/
/// `cost_price` get recalculated from the new ingredient stock
/// (`formulation::recompute_dependents`). Signature is a concrete
/// `&mut PgConnection` (not generic `PgExecutor`) because this now runs
/// several sequential queries — every call site already passes `&mut *tx`,
/// which derefs fine to this type with zero call-site changes.
pub async fn decrement_stock_for_order(tx: &mut PgConnection, tenant_id: &str, order_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE products p SET quantity = p.quantity - oi.quantity \
         FROM order_items oi \
         WHERE p.tenant_id = $1 AND p.id = oi.product_id \
           AND oi.tenant_id = $1 AND oi.order_id = $2 AND p.origin_type = 'manual'",
    )
    .bind(tenant_id)
    .bind(order_id)
    .execute(&mut *tx)
    .await?;

    let touched_ingredients = formulation::consume_ingredients_for_order(tx, tenant_id, order_id).await?;
    for ingredient_id in touched_ingredients {
        formulation::recompute_dependents(tx, tenant_id, &ingredient_id).await?;
    }
    Ok(())
}

/// Mirror of `decrement_stock_for_order` — restores stock when a PAID
/// order is cancelled/refunded. Only call when the order had actually
/// reached `payment_status = 'pago'` before the cancel (so stock was
/// actually decremented in the first place — an order cancelled while
/// still unpaid never touched stock, so there's nothing to restore).
pub async fn restock_order_items(tx: &mut PgConnection, tenant_id: &str, order_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE products p SET quantity = p.quantity + oi.quantity \
         FROM order_items oi \
         WHERE p.tenant_id = $1 AND p.id = oi.product_id \
           AND oi.tenant_id = $1 AND oi.order_id = $2 AND p.origin_type = 'manual'",
    )
    .bind(tenant_id)
    .bind(order_id)
    .execute(&mut *tx)
    .await?;

    let touched_ingredients = formulation::restock_ingredients_for_order(tx, tenant_id, order_id).await?;
    for ingredient_id in touched_ingredients {
        formulation::recompute_dependents(tx, tenant_id, &ingredient_id).await?;
    }
    Ok(())
}
