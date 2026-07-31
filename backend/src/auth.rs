use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHasher};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

/// Claims do JWT emitido pelo Supabase Auth (não um token nosso) — ver
/// ARQUITETURA.md §6. `sub` é o uuid do usuário no projeto Supabase, que
/// passa a ser usado diretamente como `subscribers.id`.
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
/// logado). Verificado localmente via o JWT secret compartilhado do
/// projeto Supabase (HS256) — nunca consulta o banco do Supabase pra
/// validar a sessão, os dois backends são serviços/bancos totalmente
/// separados.
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
        let data = decode::<SupabaseClaims>(
            token,
            &DecodingKey::from_secret(state.supabase_jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| AppError::Unauthorized("invalid or expired token".to_string()))?;
        Ok(AuthSubscriber(data.claims))
    }
}
