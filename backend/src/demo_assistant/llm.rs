//! Cliente de IA da demo — mesmo formato de request/response (OpenAI-compatible
//! chat completions + tool calling) pra OpenAI e OpenRouter, com fallback
//! automático: padrão é OpenAI, e se a chamada falhar de forma PERMANENTE
//! (chave inválida/sem crédito/modelo removido — nunca timeout ou 5xx
//! pontual), tenta o próximo modelo configurado em ordem (OpenRouter).
//! Mesmo padrão já usado e validado no tenant vrtech (ver `caralho/src/lib/
//! assistant/aiClient.ts`, mesma lógica, outra linguagem). Zero Anthropic —
//! só OpenAI (padrão) + OpenRouter (fallback), por decisão explícita do
//! dono da plataforma.

use serde_json::{json, Value};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    OpenRouter,
}

#[derive(Debug, Clone)]
pub struct DemoAiModel {
    pub provider: Provider,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Default)]
pub struct DemoAiConfig {
    pub models: Vec<DemoAiModel>,
}

impl DemoAiConfig {
    pub fn from_env() -> Self {
        let mut models = Vec::new();

        let openai_key = env_opt("DEMO_AI_OPENAI_API_KEY");
        let openai_model = std::env::var("DEMO_AI_OPENAI_MODEL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "gpt-4o-mini".to_string());
        if let Some(key) = openai_key {
            models.push(DemoAiModel { provider: Provider::OpenAi, model: openai_model, api_key: key });
        }

        if let Some(key) = env_opt("DEMO_AI_OPENROUTER_API_KEY") {
            let fallback_models = std::env::var("DEMO_AI_OPENROUTER_MODELS")
                .ok()
                .unwrap_or_default();
            for m in fallback_models.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                models.push(DemoAiModel { provider: Provider::OpenRouter, model: m.to_string(), api_key: key.clone() });
            }
        }

        Self { models }
    }

    pub fn enabled(&self) -> bool {
        !self.models.is_empty()
    }
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn endpoint(provider: &Provider) -> &'static str {
    match provider {
        Provider::OpenAi => "https://api.openai.com/v1/chat/completions",
        Provider::OpenRouter => "https://openrouter.ai/api/v1/chat/completions",
    }
}

enum CallOutcome {
    Success(Value),
    Permanent(String),
    Transient(String),
}

/// Chave/cota/modelo indisponível de vez (troca de modelo automaticamente)
/// vs erro de rede/instabilidade pontual (propaga o erro do turno, sem
/// trocar de modelo — igual à lógica já validada em aiClient.ts).
fn classify(status: reqwest::StatusCode, body: &str) -> CallOutcome {
    let permanent_status = matches!(status.as_u16(), 401 | 403 | 404);
    let quota_hint = {
        let lower = body.to_lowercase();
        lower.contains("insufficient_quota") || lower.contains("billing_hard_limit") || lower.contains("exceeded") && lower.contains("quota") || lower.contains("model_not_found")
    };
    if permanent_status || (status.as_u16() == 429 && quota_hint) {
        CallOutcome::Permanent(format!("HTTP {}: {}", status.as_u16(), truncate(body, 300)))
    } else {
        CallOutcome::Transient(format!("HTTP {}: {}", status.as_u16(), truncate(body, 300)))
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n { s.to_string() } else { format!("{}…", &s[..n]) }
}

/// Modelos de raciocínio (gpt-5*, o1*, o3*, o4*) têm uma API de chamada
/// diferente: rejeitam `max_tokens` (exigem `max_completion_tokens`) e
/// `temperature` custom (só aceitam o default), e sem `reasoning_effort`
/// baixo gastam o budget inteiro "pensando" antes de responder — testado ao
/// vivo: gpt-5-nano com reasoning padrão devolveu conteúdo vazio
/// (finish_reason "length", 500 reasoning_tokens, 0 de resposta). Com
/// `reasoning_effort: "minimal"` responde normal e ainda chama tool
/// corretamente quando o prompt instrui isso.
fn is_reasoning_model(model: &str) -> bool {
    model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3") || model.starts_with("o4")
}

async fn call_provider(http: &reqwest::Client, model: &DemoAiModel, body: &Value) -> CallOutcome {
    let mut full = body.clone();
    full["model"] = json!(model.model);

    let res = http
        .post(endpoint(&model.provider))
        .timeout(std::time::Duration::from_secs(30))
        .bearer_auth(&model.api_key)
        .json(&full)
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => return CallOutcome::Transient(e.to_string()),
    };
    let status = res.status();
    let text = match res.text().await {
        Ok(t) => t,
        Err(e) => return CallOutcome::Transient(e.to_string()),
    };
    if !status.is_success() {
        return classify(status, &text);
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => CallOutcome::Success(v),
        Err(e) => CallOutcome::Transient(format!("resposta inesperada do provedor: {e}")),
    }
}

