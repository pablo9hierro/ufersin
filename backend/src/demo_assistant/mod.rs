//! Demo pública de assistente de IA (landing page) — motor de IA real,
//! dados inteiramente mockados (`mock_data.rs`), nunca toca tenant real.
//! Ver plano/arquitetura na conversa que originou este módulo: fallback
//! OpenAI → OpenRouter (llm.rs), rate limit server-side (rate_limit.rs),
//! prompt customizável só client-side (nunca persistido no servidor).

pub mod llm;
pub mod mock_data;
pub mod prompts;
pub mod rate_limit;
pub mod tools;
pub mod vrtech_catalog;

pub const VALID_KINDS: &[&str] = &["ecommerce", "eletronicos"];

pub fn is_valid_kind(kind: &str) -> bool {
    VALID_KINDS.contains(&kind)
}
