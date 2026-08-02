use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHasher};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use jsonwebtoken::{decode, decode_header, Validation};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

/// Claims do JWT emitido pelo Supabase Auth (não um token nosso) — ver
/// ARQUITETURA.md §6.
///
/// Identidades distintas no mesmo projeto Auth:
/// - **lojista**: `sub` = `subscribers.id` (bootstrap/cadastro)
/// - **superadmin**: `sub` ∈ `platform_admins.user_id` — **não** assina plano
///   e **não** precisa de linha em `subscribers`
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SupabaseClaims {
    pub sub: String,
    pub email: Option<String>,
    pub exp: usize,
}

/// Ainda usado — não pra autenticar o subscriber (isso é 100% Supabase
/// agora), só pra continuar alimentando `admin_password_hash` no handoff
/// de provisionamento do tenant (ver routes/onboarding.rs).
pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("hash error: {e}")))
}

/// Extractor: exige um JWT válido emitido pelo Supabase (assinante
/// logado). Verificado localmente contra o JWKS público do projeto
/// Supabase (chave assimétrica, ver jwks.rs) — nunca consulta o banco do
/// Supabase pra validar a sessão, os dois backends são serviços/bancos
/// totalmente separados.
pub struct AuthSubscriber(pub SupabaseClaims);

impl FromRequestParts<AppState> for AuthSubscriber {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing authorization header".to_string()))?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("invalid authorization header".to_string()))?;
        let kid = decode_header(token)
            .map_err(|_| AppError::Unauthorized("invalid token header".to_string()))?
            .kid
            .ok_or_else(|| AppError::Unauthorized("token missing kid".to_string()))?;
        let (decoding_key, algorithm) = state.supabase_jwks.decoding_key_for(&kid).await?;
        let mut validation = Validation::new(algorithm);
        // O `aud` do Supabase é sempre "authenticated" pra usuário logado,
        // mas não validamos aqui pra não acoplar nesse detalhe interno —
        // `exp` (checado por padrão) já garante que o token é uma sessão
        // viva emitida pelo Supabase Auth deste projeto.
        validation.validate_aud = false;
        let data = decode::<SupabaseClaims>(token, &decoding_key, &validation)
            .map_err(|_| AppError::Unauthorized("invalid or expired token".to_string()))?;
        Ok(AuthSubscriber(data.claims))
    }
}

/// Dono da plataforma Resolutoo.
///
/// Gate único do `/dashboard`: JWT Supabase válido **e** membership em
/// `platform_admins`. Independente de assinatura/plano/`subscribers`.
pub struct AuthSuperadmin(pub SupabaseClaims);

impl FromRequestParts<AppState> for AuthSuperadmin {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let AuthSubscriber(claims) = AuthSubscriber::from_request_parts(parts, state).await?;
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT 1::bigint FROM platform_admins WHERE user_id = $1",
        )
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;
        if row.is_none() {
            return Err(AppError::Forbidden("superadmin required".to_string()));
        }
        Ok(AuthSuperadmin(claims))
    }
}
