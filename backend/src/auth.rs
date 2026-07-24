use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub exp: usize,
}

pub fn make_token(secret: &str, subscriber_id: &str, email: &str) -> String {
    let exp = (Utc::now() + Duration::days(30)).timestamp() as usize;
    let claims = Claims { sub: subscriber_id.to_string(), email: email.to_string(), exp };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .expect("jwt encode should not fail")
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("hash error: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else { return false };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

/// Código de 6 dígitos pra verificação de e-mail / redefinição de senha —
/// mesmo padrão já usado pro código de recuperação de senha do cliente
/// final no motor de e-commerce (sunset._create_customer_reset_code),
/// enviado por WhatsApp lá; aqui não há canal de e-mail/WhatsApp real
/// configurado ainda, então o código só é logado (ver routes/auth.rs).
pub fn generate_code() -> String {
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(0..1_000_000))
}

/// Extractor: requires a valid JWT (assinante logado).
pub struct AuthSubscriber(pub Claims);

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
        let data = decode::<Claims>(token, &DecodingKey::from_secret(state.jwt_secret.as_bytes()), &Validation::default())
            .map_err(|_| AppError::Unauthorized("invalid or expired token".to_string()))?;
        Ok(AuthSubscriber(data.claims))
    }
}
