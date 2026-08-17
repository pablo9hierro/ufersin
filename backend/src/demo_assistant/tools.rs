//! Tools da demo — mesmo formato de function-calling da OpenAI/OpenRouter
//! (`{name, description, parameters}` em JSON Schema). Executadas sempre
//! localmente contra `mock_data.rs`, nunca contra `ecommerce/backend` nem o
//! Postgres real — é o que garante que a demo nunca vaza/mistura dado de
//! tenant de verdade, mesmo que o modelo "alucine" uma tentativa diferente.

use serde_json::{json, Value};

use super::mock_data;

pub fn tools_for(kind: &str) -> Vec<Value> {
    match kind {
        "ecommerce" => vec![
            json!({
                "type": "function",
                "function": {
                    "name": "buscar_produtos",
                    "description": "Busca produtos do catálogo de demonstração por nome ou categoria.",
                    "parameters": {
                        "type": "object",
                        "properties": { "query": { "type": "string", "description": "Termo de busca, ex: 'pizza', 'bebida'." } },
                        "required": ["query"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "consultar_pedido",
                    "description": "Consulta um pedido de demonstração pelo ID (formato DEMO-XXXX).",
                    "parameters": {
                        "type": "object",
                        "properties": { "id": { "type": "string", "description": "ID do pedido, ex: DEMO-1001." } },
                        "required": ["id"]
                    }
                }
            }),
        ],
        "eletronicos" => vec![
            json!({
                "type": "function",
                "function": {
                    "name": "buscar_servico",
                    "description": "Busca serviços de conserto no catálogo de demonstração por nome/aparelho.",
                    "parameters": {
                        "type": "object",
                        "properties": { "query": { "type": "string", "description": "Termo de busca, ex: 'tela iphone', 'bateria'." } },
                        "required": ["query"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "consultar_ordem_servico",
                    "description": "Consulta uma ordem de serviço de demonstração pelo ID (formato DEMO-5XXX).",
                    "parameters": {
                        "type": "object",
                        "properties": { "id": { "type": "string", "description": "ID da ordem, ex: DEMO-5001." } },
                        "required": ["id"]
                    }
                }
            }),
        ],
        _ => vec![],
    }
}

fn norm(s: &str) -> String {
    s.to_lowercase()
}

/// Casa por PALAVRA, não por substring exata na ordem digitada — testado ao
/// vivo: a consulta "iphone 12 tela" não batia com "Troca de tela iPhone
/// 12" porque a ordem das palavras é diferente. Cada palavra da busca
/// (exceto muito curtas) precisa aparecer em algum lugar do texto alvo.
fn word_match(target: &str, query: &str) -> bool {
    let target = norm(target);
    let words: Vec<&str> = query.split_whitespace().filter(|w| w.len() >= 2).collect();
    if words.is_empty() {
        return target.contains(&norm(query));
    }
    words.iter().all(|w| target.contains(&norm(w)))
}

pub fn execute(kind: &str, name: &str, args: &Value) -> String {
    match (kind, name) {
        ("ecommerce", "buscar_produtos") => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let hits: Vec<String> = mock_data::ecommerce_products()
                .iter()
                .filter(|p| word_match(p.name, query) || word_match(p.category, query))
                .map(|p| format!("- {} | R$ {:.2} | categoria: {}", p.name, p.price, p.category))
                .collect();
            if hits.is_empty() {
                format!("Nenhum produto encontrado para \"{query}\" no catálogo de demonstração.")
            } else {
                hits.join("\n")
            }
        }
        ("ecommerce", "consultar_pedido") => {
            let id = args.get("id").and_then(Value::as_str).unwrap_or("");
            match mock_data::ecommerce_orders().iter().find(|o| o.id.eq_ignore_ascii_case(id)) {
                Some(o) => format!("Pedido {} — {} — status: {}{}", o.id, o.items, o.status, if o.extra.is_empty() { String::new() } else { format!(" ({})", o.extra) }),
                None => format!("Nenhum pedido de demonstração encontrado com o ID \"{id}\"."),
            }
        }
        ("eletronicos", "buscar_servico") => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let hits: Vec<String> = mock_data::eletronicos_services()
                .iter()
                .filter(|s| word_match(s.name, query))
                .map(|s| match s.price_to {
                    Some(to) => format!("- {} | R$ {:.2} a R$ {:.2} | prazo: {}", s.name, s.price_from, to, s.eta),
                    None => format!("- {} | R$ {:.2} | prazo: {}", s.name, s.price_from, s.eta),
                })
                .collect();
            if hits.is_empty() {
                format!("Nenhum serviço encontrado para \"{query}\" no catálogo de demonstração.")
            } else {
                hits.join("\n")
            }
        }
        ("eletronicos", "consultar_ordem_servico") => {
            let id = args.get("id").and_then(Value::as_str).unwrap_or("");
            match mock_data::eletronicos_orders().iter().find(|o| o.id.eq_ignore_ascii_case(id)) {
                Some(o) => format!("Ordem {} — {} ({}) — status: {}", o.id, o.device, o.issue, o.status),
                None => format!("Nenhuma ordem de serviço de demonstração encontrada com o ID \"{id}\"."),
            }
        }
        _ => format!("Ferramenta desconhecida: {name}"),
    }
}
