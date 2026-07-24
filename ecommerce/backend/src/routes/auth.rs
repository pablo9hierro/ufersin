use axum::extract::State;
use axum::Json;

use crate::auth::{make_token, verify_password};
use crate::error::AppError;
use crate::models::{LoginInput, LoginResponse};
use crate::state::AppState;

async fn resolve_tenant_id(state: &AppState, slug: &str) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(slug)
        .fetch_optional(&state.pool)
        .await?;
    row.map(|(id,)| id).ok_or_else(|| AppError::Unauthorized("invalid credentials".to_string()))
}

pub async fn admin_login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let tenant_id = resolve_tenant_id(&state, &input.tenant_slug).await?;

    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT id, password_hash, name FROM admins WHERE tenant_id = $1 AND email = $2",
    )
    .bind(&tenant_id)
    .bind(&input.email)
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, hash, name)) = row else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if !verify_password(&input.password, &hash) {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    let token = make_token(&state.jwt_secret, &id, &tenant_id, "admin", &name);
    Ok(Json(LoginResponse { token, name }))
}

pub async fn motoboy_login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let tenant_id = resolve_tenant_id(&state, &input.tenant_slug).await?;

    let row: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, password_hash, name, active FROM motoboys WHERE tenant_id = $1 AND email = $2",
    )
    .bind(&tenant_id)
    .bind(&input.email)
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, hash, name, active)) = row else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if active == 0 || !verify_password(&input.password, &hash) {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    let token = make_token(&state.jwt_secret, &id, &tenant_id, "motoboy", &name);
    Ok(Json(LoginResponse { token, name }))
}
