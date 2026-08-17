//! Rotas públicas da demo de assistente de IA da landing — ver
//! `demo_assistant/mod.rs` pro desenho geral. Nunca autenticado (é
//! marketing pré-venda), nunca toca dado de tenant real.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::demo_assistant::{self, llm, mock_data, prompts, rate_limit, tools};
use crate::error::AppError;
use crate::state::AppState;

fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

#[derive(Debug, Serialize)]
pub struct DemoConfigOutput {
    pub kind: String,
    pub default_system_prompt: String,
    pub sample_questions: Vec<String>,
    pub mock_products: Option<Vec<mock_data::DemoProduct>>,
    pub mock_services: Option<Vec<mock_data::DemoService>>,
}

/// GET /api/public/demo-assistant/{kind}/config
pub async fn config(Path(kind): Path<String>) -> Result<Json<DemoConfigOutput>, AppError> {
    if !demo_assistant::is_valid_kind(&kind) {
        return Err(AppError::BadRequest("kind inválido — use 'ecommerce' ou 'eletronicos'".to_string()));
    }
    let default_system_prompt = prompts::default_system_prompt(&kind)
        .ok_or_else(|| AppError::BadRequest("kind inválido".to_string()))?
        .to_string();
    Ok(Json(DemoConfigOutput {
        mock_products: (kind == "ecommerce").then(|| mock_data::ecommerce_products().to_vec()),
        mock_services: (kind == "eletronicos").then(|| mock_data::eletronicos_services().to_vec()),
        sample_questions: prompts::sample_questions(&kind).iter().map(|s| s.to_string()).collect(),
        default_system_prompt,
        kind,
    }))
}

#[derive(Debug, Deserialize)]
pub struct DemoMessageInput {
    pub session_id: String,
    #[serde(default)]
    pub history: Vec<DemoHistoryMessage>,
    pub message: String,
    /// Prompt customizado da SESSÃO do visitante (nunca persistido no
    /// servidor) — ausente/vazio = usa o padrão de `prompts.rs`.
    #[serde(default)]
    pub prompt_override: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DemoHistoryMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct DemoMessageOutput {
    pub reply: String,
    pub tool_calls_used: usize,
}

/// POST /api/public/demo-assistant/{kind}/message
pub async fn message(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    headers: HeaderMap,
    Json(body): Json<DemoMessageInput>,
) -> Result<Json<DemoMessageOutput>, AppError> {
    if !demo_assistant::is_valid_kind(&kind) {
        return Err(AppError::BadRequest("kind inválido — use 'ecommerce' ou 'eletronicos'".to_string()));
    }
    if body.session_id.trim().is_empty() {
        return Err(AppError::BadRequest("session_id é obrigatório".to_string()));
    }
    let user_message = body.message.trim();
    if user_message.is_empty() {
        return Err(AppError::BadRequest("mensagem vazia".to_string()));
    }
    if user_message.len() > 2000 {
        return Err(AppError::BadRequest("mensagem muito longa".to_string()));
    }

    let ip = client_ip(&headers);
    rate_limit::check_and_increment(&state.pool, &state.demo_rate_limit, &body.session_id, &kind, &ip).await?;

    let system = body
        .prompt_override
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 4000)
        .map(str::to_string)
        .or_else(|| prompts::default_system_prompt(&kind))
        .ok_or_else(|| AppError::BadRequest("kind inválido".to_string()))?;

    // Últimas 12 mensagens só — limita custo por chamada independente da
    // contagem de rate limit (histórico cresce a cada turno).
    let history: Vec<(String, String)> = body
        .history
        .iter()
        .rev()
        .take(12)
        .rev()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| (m.role.clone(), m.content.clone()))
        .collect();

    let tools_for_kind = tools::tools_for(&kind);
    let result = llm::chat_with_tools(
        &state.http,
        &state.demo_ai,
        &system,
        &history,
        user_message,
        tools_for_kind,
        &kind,
    )
    .await?;

    Ok(Json(DemoMessageOutput { reply: result.reply, tool_calls_used: result.tool_calls_used }))
}
