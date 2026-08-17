use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::mercadopago_link;
use crate::orders_common;
use crate::state::AppState;
use crate::tenant;
use crate::whatsapp;

/// Receives incoming-message events from every Evolution API instance
/// (every tenant's store + every motoboy — whatsapp::set_webhook points
/// them all here). Only cares about WhatsApp location shares: matches the
/// sender's phone against an order that's waiting on a location and saves
/// the coordinates.
///
/// Public on purpose (Evolution API calls this, not a logged-in browser) —
/// always answers 200 so Evolution never retry-storms us over events we
/// don't care about.
pub async fn evolution_webhook(State(state): State<AppState>, Json(payload): Json<Value>) -> StatusCode {
    if let Err(e) = handle(&state, &payload).await {
        tracing::warn!("evolution webhook handling failed: {e:?}");
    }
    StatusCode::OK
}

/// Resolves which tenant the event's Evolution API instance belongs to.
/// Store instances match `tenants.whatsapp_instance` directly; motoboy
/// instances ("motoboy-<id>") belong to whichever tenant that motoboy is
/// under. Every instance name is unique across the whole deployment (store
/// instance names are unique per tenant row, motoboy ids are UUIDs), so
/// there's no ambiguity even though one shared webhook URL serves everyone.
async fn resolve_tenant_id(state: &AppState, instance: &str) -> anyhow::Result<Option<String>> {
    if let Some(id) = instance.strip_prefix("motoboy-") {
        let row: Option<(String,)> = sqlx::query_as("SELECT tenant_id FROM motoboys WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
        return Ok(row.map(|(t,)| t));
    }
    let tenant = tenant::tenant_for_instance(&state.pool, instance)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    Ok(tenant.map(|t| t.id))
}

async fn handle(state: &AppState, payload: &Value) -> anyhow::Result<()> {
    let instance = payload.get("instance").and_then(|v| v.as_str()).unwrap_or("?");
    tracing::info!(
        "evolution webhook: event={} instance={}",
        payload.get("event").and_then(|v| v.as_str()).unwrap_or("?"),
        instance,
    );
    // TEMP: dumping the full payload while we pin down the exact shape this
    // Evolution API version sends — remove once location capture is confirmed
    // working end-to-end.
    tracing::info!("evolution webhook payload: {payload}");

    let Some(tenant_id) = resolve_tenant_id(state, instance).await? else {
        tracing::warn!("evolution webhook: no tenant matches instance {instance}, ignoring");
        return Ok(());
    };

    let data = payload.get("data").unwrap_or(&Value::Null);
    // Some Evolution API versions nest messages.upsert events under
    // data.messages[0] instead of putting key/message directly on data —
    // handle both shapes.
    let data = data
        .get("messages")
        .and_then(|m| m.get(0))
        .unwrap_or(data);
    let message = data.get("message").unwrap_or(&Value::Null);

    // O modulo assistant-ia identifica lojas pelo slug (o mesmo usado nas
    // URLs do painel/vitrine), nao pelo id interno (UUID) — busca aqui em
    // vez de estender resolve_tenant_id, que outros chamadores usam so
    // pelo id.
    if let Ok(Some((slug,))) = sqlx::query_as::<_, (String,)>("SELECT slug FROM tenants WHERE id = $1")
        .bind(&tenant_id)
        .fetch_optional(&state.pool)
        .await
    {
        forward_to_assistant_ia(state, &slug, instance, data, message);
    }

    // WhatsApp has two distinct share types: a fixed pin ("locationMessage")
    // and a live/moving share ("liveLocationMessage") — both carry the same
    // lat/lng field names, so either is handled the same way here.
    let location = message
        .get("locationMessage")
        .or_else(|| message.get("liveLocationMessage"));
    let Some(location) = location else {
        return Ok(());
    };
    let (Some(lat), Some(lng)) = (
        location.get("degreesLatitude").and_then(|v| v.as_f64()),
        location.get("degreesLongitude").and_then(|v| v.as_f64()),
    ) else {
        return Ok(());
    };

    // "5583999999999@s.whatsapp.net" -> "5583999999999"
    let remote_jid = data
        .get("key")
        .and_then(|k| k.get("remoteJid"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let phone_digits: String = remote_jid.chars().take_while(char::is_ascii_digit).collect();
    if phone_digits.is_empty() {
        return Ok(());
    }
    let variants = phone_variants(&phone_digits);

    // No way to tell which specific order a raw WhatsApp message is "for"
    // when the same customer has more than one order awaiting a location at
    // once — so this updates all of them (within this tenant) rather than
    // guessing by recency.
    // `handle` returns anyhow::Result, and AppError isn't a std::error::Error
    // (it renders straight to an HTTP response instead) — same shape as the
    // other `?`s below that go through sqlx::Error, just needs an explicit
    // conversion since AppError doesn't implement the trait `?` relies on.
    let mut tx = tenant::tenant_tx(&state.pool, &tenant_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let result = sqlx::query(
        "UPDATE orders SET customer_lat = $1, customer_lng = $2 \
         WHERE tenant_id = $3 AND customer_whatsapp = ANY($4) AND status = 'aguardando_localizacao'",
    )
    .bind(lat)
    .bind(lng)
    .bind(&tenant_id)
    .bind(&variants)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if result.rows_affected() > 0 {
        tracing::info!(
            "captured customer location for phone {phone_digits} ({} order(s), tenant {tenant_id})",
            result.rows_affected()
        );
    } else {
        tracing::info!("got a location from {phone_digits} but no order is awaiting one from them");
    }

    Ok(())
}

/// Brazilian mobile numbers are `55` + 2-digit DDD + either 9 digits
/// (`9XXXXXXXX`, current format) or 8 (`XXXXXXXX`, what WhatsApp sometimes
/// sends instead) — so a number stored one way often arrives the other way.
/// Returns both forms so the DB match tries either.
fn phone_variants(digits: &str) -> Vec<String> {
    let mut variants = vec![digits.to_string()];
    if digits.len() == 13 && digits.starts_with("55") {
        let (prefix, rest) = digits.split_at(4);
        if let Some(without_nine) = rest.strip_prefix('9') {
            variants.push(format!("{prefix}{without_nine}"));
        }
    } else if digits.len() == 12 && digits.starts_with("55") {
        let (prefix, rest) = digits.split_at(4);
        variants.push(format!("{prefix}9{rest}"));
    }
    variants
}

// ---------------------------------------------------------------------
// Mercado Pago — confirmação de pagamento (Pix/link/cartão da LOJA, nunca
// a conta da plataforma que cobra assinatura — essa fica em outro sistema
// inteiro, ufersin/backend).
// ---------------------------------------------------------------------

/// Valida `x-signature` (formato `ts=...,v1=...`) contra o manifest
/// `id:{data_id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256 com o
/// secret da aplicação Mercado Pago (um só pra toda a Resolutoo — não é
/// por tenant). Sem secret configurado, ou assinatura ausente/malformada,
/// deixa passar (best-effort): a defesa de verdade é `fetch_payment_details`
/// logo depois, que NUNCA confia em nada do corpo — sempre rebusca o
/// pagamento na API usando o token do tenant já resolvido por outro
/// caminho (mp_user_id), então um webhook forjado não move dinheiro nenhum
/// mesmo que a assinatura passe despercebida.
fn signature_looks_valid(secret: &str, headers: &HeaderMap, data_id: &str, request_id: &str) -> bool {
    let Some(sig_header) = headers.get("x-signature").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let mut ts = None;
    let mut v1 = None;
    for part in sig_header.split(',') {
        let mut kv = part.splitn(2, '=');
        match (kv.next().map(str::trim), kv.next().map(str::trim)) {
            (Some("ts"), Some(v)) => ts = Some(v),
            (Some("v1"), Some(v)) => v1 = Some(v),
            _ => {}
        }
    }
    let (Some(ts), Some(v1)) = (ts, v1) else {
        return false;
    };
    let manifest = format!("id:{};request-id:{};ts:{};", data_id.to_lowercase(), request_id, ts);
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(manifest.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    expected.eq_ignore_ascii_case(v1)
}

/// Notifica pagamento aprovado (Pix, link de pagamento ou cartão
/// tokenizado). Só campo compartilhado: `type=payment`/`data.id` aponta
/// pro pagamento na Mercado Pago; SEMPRE rebusca na API antes de gravar
/// qualquer coisa — o corpo do webhook em si nunca é fonte de verdade.
/// Sempre 200 (nunca deixa a Mercado Pago retry-storm por um evento que a
/// gente decidiu ignorar).
pub async fn mercadopago_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(payload): Json<Value>,
) -> StatusCode {
    if let Err(e) = handle_mercadopago(&state, &headers, &query, &payload).await {
        tracing::warn!("mercadopago webhook handling failed: {e:?}");
    }
    StatusCode::OK
}

async fn handle_mercadopago(
    state: &AppState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
    payload: &Value,
) -> anyhow::Result<()> {
    let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if event_type != "payment" {
        return Ok(());
    }

    let payment_id = payload
        .get("data")
        .and_then(|d| d.get("id"))
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())))
        .or_else(|| query.get("data.id").cloned())
        .ok_or_else(|| anyhow::anyhow!("mercadopago webhook missing data.id"))?;

    let mp_user_id = payload
        .get("user_id")
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())))
        .ok_or_else(|| anyhow::anyhow!("mercadopago webhook missing user_id"))?;

    let request_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if let Some(secret) = state.mercadopago_webhook_secret.as_ref() {
        if !signature_looks_valid(secret, headers, &payment_id, &request_id) {
            tracing::warn!(
                "mercadopago webhook: assinatura ausente/invalida (payment_id={payment_id}) — \
                 seguindo mesmo assim, fetch_payment_details rebusca antes de confiar em algo"
            );
        }
    }

    let Some((tenant_id, token)) = tenant::tenant_by_mp_user_id(&state.pool, &mp_user_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?
    else {
        tracing::info!("mercadopago webhook: nenhum tenant com mp_user_id={mp_user_id}, ignorando");
        return Ok(());
    };
    if token.trim().is_empty() {
        return Ok(());
    }

    let details = mercadopago_link::fetch_payment_details(state, &token, &payment_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let Some(order_id) = details.external_reference else {
        tracing::info!("mercadopago webhook: pagamento {payment_id} sem external_reference, ignorando");
        return Ok(());
    };
    if !details.status.eq_ignore_ascii_case("approved") {
        return Ok(());
    }

    let mut tx = tenant::tenant_tx(&state.pool, &tenant_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let Some(order) = orders_common::fetch_order_row(&mut *tx, &tenant_id, &order_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?
    else {
        return Ok(());
    };
    // Idempotente — Pix já confirma por polling (refresh_payment) e o
    // webhook pode chegar depois (ou mais de uma vez); nunca decrementa
    // estoque/notifica duas vezes pro mesmo pedido.
    if order.payment_status == "pago" {
        return Ok(());
    }

    // Venda de balcão com cartão link/transparente nasce `status = 'pendente'`
    // (ver routes/pdv.rs::create_sale) — agora que o pagamento confirmou de
    // verdade, vira 'concluido' junto (balcão não tem pipeline de entrega,
    // então não passa por nenhum status intermediário). Pedido de
    // entrega/checkout público mantém o status como está — o pipeline dele
    // é tratado em outro lugar.
    // Link de pagamento (Checkout Pro) deixa o cliente escolher QUALQUER
    // forma na hora, mesmo a venda tendo nascido como "cartão" no PDV —
    // sincroniza `payment_method` com o que a Mercado Pago confirma ter
    // sido usado de verdade (COALESCE preserva o valor atual quando a MP
    // não devolve um método reconhecido).
    if order.delivery_type == "balcao" && order.status == "pendente" {
        sqlx::query(
            "UPDATE orders SET payment_status = 'pago', status = 'concluido', \
             payment_method = COALESCE($3, payment_method), updated_at = now()::text \
             WHERE tenant_id = $1 AND id = $2",
        )
        .bind(&tenant_id)
        .bind(&order_id)
        .bind(details.payment_method)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE orders SET payment_status = 'pago', payment_method = COALESCE($3, payment_method), \
             updated_at = now()::text WHERE tenant_id = $1 AND id = $2",
        )
        .bind(&tenant_id)
        .bind(&order_id)
        .bind(details.payment_method)
        .execute(&mut *tx)
        .await?;
    }
    orders_common::decrement_stock_for_order(&mut *tx, &tenant_id, &order_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    tx.commit().await?;

    let tenant_row = tenant::load_tenant(&state.pool, &tenant_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    if !digits.is_empty() {
        let msg = if order.delivery_type == "balcao" {
            let total_str = format!("{:.2}", order.total).replace('.', ",");
            format!(
                "Pagamento confirmado na {}! Total: R$ {total_str}. Obrigado pela compra! 🌇",
                tenant_row.name
            )
        } else {
            format!(
                "Recebemos seu pagamento! Seu pedido #{} já está sendo preparado. 🌇",
                orders_common::short_id(&order.id)
            )
        };
        whatsapp::notify(state, &tenant_row.whatsapp_instance, &digits, &msg);
    }

    tracing::info!("mercadopago webhook: pedido {order_id} confirmado pago (payment_id={payment_id})");
    Ok(())
}

/// Faz a chamada HTTP de verdade pro módulo isolado de Assistente IA
/// (repositório separado `a-vrtek-gente`) — mesmo endpoint/payload usado
/// tanto por uma mensagem real de WhatsApp (`forward_to_assistant_ia`
/// abaixo, fire-and-forget) quanto por uma mensagem simulada disparada pelo
/// admin em `/loja/admin/chat` (`routes::admin::simulate_assistant_ia_message`,
/// chamada direta com `.await`) — extraído pra cá pra garantir que as duas
/// origens acionem EXATAMENTE o mesmo pipeline de IA, sem duplicar a lógica
/// de montagem do payload.
pub async fn send_to_assistant_ia(
    state: &AppState,
    tenant_slug: &str,
    instance: &str,
    phone: &str,
    text: &str,
    customer_name: Option<&str>,
    simulated: bool,
) -> anyhow::Result<()> {
    let assistant_ia_url = std::env::var("ASSISTANT_IA_URL")
        .map_err(|_| anyhow::anyhow!("ASSISTANT_IA_URL not configured"))?;
    let resp = state
        .http
        .post(format!("{}/webhook/evolution", assistant_ia_url.trim_end_matches('/')))
        .timeout(std::time::Duration::from_secs(5))
        .json(&serde_json::json!({
            "tenant_slug": tenant_slug,
            "instance": instance,
            "phone": phone,
            "text": text,
            "customer_name": customer_name,
            "simulated": simulated,
        }))
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("assistant-ia respondeu {status}");
    }
    Ok(())
}

/// Encaminha mensagens de texto recebidas pra o módulo isolado de
/// Assistente IA (repositório separado `a-vrtek-gente`), quando
/// `ASSISTANT_IA_URL` estiver configurada — sem alterar em nada o
/// processamento normal do webhook da Evolution acima. Fire-and-forget:
/// nunca bloqueia nem falha esse handler, só loga+ignora qualquer erro.
/// Só repassa mensagem de texto de cliente (ignora mensagens enviadas pela
/// própria loja e mensagens sem texto, como localização/mídia).
fn forward_to_assistant_ia(state: &AppState, tenant_id: &str, instance: &str, data: &Value, message: &Value) {
    if std::env::var("ASSISTANT_IA_URL").is_err() {
        tracing::info!("assistant-ia forward: ASSISTANT_IA_URL not set, skipping");
        return;
    }
    let from_me = data
        .get("key")
        .and_then(|k| k.get("fromMe"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if from_me {
        tracing::info!("assistant-ia forward: skipping, fromMe=true");
        return;
    }
    // JID de grupo termina em "@g.us" (contatos 1:1 terminam em
    // "@s.whatsapp.net") — a assistente é uma vendedora/atendente de
    // cliente individual, nunca deve responder dentro de um grupo.
    let is_group = data
        .get("key")
        .and_then(|k| k.get("remoteJid"))
        .and_then(|v| v.as_str())
        .is_some_and(|jid| jid.ends_with("@g.us"));
    if is_group {
        tracing::info!("assistant-ia forward: skipping, message from a group chat");
        return;
    }
    // Localização fixa compartilhada no chat (usada pro assistente saber
    // endereço de entrega/coleta) — mesma extração de lat/lng do outro
    // handler de localização acima, só que aqui vira texto (link do Maps)
    // pra entrar na conversa como qualquer outra mensagem, sem exigir um
    // tipo de payload novo no lado do assistant-ia.
    let location_text = message
        .get("locationMessage")
        .or_else(|| message.get("liveLocationMessage"))
        .and_then(|loc| {
            let lat = loc.get("degreesLatitude").and_then(|v| v.as_f64())?;
            let lng = loc.get("degreesLongitude").and_then(|v| v.as_f64())?;
            Some(format!("[Cliente compartilhou localização fixa: https://maps.google.com/?q={lat},{lng}]"))
        });
    let text = location_text
        .as_deref()
        .or_else(|| message.get("conversation").and_then(|v| v.as_str()))
        .or_else(|| message.get("extendedTextMessage").and_then(|m| m.get("text")).and_then(|v| v.as_str()));
    let Some(text) = text else {
        tracing::info!("assistant-ia forward: skipping, no text field in message: {message}");
        return;
    };
    let remote_jid = data
        .get("key")
        .and_then(|k| k.get("remoteJid"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let phone: String = remote_jid.chars().take_while(char::is_ascii_digit).collect();
    if phone.is_empty() {
        tracing::info!("assistant-ia forward: skipping, empty phone from remoteJid={remote_jid}");
        return;
    }
    let customer_name = data.get("pushName").and_then(|v| v.as_str()).map(str::to_string);
    tracing::info!("assistant-ia forward: sending tenant_id={tenant_id} instance={instance} phone={phone}");

    let state = state.clone();
    let tenant_id = tenant_id.to_string();
    let instance = instance.to_string();
    let text = text.to_string();
    tokio::spawn(async move {
        let result = send_to_assistant_ia(
            &state,
            &tenant_id,
            &instance,
            &phone,
            &text,
            customer_name.as_deref(),
            false,
        )
        .await;
        match result {
            Ok(()) => tracing::info!("assistant-ia forward: sent ok"),
            Err(e) => tracing::warn!("falha ao encaminhar mensagem pro assistant-ia (ignorado): {e:?}"),
        }
    });
}
