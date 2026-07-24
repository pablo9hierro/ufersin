use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::{generate_code, hash_password, make_token, verify_password, AuthSubscriber};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub email: String,
    pub senha: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub loja_nome: String,
}

pub async fn login(State(state): State<AppState>, Json(body): Json<LoginInput>) -> Result<Json<LoginResponse>, AppError> {
    let row: Option<(String, Option<String>, String)> =
        sqlx::query_as("SELECT id, password_hash, loja_nome FROM subscribers WHERE lower(email) = lower($1)")
            .bind(body.email.trim())
            .fetch_optional(&state.pool)
            .await?;

    let Some((id, Some(hash), loja_nome)) = row else {
        return Err(AppError::Unauthorized("e-mail ou senha inválidos".to_string()));
    };
    if !verify_password(&body.senha, &hash) {
        return Err(AppError::Unauthorized("e-mail ou senha inválidos".to_string()));
    }

    let token = make_token(&state.jwt_secret, &id, body.email.trim());
    Ok(Json(LoginResponse { token, loja_nome }))
}

#[derive(Debug, Deserialize)]
pub struct VerificarEmailInput {
    pub codigo: String,
}

pub async fn verificar_email(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<VerificarEmailInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT verification_code FROM subscribers WHERE id = $1 AND verification_expires_at > now()",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let matches = row.and_then(|(c,)| c).is_some_and(|c| c == body.codigo.trim());
    if !matches {
        return Err(AppError::BadRequest("código inválido ou expirado".to_string()));
    }

    sqlx::query("UPDATE subscribers SET email_verified = true, verification_code = NULL WHERE id = $1")
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "email_verified": true })))
}

pub async fn reenviar_verificacao(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<serde_json::Value>, AppError> {
    let code = generate_code();
    sqlx::query(
        "UPDATE subscribers SET verification_code = $1, verification_expires_at = now() + interval '30 minutes' WHERE id = $2",
    )
    .bind(&code)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;
    tracing::info!("[verificação de e-mail — MOCK] {}: código {}", claims.email, code);
    Ok(Json(serde_json::json!({ "sent": true })))
}

#[derive(Debug, Deserialize)]
pub struct EsqueciSenhaInput {
    pub email: String,
}

/// Sempre responde 200 mesmo se o e-mail não existir — não revela quais
/// e-mails têm conta (mesmo cuidado já tomado no motor de e-commerce pra
/// recuperação de senha do cliente final).
pub async fn esqueci_senha(State(state): State<AppState>, Json(body): Json<EsqueciSenhaInput>) -> Result<Json<serde_json::Value>, AppError> {
    let code = generate_code();
    let updated = sqlx::query(
        "UPDATE subscribers SET reset_code = $1, reset_expires_at = now() + interval '30 minutes' WHERE lower(email) = lower($2)",
    )
    .bind(&code)
    .bind(body.email.trim())
    .execute(&state.pool)
    .await?;

    if updated.rows_affected() > 0 {
        tracing::info!("[redefinição de senha — MOCK] {}: código {}", body.email.trim(), code);
    }
    Ok(Json(serde_json::json!({ "sent": true })))
}

#[derive(Debug, Deserialize)]
pub struct RedefinirSenhaInput {
    pub email: String,
    pub codigo: String,
    pub nova_senha: String,
}

pub async fn redefinir_senha(State(state): State<AppState>, Json(body): Json<RedefinirSenhaInput>) -> Result<Json<serde_json::Value>, AppError> {
    if body.nova_senha.len() < 8 {
        return Err(AppError::BadRequest("a senha precisa ter pelo menos 8 caracteres".to_string()));
    }
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, reset_code FROM subscribers WHERE lower(email) = lower($1) AND reset_expires_at > now()",
    )
    .bind(body.email.trim())
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, Some(code))) = row else {
        return Err(AppError::BadRequest("código inválido ou expirado".to_string()));
    };
    if code != body.codigo.trim() {
        return Err(AppError::BadRequest("código inválido ou expirado".to_string()));
    }

    let hash = hash_password(&body.nova_senha)?;
    sqlx::query("UPDATE subscribers SET password_hash = $1, reset_code = NULL, reset_expires_at = NULL WHERE id = $2")
        .bind(&hash)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "reset": true })))
}
