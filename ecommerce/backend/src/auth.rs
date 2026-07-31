use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub tenant_id: String,
    pub role: String,
    pub name: String,
    pub exp: usize,
}

pub fn make_token(secret: &str, id: &str, tenant_id: &str, role: &str, name: &str) -> String {
    let exp = (Utc::now() + Duration::days(7)).timestamp() as usize;
    let claims = Claims {
        sub: id.to_string(),
        tenant_id: tenant_id.to_string(),
        role: role.to_string(),
        name: name.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("jwt encode should not fail")
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("hash error: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Extractor: requires a valid JWT, any role.
pub struct AuthUser(pub Claims);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing authorization header".to_string()))?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("invalid authorization header".to_string()))?;
        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| AppError::Unauthorized("invalid or expired token".to_string()))?;
        Ok(AuthUser(data.claims))
    }
}

/// Extractor: requires a valid JWT with role == admin. `claims.tenant_id` is
/// the tenant every query in the handler must be scoped to.
pub struct AdminUser(pub Claims);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser(claims) = AuthUser::from_request_parts(parts, state).await?;
        if claims.role != "admin" {
            return Err(AppError::Forbidden("admin role required".to_string()));
        }
        Ok(AdminUser(claims))
    }
}

/// Admin autenticado via JWT (Resolutoo multi-tenant) **ou** sessão opaca
/// `sunset.sessions` (Sunset legado). Só devolve o `tenant_id` — suficiente
/// pras rotas de WhatsApp/upload que não precisam do subject.
pub struct AdminTenant {
    pub tenant_id: String,
}

impl FromRequestParts<AppState> for AdminTenant {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Ok(AdminUser(claims)) = AdminUser::from_request_parts(parts, state).await {
            return Ok(AdminTenant {
                tenant_id: claims.tenant_id,
            });
        }
        let SunsetAdminSession { tenant_id, .. } =
            SunsetAdminSession::from_request_parts(parts, state).await?;
        Ok(AdminTenant { tenant_id })
    }
}

/// Extractor: requires a valid Bearer token matching a row in
/// sunset.sessions — the Postgres-native session system the Supabase-facing
/// frontend uses now (NOT the JWT system above). Used only by routes that
/// still need Rust because they touch a secret (Evolution API key), while
/// the rest of admin auth/CRUD lives in Supabase RPCs. Returns the tenant
/// alongside the subject id since the session row (not a JWT claim) is the
/// only source of truth for it here.
pub struct SunsetAdminSession {
    #[allow(dead_code)]
    pub subject_id: String,
    pub tenant_id: String,
}

impl FromRequestParts<AppState> for SunsetAdminSession {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let (subject_id, tenant_id) = session_lookup(parts, state, &["admin"]).await?;
        Ok(SunsetAdminSession { subject_id, tenant_id })
    }
}

/// Same as SunsetAdminSession but also accepts role == vendedor — vendedor
/// shares the admin's own store WhatsApp instance (no personal instance),
/// used by routes both roles can trigger (e.g. "pedido pronto" notify after
/// advancing an order they're allowed to manage from /admin/pedidos).
pub struct SunsetAdminOrVendedorSession {
    #[allow(dead_code)]
    pub subject_id: String,
    pub tenant_id: String,
}

impl FromRequestParts<AppState> for SunsetAdminOrVendedorSession {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let (subject_id, tenant_id) = session_lookup(parts, state, &["admin", "vendedor"]).await?;
        Ok(SunsetAdminOrVendedorSession { subject_id, tenant_id })
    }
}

/// Same as SunsetAdminSession but for role == motoboy (own WhatsApp
/// connection, per-motoboy Evolution API instance).
pub struct SunsetMotoboySession {
    pub subject_id: String,
    #[allow(dead_code)]
    pub tenant_id: String,
}

impl FromRequestParts<AppState> for SunsetMotoboySession {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let (subject_id, tenant_id) = session_lookup(parts, state, &["motoboy"]).await?;
        Ok(SunsetMotoboySession { subject_id, tenant_id })
    }
}

async fn session_lookup(
    parts: &mut Parts,
    state: &AppState,
    roles: &[&str],
) -> Result<(String, String), AppError> {
    let header = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("missing authorization header".to_string()))?;
    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("invalid authorization header".to_string()))?;
    lookup_session_token(&state.pool, token, roles).await
}

/// Same lookup as the extractors above, usable when a handler already has
/// the raw bearer token in hand instead of `Parts` — e.g.
/// routes::motoboy::start_run, which forwards the token as-is into a
/// Postgres RPC and separately needs the tenant it belongs to.
pub async fn lookup_session_token(
    pool: &sqlx::PgPool,
    token: &str,
    roles: &[&str],
) -> Result<(String, String), AppError> {
    let subject: Option<(String, String)> = sqlx::query_as(
        "SELECT subject_id, tenant_id FROM sunset.sessions \
         WHERE token = $1 AND role = ANY($2) AND expires_at > now()",
    )
    .bind(token)
    .bind(roles)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    subject.ok_or_else(|| AppError::Unauthorized("invalid or expired session".to_string()))
}

/// Extractor: requires a valid JWT with role == motoboy.
pub struct MotoboyUser(pub Claims);

impl FromRequestParts<AppState> for MotoboyUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser(claims) = AuthUser::from_request_parts(parts, state).await?;
        if claims.role != "motoboy" {
            return Err(AppError::Forbidden("motoboy role required".to_string()));
        }
        Ok(MotoboyUser(claims))
    }
}
