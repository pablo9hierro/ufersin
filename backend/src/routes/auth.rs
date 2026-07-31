use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::{hash_password, AuthSubscriber};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct BootstrapInput {
    pub loja_nome: String,
    pub responsavel_nome: String,
    pub whatsapp: String,
    /// Senha em texto puro — só usada pra gerar `password_hash` Argon2
    /// pro handoff do admin do tenant (nunca autentica o subscriber;
    /// isso é 100% Supabase Auth e-mail+senha).
    pub senha: String,
}

#[derive(Debug, Serialize)]
pub struct BootstrapOutput {
    pub id: String,
    pub ja_existia: bool,
}

/// Primeira chamada autenticada depois que o Supabase confirma a conta
/// (sessão imediata no signUp, ou clique no link de confirmação de
/// e-mail) — cria a linha em `subscribers` com o mesmo id do usuário
/// Supabase (claims.sub), sem plano nenhum atrelado ainda (ver
/// ARQUITETURA.md §6). Idempotente: se a linha já existe, só devolve o
/// estado atual, nunca sobrescreve dados já preenchidos.
pub async fn bootstrap(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<BootstrapInput>,
) -> Result<Json<BootstrapOutput>, AppError> {
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM subscribers WHERE id = $1")
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Ok(Json(BootstrapOutput { id: claims.sub, ja_existia: true }));
    }

    if body.loja_nome.trim().is_empty() || body.responsavel_nome.trim().is_empty() || body.whatsapp.trim().is_empty() {
        return Err(AppError::BadRequest("nome da loja, responsável e WhatsApp são obrigatórios".to_string()));
    }
    let email = claims
        .email
        .clone()
        .ok_or_else(|| AppError::BadRequest("conta Supabase sem e-mail associado".to_string()))?;
    let password_hash = if body.senha.len() >= 8 {
        hash_password(&body.senha)?
    } else {
        return Err(AppError::BadRequest("a senha precisa ter pelo menos 8 caracteres".to_string()));
    };

    sqlx::query(
        "INSERT INTO subscribers (id, loja_nome, responsavel_nome, whatsapp, email, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'sem_assinatura')",
    )
    .bind(&claims.sub)
    .bind(body.loja_nome.trim())
    .bind(body.responsavel_nome.trim())
    .bind(body.whatsapp.trim())
    .bind(email.trim())
    .bind(&password_hash)
    .execute(&state.pool)
    .await?;

    Ok(Json(BootstrapOutput { id: claims.sub, ja_existia: false }))
}
