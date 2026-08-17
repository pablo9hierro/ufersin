//! Tools da demo — mesmo formato de function-calling da OpenAI/OpenRouter
//! (`{name, description, parameters}` em JSON Schema). Executadas sempre
//! localmente contra `mock_data.rs`, nunca contra `ecommerce/backend` nem o
//! Postgres real — é o que garante que a demo nunca vaza/mistura dado de
//! tenant de verdade, mesmo que o modelo "alucine" uma tentativa diferente.

use serde_json::{json, Value};

use super::mock_data;
use super::vrtech_catalog;

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
            json!({
                "type": "function",
                "function": {
                    "name": "adicionar_ao_carrinho",
                    "description": "Adiciona um item ao carrinho do cliente, confirmando nome e preço reais do catálogo.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "nome_produto": { "type": "string", "description": "Nome ou parte do nome do produto." },
                            "quantidade": { "type": "integer", "description": "Quantidade desse item." }
                        },
                        "required": ["nome_produto", "quantidade"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "fechar_pedido",
                    "description": "Fecha o pedido com os itens já confirmados, calcula o total real e gera o código Pix.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "itens": {
                                "type": "array",
                                "description": "Itens do carrinho já confirmados nesta conversa.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "nome_produto": { "type": "string" },
                                        "quantidade": { "type": "integer" }
                                    },
                                    "required": ["nome_produto", "quantidade"]
                                }
                            }
                        },
                        "required": ["itens"]
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
            json!({
                "type": "function",
                "function": {
                    "name": "aprovar_orcamento",
                    "description": "Aprova o orçamento de um serviço já buscado, liberando o agendamento do reparo.",
                    "parameters": {
                        "type": "object",
                        "properties": { "nome_servico": { "type": "string", "description": "Nome ou parte do nome do serviço orçado." } },
                        "required": ["nome_servico"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "agendar_servico",
                    "description": "Agenda o reparo já orçado (nome do serviço, data e horário), gerando confirmação com número da ordem.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "nome_servico": { "type": "string", "description": "Nome ou parte do nome do serviço já confirmado." },
                            "data": { "type": "string", "description": "Data desejada, como o cliente disse (ex: amanhã, 20/08)." },
                            "horario": { "type": "string", "description": "Horário desejado, ex: 14h." }
                        },
                        "required": ["nome_servico", "data", "horario"]
                    }
                }
            }),
            json!({
                "type": "function",
                "function": {
                    "name": "gerar_pagamento_pix",
                    "description": "Gera o código Pix pra pagar um serviço já orçado, com o valor real do catálogo.",
                    "parameters": {
                        "type": "object",
                        "properties": { "nome_servico": { "type": "string", "description": "Nome ou parte do nome do serviço." } },
                        "required": ["nome_servico"]
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

/// ID de pedido/ordem fictício desta sessão de demo — nunca colide com IDs
/// reais (formato DEMO-XXXX/DEMO-5XXX) nem com nada persistido de verdade.
fn fake_order_id(prefix: &str) -> String {
    let short = uuid::Uuid::new_v4().simple().to_string()[..6].to_ascii_uppercase();
    format!("{prefix}-{short}")
}

/// Código Pix "copia e cola" de demonstração — mesmo formato geral (EMV) e
/// aproximadamente o mesmo número de caracteres de um código Pix real
/// (~160), pra parecer autêntico visualmente. NUNCA é um código real, nunca
/// deve ser escaneado/pago de verdade — o CRC final é só um hash de 4 hex
/// que parece um checksum, mas não é validado por nenhum banco. Comprimento
/// fixo independente do total/order_id: usa um txid de 25 chars (padding
/// alfanumérico determinístico) em vez do order_id cru, pra não variar o
/// tamanho conforme o pedido.
fn fake_pix_code(order_id: &str, total: f64) -> String {
    let amount = format!("{total:.2}");
    let raw_txid = format!("{order_id}{}", uuid::Uuid::new_v4().simple());
    let txid: String = raw_txid.chars().filter(|c| c.is_ascii_alphanumeric()).take(25).collect();
    let txid = format!("{txid:*<25}");
    let payload_no_crc = format!(
        "00020126580014BR.GOV.BCB.PIX0136{txid}5204000053039865802BR5913RESOLUTOO DEMO6009SAO PAULO62190515{amount}630"
    );
    // CRC16-CCITT sobre o payload até aqui (incluindo "6304") — mesmo
    // algoritmo do padrão EMV real, só que o payload em si é fictício.
    let crc = crc16_ccitt(format!("{payload_no_crc}4").as_bytes());
    format!("{payload_no_crc}4{crc:04X}")
}

/// CRC16-CCITT (polinômio 0x1021, init 0xFFFF) — mesmo algoritmo que o
/// padrão EMV/Pix usa de verdade pro campo final do payload, aplicado aqui
/// sobre um payload fictício (não confundir "usa o algoritmo real" com
/// "gera um código real" — o resto do payload não corresponde a nenhuma
/// conta/banco de verdade).
fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
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

pub async fn execute(http: &reqwest::Client, kind: &str, name: &str, args: &Value) -> String {
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
        ("ecommerce", "adicionar_ao_carrinho") => {
            let nome = args.get("nome_produto").and_then(Value::as_str).unwrap_or("");
            let qty = args.get("quantidade").and_then(Value::as_i64).unwrap_or(1).max(1);
            match mock_data::ecommerce_products().iter().find(|p| word_match(p.name, nome)) {
                Some(p) => format!(
                    "Adicionado: {qty}x {} — R$ {:.2} cada, subtotal R$ {:.2}.",
                    p.name, p.price, p.price * qty as f64
                ),
                None => format!("\"{nome}\" não encontrado no catálogo — não adicione, avise o cliente e pergunte outro item."),
            }
        }
        ("ecommerce", "fechar_pedido") => {
            let itens = args.get("itens").and_then(Value::as_array).cloned().unwrap_or_default();
            let mut linhas = Vec::new();
            let mut total = 0.0_f64;
            let mut algum_nao_encontrado = false;
            for item in &itens {
                let nome = item.get("nome_produto").and_then(Value::as_str).unwrap_or("");
                let qty = item.get("quantidade").and_then(Value::as_i64).unwrap_or(1).max(1);
                match mock_data::ecommerce_products().iter().find(|p| word_match(p.name, nome)) {
                    Some(p) => {
                        let subtotal = p.price * qty as f64;
                        total += subtotal;
                        linhas.push(format!("{qty}x {} — R$ {:.2}", p.name, subtotal));
                    }
                    None => algum_nao_encontrado = true,
                }
            }
            if linhas.is_empty() {
                return "Nenhum item válido pra fechar o pedido — confirme os itens de novo.".to_string();
            }
            let pedido_id = fake_order_id("PED");
            let pix = fake_pix_code(&pedido_id, total);
            format!(
                "Pedido {pedido_id} fechado.\n{}\nTotal: R$ {total:.2}\nCódigo Pix copia e cola: {pix}{}",
                linhas.join("\n"),
                if algum_nao_encontrado { "\n(um item não foi encontrado e ficou de fora do total)" } else { "" }
            )
        }
        ("eletronicos", "buscar_servico") => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let hits = vrtech_catalog::search(http, query).await;
            if hits.is_empty() {
                format!("Nenhum serviço encontrado para \"{query}\" no catálogo de serviços.")
            } else {
                hits.iter().map(|s| format!("- {} | R$ {:.2}", s.label, s.price)).collect::<Vec<_>>().join("\n")
            }
        }
        ("eletronicos", "consultar_ordem_servico") => {
            let id = args.get("id").and_then(Value::as_str).unwrap_or("");
            match mock_data::eletronicos_orders().iter().find(|o| o.id.eq_ignore_ascii_case(id)) {
                Some(o) => format!("Ordem {} — {} ({}) — status: {}", o.id, o.device, o.issue, o.status),
                None => format!("Nenhuma ordem de serviço de demonstração encontrada com o ID \"{id}\"."),
            }
        }
        ("eletronicos", "aprovar_orcamento") => {
            let nome = args.get("nome_servico").and_then(Value::as_str).unwrap_or("");
            match vrtech_catalog::search(http, nome).await.into_iter().next() {
                Some(s) => format!(
                    "Orçamento aprovado: {} — R$ {:.2}. Pode seguir pra agendar o reparo.",
                    s.label, s.price
                ),
                None => format!("\"{nome}\" não encontrado no catálogo de serviços — confirme o serviço certo com o cliente antes de aprovar."),
            }
        }
        ("eletronicos", "agendar_servico") => {
            let nome = args.get("nome_servico").and_then(Value::as_str).unwrap_or("");
            let data = args.get("data").and_then(Value::as_str).unwrap_or("");
            let horario = args.get("horario").and_then(Value::as_str).unwrap_or("");
            match vrtech_catalog::search(http, nome).await.into_iter().next() {
                Some(s) => {
                    let ordem_id = fake_order_id("OS");
                    format!(
                        "Agendado: {} para {data} às {horario}. Preço: R$ {:.2}. Ordem de serviço: {ordem_id}.",
                        s.label, s.price
                    )
                }
                None => format!("\"{nome}\" não encontrado no catálogo de serviços — não agende, confirme o serviço certo com o cliente."),
            }
        }
        ("eletronicos", "gerar_pagamento_pix") => {
            let nome = args.get("nome_servico").and_then(Value::as_str).unwrap_or("");
            match vrtech_catalog::search(http, nome).await.into_iter().next() {
                Some(s) => {
                    let ordem_id = fake_order_id("OS");
                    let pix = fake_pix_code(&ordem_id, s.price);
                    format!("Valor: R$ {:.2}. Código Pix copia e cola: {pix}", s.price)
                }
                None => format!("\"{nome}\" não encontrado no catálogo de serviços — não gere pagamento, confirme o serviço certo com o cliente."),
            }
        }
        _ => format!("Ferramenta desconhecida: {name}"),
    }
}
