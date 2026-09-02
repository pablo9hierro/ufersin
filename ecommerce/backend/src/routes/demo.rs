use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::make_token;
use crate::error::AppError;
use crate::state::AppState;

/// Únicos tenants que este endpoint enxerga: os seedados por
/// seed::seed_demo_tenants (`demo-ecommerce`/`demo-eletronica`), isolados
/// de propósito de qualquer loja real. PÚBLICO (sem senha) — é justamente
/// pra deixar um visitante ver o painel real sem precisar de conta. Só é
/// seguro porque são tenants fixos e nunca guardam dado sensível de verdade.
#[derive(Debug, Deserialize)]
pub struct DemoTokensQuery {
    /// "ecommerce" (default) ou "eletronica".
    #[serde(default)]
    pub vertical: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DemoTokens {
    pub admin_token: String,
    pub motoboy_token: Option<String>,
}

pub async fn demo_tokens(
    State(state): State<AppState>,
    Query(query): Query<DemoTokensQuery>,
) -> Result<Json<DemoTokens>, AppError> {
    let slug = match query.vertical.as_deref() {
        Some("eletronica") | Some("eletronicos") => "demo-eletronica",
        _ => "demo-ecommerce",
    };

    let tenant: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(slug)
        .fetch_optional(&state.pool)
        .await?;
    let (tenant_id,) = tenant.ok_or_else(|| AppError::Internal("demo tenant not seeded".to_string()))?;

    let admin: Option<(String, String)> = sqlx::query_as("SELECT id, name FROM admins WHERE tenant_id = $1 LIMIT 1")
        .bind(&tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    let (admin_id, admin_name) = admin.ok_or_else(|| AppError::Internal("demo admin not seeded".to_string()))?;

    // Só o tenant demo-ecommerce tem motoboy seedado (delivery não faz
    // parte do ramo eletrônica) — Option evita erro pra quem pedir a demo
    // de eletrônica.
    let motoboy: Option<(String, String)> = sqlx::query_as("SELECT id, name FROM motoboys WHERE tenant_id = $1 LIMIT 1")
        .bind(&tenant_id)
        .fetch_optional(&state.pool)
        .await?;

    Ok(Json(DemoTokens {
        admin_token: make_token(&state.jwt_secret, &admin_id, &tenant_id, "admin", &admin_name),
        motoboy_token: motoboy
            .map(|(motoboy_id, motoboy_name)| make_token(&state.jwt_secret, &motoboy_id, &tenant_id, "motoboy", &motoboy_name)),
    }))
}
