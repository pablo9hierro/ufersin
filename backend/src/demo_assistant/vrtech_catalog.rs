//! Catálogo de serviços REAL do vrtech (tenant eletrônicos), consultado
//! ao vivo, público e read-only — nunca fictício. É a mesma fonte que o
//! próprio site do vrtech usa (`/catalogo-servico`), e a mesma que o botão
//! "Ver demonstração" da landing abre em `/demo/eletronica/{plano}`
//! (aquilo NÃO é um catálogo mockado separado — é o site real do vrtech,
//! `vrtech-jp.vercel.app`). Descoberto ao investigar por que a demo de IA
//! não batia com o que o usuário via em `/demo/eletronica/essential`: os
//! dois agora consultam exatamente os mesmos dados.
//!
//! `SUPABASE_URL`/chave publishable abaixo NÃO são segredo — já vêm
//! embutidos no bundle JS público do site do vrtech (prefixo
//! `NEXT_PUBLIC_`), protegidos só por RLS `FOR SELECT USING (true)` (leitura
//! pública por desenho, é um catálogo de vitrine). Nunca usar essa chave
//! pra escrever nada — só leitura.
const VRTECH_SUPABASE_URL: &str = "https://zncpcsdpdkvjfknmmhpu.supabase.co";
const VRTECH_SUPABASE_ANON_KEY: &str = "sb_publishable_EZvF3PaCyc6vLn63-_ardg_xj_TwiYG";

#[derive(Debug, Clone, serde::Deserialize)]
struct ServiceRow {
    model_name: String,
    repair_type: String,
    price: f64,
    duration_minutes: Option<i64>,
}

pub struct RealService {
    pub label: String,
    pub price: f64,
}

/// Tira sufixo entre parênteses tipo "(prazo ~60 min)" — bug real visto ao
/// vivo: a IA às vezes ecoa de volta o label formatado inteiro (que ela
/// mesma recebeu de `buscar_servico`) como o `nome_servico` de
/// `aprovar_orcamento`/`agendar_servico`/`gerar_pagamento_pix`, e palavras
/// como "prazo"/"min" nunca aparecem em `model_name`/`repair_type` — o
/// match por AND de todas as palavras zerava o resultado.
fn strip_parenthetical(query: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for c in query.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = (depth - 1).max(0),
            _ if depth <= 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Busca no catálogo real por palavra (mesma lógica de `word_match` do
/// resto do módulo) — casa contra "{modelo} {tipo de reparo}" combinados,
/// já que o cliente pode falar em qualquer ordem ("tela iphone 12" ou
/// "iphone 12 tela").
pub async fn search(http: &reqwest::Client, query: &str) -> Vec<RealService> {
    let query = strip_parenthetical(query);
    let query = query.as_str();
    let rows = fetch_active_services(http).await;
    let words: Vec<String> = query
        .split_whitespace()
        .filter(|w| w.len() >= 2)
        .map(|w| super::fold_accents(&w.to_lowercase()))
        .collect();
    let mut hits: Vec<(usize, ServiceRow)> = rows
        .into_iter()
        .filter_map(|r| {
            let haystack = super::fold_accents(&format!("{} {}", r.model_name, r.repair_type).to_lowercase());
            let matches = if words.is_empty() {
                haystack.contains(&super::fold_accents(&query.to_lowercase()))
            } else {
                words.iter().all(|w| haystack.contains(w))
            };
            // Conta palavras extras no catálogo que o cliente não pediu —
            // bug real visto ao vivo: buscar "iphone 14" também batia com
            // "iPhone 14 Pro" (todas as palavras da busca aparecem lá
            // também), e o `.next()` de quem pega só o 1º resultado
            // (aprovar_orcamento etc.) pegava a variante errada de forma
            // arbitrária. Ordenar pela menos palavras extras garante que a
            // correspondência mais exata ("iPhone 14") vem antes da mais
            // genérica ("iPhone 14 Pro").
            let extra_words = haystack.split_whitespace().count().saturating_sub(words.len());
            matches.then_some((extra_words, r))
        })
        .collect();
    hits.sort_by_key(|(extra, _)| *extra);
    hits.into_iter()
        .map(|(_, r)| r)
        .map(|r| RealService {
            label: match r.duration_minutes {
                Some(min) if min > 0 => format!("{} — {} (prazo ~{} min)", r.model_name, r.repair_type, min),
                _ => format!("{} — {}", r.model_name, r.repair_type),
            },
            price: r.price,
        })
        .take(8)
        .collect()
}

async fn fetch_active_services(http: &reqwest::Client) -> Vec<ServiceRow> {
    let url = format!(
        "{VRTECH_SUPABASE_URL}/rest/v1/service_catalog_items?select=model_name,repair_type,price,duration_minutes&active=eq.true&limit=500"
    );
    let res = http
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .header("apikey", VRTECH_SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {VRTECH_SUPABASE_ANON_KEY}"))
        .header("Accept-Profile", "vrtech")
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => r.json::<Vec<ServiceRow>>().await.unwrap_or_default(),
        Ok(r) => {
            tracing::warn!("demo_assistant: catálogo real do vrtech respondeu {}", r.status());
            Vec::new()
        }
        Err(e) => {
            tracing::warn!("demo_assistant: falha ao consultar catálogo real do vrtech: {e}");
            Vec::new()
        }
    }
}
