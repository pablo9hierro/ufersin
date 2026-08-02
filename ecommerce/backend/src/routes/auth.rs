use axum::extract::State;
use axum::Json;

use crate::auth::{make_token, verify_password};
use crate::error::AppError;
use crate::models::{LoginInput, LoginResponse};
use crate::state::AppState;

fn normalize_slug(raw: Option<&str>) -> Option<String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty())?.to_lowercase();
    Some(s)
}

async fn resolve_tenant_id(state: &AppState, slug: &str) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(slug)
        .fetch_optional(&state.pool)
        .await?;
    row.map(|(id,)| id)
        .ok_or_else(|| AppError::Unauthorized("invalid credentials".to_string()))
}

pub async fn admin_login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let email = input.email.trim();
    if email.is_empty() || input.password.is_empty() {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    if let Some(slug) = normalize_slug(input.tenant_slug.as_deref()) {
        let tenant_id = resolve_tenant_id(&state, &slug).await?;
        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT id, password_hash, name FROM admins WHERE tenant_id = $1 AND lower(email) = lower($2)",
        )
        .bind(&tenant_id)
        .bind(email)
        .fetch_optional(&state.pool)
        .await?;

        let Some((id, hash, name)) = row else {
            return Err(AppError::Unauthorized("invalid credentials".to_string()));
        };
        if !verify_password(&input.password, &hash) {
            return Err(AppError::Unauthorized("invalid credentials".to_string()));
        }

        let token = make_token(&state.jwt_secret, &id, &tenant_id, "admin", &name);
        return Ok(Json(LoginResponse {
            token,
            name,
            tenant_slug: slug,
        }));
    }

    // No slug: resolve tenant from credentials. Password is verified before
    // any tenant is chosen so a wrong password never leaks store membership.
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT a.id, a.password_hash, a.name, a.tenant_id, t.slug
         FROM admins a
         INNER JOIN tenants t ON t.id = a.tenant_id
         WHERE lower(a.email) = lower($1)",
    )
    .bind(email)
    .fetch_all(&state.pool)
    .await?;

    let mut matches: Vec<(String, String, String, String)> = Vec::new();
    for (id, hash, name, tenant_id, slug) in rows {
        if verify_password(&input.password, &hash) {
            matches.push((id, name, tenant_id, slug));
        }
    }

    match matches.len() {
        0 => Err(AppError::Unauthorized("invalid credentials".to_string())),
        1 => {
            let (id, name, tenant_id, slug) = matches.remove(0);
            let token = make_token(&state.jwt_secret, &id, &tenant_id, "admin", &name);
            Ok(Json(LoginResponse {
                token,
                name,
                tenant_slug: slug,
            }))
        }
        _ => Err(AppError::Unauthorized(
            "mais de uma loja para este e-mail — use o link do painel Resolutoo".to_string(),
        )),
    }
}

pub async fn motoboy_login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let slug = normalize_slug(input.tenant_slug.as_deref()).ok_or_else(|| {
        AppError::Unauthorized("invalid credentials".to_string())
    })?;
    let tenant_id = resolve_tenant_id(&state, &slug).await?;

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
    Ok(Json(LoginResponse {
        token,
        name,
        tenant_slug: slug,
    }))
}
