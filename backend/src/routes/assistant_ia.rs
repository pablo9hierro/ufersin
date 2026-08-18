//! Proxies autenticados pro serviço assistant-ia (repo separado
//! `a-vrtek-gente`) — usados pela aba "Assistente IA" em
//! `/meu-plano/assistente-ia` (AuthSubscriber, por tenant) E pelo painel
//! superadmin de motores de IA da plataforma (AuthSuperadmin, sem tenant).
//! O browser nunca fala com o assistant-ia direto nem conhece a chave
//! interna dele; o slug do lojista autenticado é sempre resolvido aqui a
//! partir de `claims.sub`, nunca aceito do cliente, então um assinante
//! nunca alcança a config/RAG de outro.

use axum::extract::{Multipart, Path, State};
use axum::Json;

use crate::auth::{AuthSubscriber, AuthSuperadmin};
use crate::error::AppError;
use crate::state::AppState;

fn assistant_ia_base_url() -> Result<String, AppError> {
    let url = std::env::var("ASSISTANT_IA_URL").unwrap_or_default();
    if url.trim().is_empty() {
        return Err(AppError::Internal("ASSISTANT_IA_URL not configured".to_string()));
    }
    Ok(url.trim_end_matches('/').to_string())
}

async fn assistant_ia_base_and_slug(state: &AppState, subscriber_id: &str) -> Result<(String, String), AppError> {
    let assistant_ia_url = assistant_ia_base_url()?;
    let slug: Option<(Option<String>,)> = sqlx::query_as("SELECT slug FROM subscribers WHERE id = $1")
        .bind(subscriber_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((Some(slug),)) = slug else {
        return Err(AppError::BadRequest("assine e configure sua loja antes de usar a Assistente IA".to_string()));
    };
    Ok((assistant_ia_url, slug))
}

fn assistant_ia_internal_key() -> Result<String, AppError> {
    let key = std::env::var("ASSISTANT_IA_INTERNAL_KEY").unwrap_or_default();
    if key.trim().is_empty() {
        return Err(AppError::Internal("ASSISTANT_IA_INTERNAL_KEY not configured".to_string()));
    }
    Ok(key)
}

pub async fn get_config(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<serde_json::Value>, AppError> {
    let (base, slug) = assistant_ia_base_and_slug(&state, &claims.sub).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .get(format!("{base}/api/tenants/{slug}/config"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(body))
}

pub async fn put_config(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (base, slug) = assistant_ia_base_and_slug(&state, &claims.sub).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .put(format!("{base}/api/tenants/{slug}/config"))
        .header("x-internal-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(out))
}

pub async fn list_rag_documents(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<Json<serde_json::Value>, AppError> {
    let (base, slug) = assistant_ia_base_and_slug(&state, &claims.sub).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .get(format!("{base}/api/tenants/{slug}/rag/documents"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(body))
}

/// Repassa o arquivo recebido (campo "file") pro assistant-ia, que faz o
/// parsing/chunking/indexação de verdade — este proxy só troca a
/// autenticação (Supabase -> chave interna), nunca toca o conteúdo do
/// arquivo além de encaminhar os bytes.
pub async fn upload_rag_document(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let (base, slug) = assistant_ia_base_and_slug(&state, &claims.sub).await?;
    let key = assistant_ia_internal_key()?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("upload inválido: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let filename = field.file_name().unwrap_or("arquivo").to_string();
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("upload inválido: {e}")))?;

        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name(filename)
            .mime_str(&content_type)
            .map_err(|e| AppError::Internal(format!("falha ao montar upload: {e}")))?;
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = state
            .http
            .post(format!("{base}/api/tenants/{slug}/rag/documents"))
            .header("x-internal-key", key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
        let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
        return Ok(Json(out));
    }
    Err(AppError::BadRequest("campo file ausente no upload".to_string()))
}

pub async fn delete_rag_document(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (base, slug) = assistant_ia_base_and_slug(&state, &claims.sub).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .delete(format!("{base}/api/tenants/{slug}/rag/documents/{id}"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(out))
}

// ---------- Motores de IA da plataforma (painel superadmin, sem tenant) ----------
//
// Ranking com fallback automático: qual motor responde por TODAS as
// assistentes de IA, de qualquer tenant/ramo — controlado só pelo dono da
// plataforma (AuthSuperadmin), nunca pelo lojista. O a-vrtek-gente tenta
// cada motor habilitado em ordem de prioridade; se o do topo cair/não
// responder, cai pro próximo sozinho (ver aiClient.ts lá).

pub async fn list_ai_engines(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<serde_json::Value>, AppError> {
    let base = assistant_ia_base_url()?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .get(format!("{base}/api/platform/ai-engines"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(out))
}

pub async fn create_ai_engine(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let base = assistant_ia_base_url()?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .post(format!("{base}/api/platform/ai-engines"))
        .header("x-internal-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(out))
}

pub async fn update_ai_engine(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let base = assistant_ia_base_url()?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .put(format!("{base}/api/platform/ai-engines/{id}"))
        .header("x-internal-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(out))
}

pub async fn delete_ai_engine(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let base = assistant_ia_base_url()?;
    let key = assistant_ia_internal_key()?;
    state
        .http
        .delete(format!("{base}/api/platform/ai-engines/{id}"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Reordena a lista inteira de uma vez — `ids` já vem na ordem de
/// prioridade desejada (índice 0 = novo topo do ranking = próximo motor
/// padrão). É como o dropdown "mudar motor padrão" do painel funciona: só
/// promove o escolhido pro topo, mantendo os demais como fallback abaixo.
pub async fn reorder_ai_engines(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let base = assistant_ia_base_url()?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .put(format!("{base}/api/platform/ai-engines/order"))
        .header("x-internal-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let out: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(out))
}
