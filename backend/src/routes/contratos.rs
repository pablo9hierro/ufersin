//! Rotas do módulo de contratos (PandaDoc-ready).

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::auth::AuthSubscriber;
use crate::error::AppError;
use crate::pandadoc::{self, CreateSessionRequest};
use crate::state::AppState;

#[derive(Debug, Serialize, FromRow)]
pub struct CatalogItem {
    pub kind: String,
    pub title: String,
    pub description: Option<String>,
    pub version: Option<i32>,
    pub version_status: Option<String>,
    pub pandadoc_ready: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct MyDocument {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub pandadoc_document_id: Option<String>,
    pub pandadoc_share_link: Option<String>,
    pub signed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Catálogo público — sem texto de cláusulas (ainda a formular no PandaDoc).
pub async fn catalog(State(state): State<AppState>) -> Result<Json<Vec<CatalogItem>>, AppError> {
    let rows: Vec<CatalogItem> = sqlx::query_as(
        "SELECT t.kind, t.title, t.description, v.version, v.status AS version_status, \
         (t.pandadoc_template_id IS NOT NULL OR v.pandadoc_template_id IS NOT NULL) AS pandadoc_ready \
         FROM contract_templates t \
         LEFT JOIN LATERAL ( \
           SELECT version, status, pandadoc_template_id FROM contract_template_versions \
           WHERE template_id = t.id ORDER BY version DESC LIMIT 1 \
         ) v ON true \
         WHERE t.active = true \
         ORDER BY t.kind",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn me_documents(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<Vec<MyDocument>>, AppError> {
    let rows: Vec<MyDocument> = sqlx::query_as(
        "SELECT id::text, kind, status, pandadoc_document_id, pandadoc_share_link, signed_at, created_at \
         FROM contract_documents WHERE subscriber_id = $1 ORDER BY created_at DESC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct AcceptInput {
    pub kind: String,
    #[serde(default)]
    pub channel: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AcceptOutput {
    pub id: String,
    pub kind: String,
    pub accepted: bool,
}

fn valid_kind(kind: &str) -> bool {
    matches!(
        kind,
        "platform_subscription" | "checkout_compra_normal" | "checkout_mais18"
    )
}

pub async fn accept(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<AcceptInput>,
) -> Result<Json<AcceptOutput>, AppError> {
    if !valid_kind(&body.kind) {
        return Err(AppError::BadRequest("kind de contrato inválido".to_string()));
    }
    let channel = body.channel.as_deref().unwrap_or("checkbox");
    let version_id: Option<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT v.id FROM contract_template_versions v \
         JOIN contract_templates t ON t.id = v.template_id \
         WHERE t.kind = $1 AND t.active = true \
         ORDER BY v.version DESC LIMIT 1",
    )
    .bind(&body.kind)
    .fetch_optional(&state.pool)
    .await?;

    let id: (uuid::Uuid,) = sqlx::query_as(
        "INSERT INTO contract_acceptances \
         (kind, template_version_id, subscriber_id, acceptor_role, accepted, channel) \
         VALUES ($1, $2, $3, 'lojista', true, $4) RETURNING id",
    )
    .bind(&body.kind)
    .bind(version_id.map(|v| v.0))
    .bind(&claims.sub)
    .bind(channel)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(AcceptOutput {
        id: id.0.to_string(),
        kind: body.kind,
        accepted: true,
    }))
}

#[derive(Debug, Deserialize)]
pub struct CheckoutAcceptInput {
    pub kind: String,
    pub tenant_slug: String,
    #[serde(default)]
    pub order_ref: Option<String>,
    #[serde(default)]
    pub acceptor_email: Option<String>,
    #[serde(default)]
    pub acceptor_name: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
}

/// Aceite do cliente no checkout da loja (público; sem auth Resolutoo).
pub async fn accept_checkout(
    State(state): State<AppState>,
    Json(body): Json<CheckoutAcceptInput>,
) -> Result<Json<AcceptOutput>, AppError> {
    if !matches!(body.kind.as_str(), "checkout_compra_normal" | "checkout_mais18") {
        return Err(AppError::BadRequest("kind de checkout inválido".to_string()));
    }
    let slug = body.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1::bigint FROM subscribers WHERE slug = $1 AND status = 'ativo'")
            .bind(&slug)
            .fetch_optional(&state.pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("loja não encontrada".to_string()));
    }

    let channel = body.channel.as_deref().unwrap_or("checkbox");
    let version_id: Option<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT v.id FROM contract_template_versions v \
         JOIN contract_templates t ON t.id = v.template_id \
         WHERE t.kind = $1 AND t.active = true \
         ORDER BY v.version DESC LIMIT 1",
    )
    .bind(&body.kind)
    .fetch_optional(&state.pool)
    .await?;

    let id: (uuid::Uuid,) = sqlx::query_as(
        "INSERT INTO contract_acceptances \
         (kind, template_version_id, tenant_slug, order_ref, acceptor_role, acceptor_email, acceptor_name, accepted, channel) \
         VALUES ($1, $2, $3, $4, 'cliente', $5, $6, true, $7) RETURNING id",
    )
    .bind(&body.kind)
    .bind(version_id.map(|v| v.0))
    .bind(&slug)
    .bind(&body.order_ref)
    .bind(&body.acceptor_email)
    .bind(&body.acceptor_name)
    .bind(channel)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(AcceptOutput {
        id: id.0.to_string(),
        kind: body.kind,
        accepted: true,
    }))
}

/// Status público da integração (sem segredos) — o front de /assinar usa pra
/// saber se mostra “e-sign PandaDoc” ou só checkbox.
pub async fn pandadoc_status(State(state): State<AppState>) -> Json<pandadoc::StatusResponse> {
    Json(pandadoc::status(&state.pandadoc))
}

pub async fn pandadoc_session(
    State(state): State<AppState>,
    AuthSubscriber(_claims): AuthSubscriber,
    Json(body): Json<CreateSessionRequest>,
) -> Result<Json<pandadoc::CreateSessionResponse>, AppError> {
    // Só contrato do lojista. Checkout kinds → mensagem explícita (checkbox only).
    if body.kind != "platform_subscription" {
        return Ok(Json(pandadoc::create_signing_session(&state.pandadoc, &state.http, &body).await));
    }
    let resp = pandadoc::create_signing_session(&state.pandadoc, &state.http, &body).await;
    Ok(Json(resp))
}
