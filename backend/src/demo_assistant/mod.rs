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

/// Remove acentos comuns do português (minúsculos — chame depois de
/// `.to_lowercase()`) — bug real visto ao vivo: cliente digitando "hamburguer"
/// sem acento não batia com "Hambúrguer Artesanal" no catálogo. Digitar sem
/// acento é extremamente comum (teclado de celular), então conta como o
/// mesmo tipo de "erro de digitação" que a busca já tolera por outros meios.
pub fn fold_accents(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}
