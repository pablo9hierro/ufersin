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

/// Busca no catálogo real por palavra (mesma lógica de `word_match` do
/// resto do módulo) — casa contra "{modelo} {tipo de reparo}" combinados,
/// já que o cliente pode falar em qualquer ordem ("tela iphone 12" ou
/// "iphone 12 tela").
pub async fn search(http: &reqwest::Client, query: &str) -> Vec<RealService> {
    let rows = fetch_active_services(http).await;
    let words: Vec<String> = query
        .split_whitespace()
        .filter(|w| w.len() >= 2)
        .map(|w| w.to_lowercase())
        .collect();
    rows.into_iter()
        .filter(|r| {
            let haystack = format!("{} {}", r.model_name, r.repair_type).to_lowercase();
            if words.is_empty() {
                haystack.contains(&query.to_lowercase())
            } else {
                words.iter().all(|w| haystack.contains(w))
            }
        })
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
