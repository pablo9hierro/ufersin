use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::auth::make_token;
use crate::error::AppError;
use crate::state::AppState;

/// Único tenant que este endpoint enxerga: o seedado por
/// seed::seed_demo_tenant, isolado de propósito de qualquer loja real.
/// PÚBLICO (sem senha) — é justamente pra deixar um visitante do site da
/// Rodoletas ver o painel real sem precisar de conta. Só é seguro porque
/// só existe ESTE tenant fixo e ele nunca guarda dado sensível de verdade.
const DEMO_TENANT_SLUG: &str = "loja-demo";

#[derive(Debug, Serialize)]
pub struct DemoTokens {
    pub admin_token: String,
    pub motoboy_token: String,
}

pub async fn demo_tokens(State(state): State<AppState>) -> Result<Json<DemoTokens>, AppError> {
    let tenant: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(DEMO_TENANT_SLUG)
        .fetch_optional(&state.pool)
        .await?;
    let (tenant_id,) = tenant.ok_or_else(|| AppError::Internal("demo tenant not seeded".to_string()))?;

    let admin: Option<(String, String)> = sqlx::query_as("SELECT id, name FROM admins WHERE tenant_id = $1 LIMIT 1")
        .bind(&tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    let (admin_id, admin_name) = admin.ok_or_else(|| AppError::Internal("demo admin not seeded".to_string()))?;

    let motoboy: Option<(String, String)> = sqlx::query_as("SELECT id, name FROM motoboys WHERE tenant_id = $1 LIMIT 1")
        .bind(&tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    let (motoboy_id, motoboy_name) = motoboy.ok_or_else(|| AppError::Internal("demo motoboy not seeded".to_string()))?;

    Ok(Json(DemoTokens {
        admin_token: make_token(&state.jwt_secret, &admin_id, &tenant_id, "admin", &admin_name),
        motoboy_token: make_token(&state.jwt_secret, &motoboy_id, &tenant_id, "motoboy", &motoboy_name),
    }))
}
