use sqlx::{PgPool, Postgres, Transaction};

use crate::error::AppError;

/// Branding/config that used to live as global env vars in AppState
/// (STORE_PICKUP_ADDRESS, EVOLUTION_INSTANCE) — now per-tenant, since a
/// single shared deploy serves every tenant's store at once.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Tenant {
    pub id: String,
    pub name: String,
    pub whatsapp_instance: String,
    pub pickup_address: String,
}

pub async fn load_tenant(pool: &PgPool, tenant_id: &str) -> Result<Tenant, AppError> {
    sqlx::query_as(
        "SELECT id, name, whatsapp_instance, pickup_address FROM tenants WHERE id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Internal("tenant not found".to_string()))
}

/// Resolves the tenant that owns a given order — used by the public.rs
/// endpoints (Pix, WhatsApp notifications, route computation) which take
/// only an order id and run before any login, so there's no JWT/session to
/// read a tenant_id from. The order id itself is already this flow's
/// authorization boundary (same as before this refactor); this just adds
/// *which* tenant's branding/WhatsApp instance to use alongside it.
pub async fn tenant_for_order(pool: &PgPool, order_id: &str) -> Result<Tenant, AppError> {
    sqlx::query_as(
        "SELECT t.id, t.name, t.whatsapp_instance, t.pickup_address \
         FROM tenants t JOIN orders o ON o.tenant_id = t.id WHERE o.id = $1",
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("order not found".to_string()))
}

/// Resolves which tenant a given Evolution API instance name belongs to —
/// used by the webhook handler, which receives events from every tenant's
/// instance (and every motoboy's) on one shared endpoint and has to figure
/// out which tenant's orders to touch. Instance names of the form
/// "motoboy-<id>" aren't tenant instances themselves; callers should look
/// the motoboy up and use their order's tenant instead (see webhooks.rs).
pub async fn tenant_for_instance(pool: &PgPool, instance: &str) -> Result<Option<Tenant>, AppError> {
    let tenant = sqlx::query_as(
        "SELECT id, name, whatsapp_instance, pickup_address FROM tenants WHERE whatsapp_instance = $1",
    )
    .bind(instance)
    .fetch_optional(pool)
    .await?;
    Ok(tenant)
}

/// Opens a transaction scoped to `tenant_id`: every tenant-owned table has
/// RLS policy `tenant_id = current_setting('app.tenant_id')` (see
/// migrations/0005_tenancy.sql — not FORCEd locally, so this is prep for
/// Supabase rather than a live backstop today), and this is what sets that
/// session variable. `set_config(..., is_local => true)` only takes effect
/// inside a transaction and is automatically unset at COMMIT/ROLLBACK —
/// required so a pooled connection can never leak one request's tenant
/// scope into the next request that reuses it.
///
/// Use this instead of `&state.pool` for any query touching a tenant-owned
/// table. The `WHERE tenant_id = $N` filters already written throughout the
/// handlers are what actually enforces isolation for this backend's own
/// traffic right now — keep writing them regardless of this.
pub async fn tenant_tx<'p>(pool: &'p PgPool, tenant_id: &str) -> Result<Transaction<'p, Postgres>, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
        .bind(tenant_id)
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