pub struct ChatResult {
    pub reply: String,
    pub tool_calls_used: usize,
}

/// Loop de tool-calling (até 5 rounds) com fallback de modelo — tenta o
/// primeiro modelo habilitado; se falhar permanentemente, tenta o próximo,
/// do zero (reinicia o turno inteiro nesse modelo, nunca mistura estado de
/// raciocínio entre modelos diferentes).
pub async fn chat_with_tools(
    http: &reqwest::Client,
    config: &DemoAiConfig,
    system: &str,
    history: &[(String, String)],
    user_message: &str,
    tools: Vec<Value>,
    kind: &str,
) -> Result<ChatResult, AppError> {
    if !config.enabled() {
        return Err(AppError::Internal(
            "demo de IA temporariamente indisponível (nenhum modelo configurado)".to_string(),
        ));
    }

    let mut last_error = String::new();
    for model in &config.models {
        match run_turn(http, model, system, history, user_message, &tools, kind).await {
            Ok(result) => return Ok(result),
            Err(TurnError::Permanent(msg)) => {
                tracing::warn!("demo_assistant: modelo {} falhou permanentemente: {msg}", model.model);
                last_error = msg;
                continue;
            }
            Err(TurnError::Transient(msg)) => {
                return Err(AppError::Internal(format!(
                    "não foi possível falar com a IA da demo agora: {msg}"
                )));
            }
        }
    }
    Err(AppError::Internal(format!(
        "todos os modelos de IA da demo falharam. Último erro: {last_error}"
    )))
}

enum TurnError {
    Permanent(String),
    Transient(String),
}

async fn run_turn(
    http: &reqwest::Client,
    model: &DemoAiModel,
    system: &str,
    history: &[(String, String)],
    user_message: &str,
    tools: &[Value],
    kind: &str,
) -> Result<ChatResult, TurnError> {
    let mut messages: Vec<Value> = vec![json!({ "role": "system", "content": system })];
    for (role, content) in history {
        messages.push(json!({ "role": role, "content": content }));
    }
    messages.push(json!({ "role": "user", "content": user_message }));

    let reasoning = is_reasoning_model(&model.model);
    const MAX_ROUNDS: usize = 6;
    let mut tool_calls_used = 0usize;
    for round in 0..MAX_ROUNDS {
        let mut body = if reasoning {
            // Reasoning tokens saem do mesmo orçamento de max_completion_tokens
            // (invisíveis em `content`) — 800 dá folga real pra resposta de
            // chat curta mesmo com reasoning_effort minimal.
            json!({ "messages": messages, "max_completion_tokens": 800, "reasoning_effort": "minimal" })
        } else {
            json!({ "messages": messages, "max_completion_tokens": 500, "temperature": 0.3 })
        };
        // Última rodada: nunca oferece tools de novo — força uma resposta em
        // texto de verdade em vez de deixar o loop esgotar e cair na
        // mensagem engessada "não consegui processar" (testado ao vivo: o
        // modelo às vezes insiste em tool_calls indefinidamente quando o
        // pedido do cliente não cabe em nenhuma ferramenta disponível).
        let is_last_round = round == MAX_ROUNDS - 1;
        if !tools.is_empty() && !is_last_round {
            body["tools"] = json!(tools);
        }

        let outcome = call_provider(http, model, &body).await;
        let data = match outcome {
            CallOutcome::Success(v) => v,
            CallOutcome::Permanent(msg) => return Err(TurnError::Permanent(msg)),
            CallOutcome::Transient(msg) => return Err(TurnError::Transient(msg)),
        };

        let choice = &data["choices"][0]["message"];
        let tool_calls = choice.get("tool_calls").and_then(Value::as_array).cloned().unwrap_or_default();

        if !tool_calls.is_empty() {
            messages.push(choice.clone());
            for tc in &tool_calls {
                let id = tc["id"].as_str().unwrap_or_default().to_string();
                let name = tc["function"]["name"].as_str().unwrap_or_default().to_string();
                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let args: Value = serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
                let output = super::tools::execute(http, kind, &name, &args).await;
                tool_calls_used += 1;
                messages.push(json!({ "role": "tool", "tool_call_id": id, "content": output }));
            }
            continue;
        }

        let reply = choice["content"].as_str().unwrap_or("").trim().to_string();
        if !reply.is_empty() {
            return Ok(ChatResult { reply, tool_calls_used });
        }
        if is_last_round {
            break;
        }
    }

    Ok(ChatResult {
        reply: "Desculpa, pode repetir de outro jeito? Não entendi direito.".to_string(),
        tool_calls_used,
    })
}
