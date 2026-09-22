use serde_json::json;
use std::time::Duration;

use crate::state::AppState;

// ---------------------------------------------------------------------
// Evolution Go (whatsmeow) — substituiu o Evolution API (Node/Baileys) em
// 2026-09-22. Modelo de auth é diferente do Node: `state.evolution_api_key`
// (GLOBAL_API_KEY do container) só vale pra criar/listar instâncias; toda
// operação NUMA instância (connect/qr/status/logout/send) exige o TOKEN
// daquela instância como header `apikey`, mais o `instanceId` (UUID gerado
// pelo servidor, não escolhido por nós) como header `instanceId`. Pra não
// precisar de uma coluna nova no banco só pra guardar esse UUID, criamos
// toda instância com `token == name` (o mesmo texto que já guardávamos em
// `tenants.whatsapp_instance`/`motoboy-{id}`) e resolvemos o UUID sob
// demanda via `GET /instance/all` (chave global), cacheado.
// Confirmado ao vivo (spike local contra o próprio container, 2026-09-22):
// endpoints, nomes de campo e shapes de resposta abaixo, nada é chute.

fn require_configured(state: &AppState) -> Result<(), crate::error::AppError> {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "EVOLUTION_API_URL/EVOLUTION_API_KEY not configured".to_string(),
        ));
    }
    Ok(())
}

async fn evolution_json(resp: reqwest::Response) -> Result<serde_json::Value, crate::error::AppError> {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        return Err(crate::error::AppError::Internal(format!("evolution go returned {status}: {body}")));
    }
    Ok(body)
}

/// Resolve o UUID (`instanceId`) que o servidor gerou pra uma instância,
/// dado o nome (`token`) que escolhemos na criação. Cacheado no mesmo mutex
/// de `whatsapp_connect_cache` (chave prefixada) — evita bater em
/// `/instance/all` (lista TODAS as instâncias) a cada chamada.
async fn resolve_instance_id(state: &AppState, instance: &str) -> Result<String, crate::error::AppError> {
    let cache_key = format!("__id__{instance}");
    {
        let cache = state.whatsapp_connect_cache.lock().await;
        if let Some((_, cached)) = cache.get(&cache_key) {
            if let Some(id) = cached.as_str() {
                return Ok(id.to_string());
            }
        }
    }
    let base = state.evolution_api_url.trim_end_matches('/');
    let resp = state
        .http
        .get(format!("{base}/instance/all"))
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution go unreachable: {e}")))?;
    let body = evolution_json(resp).await?;
    let id = body
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|list| list.iter().find(|i| i.get("name").and_then(|v| v.as_str()) == Some(instance)))
        .and_then(|i| i.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| crate::error::AppError::NotFound(format!("instance {instance} not found in evolution go")))?
        .to_string();
    state
        .whatsapp_connect_cache
        .lock()
        .await
        .insert(cache_key, (std::time::Instant::now(), serde_json::Value::String(id.clone())));
    Ok(id)
}

/// Fire-and-forget WhatsApp notification via a self-hosted Evolution Go
/// instance (whatsmeow), sent from the given instance (the store's own, or
/// a specific motoboy's). Never blocks or fails the caller: spawns a
/// background task and logs+ignores any error. If Evolution Go isn't
/// configured yet, just logs the message.
pub fn notify(state: &AppState, instance: &str, phone: &str, message: &str) {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() || instance.is_empty() {
        tracing::info!("[whatsapp not configured] to {}: {}", phone, message);
        return;
    }
    let state = state.clone();
    let instance = instance.to_string();
    let phone = phone.to_string();
    let message = message.to_string();
    tokio::spawn(async move {
        let _ = notify_sequential(&state, &instance, &phone, &message).await;
    });
}

/// Mesma coisa que `notify`, mas AGUARDA o envio terminar antes de voltar —
/// use quando a ORDEM de duas mensagens importa. Retorna se o envio de fato
/// deu certo (status 2xx da Evolution Go) — use quando o chamador precisa
/// informar sucesso/falha real pro usuário, ao contrário de `notify()` que
/// é fire-and-forget e não tem como avisar.
pub async fn notify_sequential(state: &AppState, instance: &str, phone: &str, message: &str) -> bool {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() || instance.is_empty() {
        tracing::info!("[whatsapp not configured] to {}: {}", phone, message);
        return false;
    }
    let Ok(instance_id) = resolve_instance_id(state, instance).await else {
        tracing::warn!("evolution go: instance {instance} not found, cannot send");
        return false;
    };
    let base = state.evolution_api_url.trim_end_matches('/');
    let result = state
        .http
        .post(format!("{base}/send/text"))
        .timeout(Duration::from_secs(15))
        .header("apikey", instance)
        .header("instanceId", &instance_id)
        .json(&json!({ "number": phone, "text": message }))
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!("evolution go returned non-success status {} for phone {}: {}", status, phone, body);
            false
        }
        Err(e) => {
            tracing::warn!("failed to reach evolution go for phone {}: {}", phone, e);
            false
        }
    }
}

/// Strip everything except digits, so phone numbers are always sent as
/// "digits only with country code" as required by the gateway.
pub fn digits_only(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

/// Áudio/mídia recebida já vem em base64 DIRETO no payload do webhook
/// (`Message.base64`, `WEBHOOK_FILES=true` por padrão no Evolution Go) —
/// diferente do Node, que exigia uma chamada extra pra baixar. Essa função
/// só existe agora pra extrair o que `routes/webhooks.rs` já recebeu,
/// mantendo a mesma assinatura `(base64, mimetype)` que o resto do código
/// (`forward_to_assistant_ia`) espera, sem precisar mexer no chamador.
pub fn extract_inline_media(message: &serde_json::Value, mimetype_hint: Option<String>) -> Option<(String, String)> {
    let base64 = message.get("base64").and_then(|v| v.as_str())?.to_string();
    let mimetype = mimetype_hint.unwrap_or_else(|| "audio/ogg".to_string());
    Some((base64, mimetype))
}

/// Current connection state of the given instance. Instância ainda não
/// criada = desconectado (não erro). O admin clica Conectar e o `connect`
/// cria a instância + QR.
pub async fn connection_status(state: &AppState, instance: &str) -> Result<serde_json::Value, crate::error::AppError> {
    require_configured(state)?;
    let Ok(instance_id) = resolve_instance_id(state, instance).await else {
        // Instância nunca criada — mesmo shape de "desconectado" que o
        // resto do código (admin.rs::extract_wa_state) já sabe interpretar.
        return Ok(json!({ "instance": { "instanceName": instance, "state": "close" } }));
    };
    let base = state.evolution_api_url.trim_end_matches('/');
    let resp = state
        .http
        .get(format!("{base}/instance/status?instanceId={instance_id}"))
        .timeout(Duration::from_secs(15))
        .header("apikey", instance)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution go unreachable: {e}")))?;
    let body = evolution_json(resp).await?;
    let connected = body.get("data").and_then(|d| d.get("Connected")).and_then(|v| v.as_bool()).unwrap_or(false);
    let logged_in = body.get("data").and_then(|d| d.get("LoggedIn")).and_then(|v| v.as_bool()).unwrap_or(false);
    // Normaliza pro mesmo vocabulário ("open"/"connecting"/"close") que
    // admin.rs::extract_wa_state e o frontend já leem — sem isso teria que
    // mexer nos dois lugares que consomem esse retorno.
    let state_str = if connected && logged_in {
        "open"
    } else if connected {
        "connecting"
    } else {
        "close"
    };
    Ok(json!({ "instance": { "instanceName": instance, "state": state_str } }))
}

/// Chamadas concorrentes de várias abas/dispositivos na mesma instância
/// rápido demais sobrecarregavam o Evolution Node — mantido o mesmo
/// cooldown aqui por precaução, mesmo sem confirmar se o Go tem o mesmo
/// problema.
const CONNECT_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(10);

/// Creates the given instance if it doesn't exist yet (ignored if it already
/// does) and returns a fresh QR code / pairing code to scan. Debounced per
/// instance (ver `CONNECT_COOLDOWN`).
pub async fn connect(state: &AppState, instance: &str) -> Result<serde_json::Value, crate::error::AppError> {
    tracing::info!("wa_connect: called instance={instance}");
    require_configured(state)?;
    {
        let cache = state.whatsapp_connect_cache.lock().await;
        if let Some((at, cached)) = cache.get(instance) {
            if at.elapsed() < CONNECT_COOLDOWN {
                tracing::info!("wa_connect: instance={instance} short-circuit=cooldown");
                return Ok(cached.clone());
            }
        }
    }
    let base = state.evolution_api_url.trim_end_matches('/');

    // token == name de propósito -- ver comentário no topo do arquivo.
    let create_result = state
        .http
        .post(format!("{base}/instance/create"))
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .json(&json!({ "name": instance, "token": instance }))
        .send()
        .await;
    match create_result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if !status.is_success() && !body.to_lowercase().contains("already") {
                tracing::warn!("evolution go instance/create {instance}: {status} {body}");
            }
        }
        Err(e) => {
            tracing::warn!("evolution go instance/create failed (may already exist): {e}");
        }
    }

    let instance_id = resolve_instance_id(state, instance).await?;

    let webhook_url = format!("{}/api/webhooks/evolution", state.backend_public_url.trim_end_matches('/'));
    let resp = state
        .http
        .post(format!("{base}/instance/connect"))
        .timeout(Duration::from_secs(15))
        .header("apikey", instance)
        .header("instanceId", &instance_id)
        .json(&json!({ "webhookUrl": webhook_url, "subscribe": ["ALL"], "immediate": true }))
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution go unreachable: {e}")))?;
    evolution_json(resp).await?;

    let qr_resp = state
        .http
        .get(format!("{base}/instance/qr?instanceId={instance_id}"))
        .timeout(Duration::from_secs(15))
        .header("apikey", instance)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution go unreachable: {e}")))?;
    let qr_body = evolution_json(qr_resp).await?;
    // Normaliza pro shape que WhatsAppConnection.tsx (frontend) já sabe ler
    // (`data.base64`, `data.pairingCode`) -- Evolution Go devolve
    // `data.qrcode`/`data.code` em vez disso.
    let payload = json!({
        "base64": qr_body.get("data").and_then(|d| d.get("qrcode")).cloned().unwrap_or(serde_json::Value::Null),
        "pairingCode": qr_body.get("data").and_then(|d| d.get("code")).cloned().unwrap_or(serde_json::Value::Null),
    });
    state
        .whatsapp_connect_cache
        .lock()
        .await
        .insert(instance.to_string(), (std::time::Instant::now(), payload.clone()));
    Ok(payload)
}

/// Logs out the WhatsApp session for the given instance (keeps it registered
/// so it can reconnect later with a new QR code).
pub async fn logout(state: &AppState, instance: &str) -> Result<(), crate::error::AppError> {
    tracing::info!("wa_logout: called instance={instance}");
    require_configured(state)?;
    state.whatsapp_connect_cache.lock().await.remove(instance);
    let Ok(instance_id) = resolve_instance_id(state, instance).await else {
        // Nunca existiu -- já está "deslogado", não é erro.
        return Ok(());
    };
    let base = state.evolution_api_url.trim_end_matches('/');
    let resp = state
        .http
        .delete(format!("{base}/instance/logout"))
        .timeout(Duration::from_secs(15))
        .header("apikey", instance)
        .header("instanceId", &instance_id)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution go unreachable: {e}")))?;
    let status = resp.status();
    if status.is_success() || status.as_u16() == 404 {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    Err(crate::error::AppError::Internal(format!("evolution go returned {status}: {body}")))
}

/// Desliga de vez a instância Evolution (logout + delete). Usado quando o
/// lojista desmarca "notificações por WhatsApp" no onboarding/Meu plano.
pub async fn teardown(state: &AppState, instance: &str) -> Result<(), crate::error::AppError> {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() || instance.is_empty() {
        return Ok(());
    }
    let _ = logout(state, instance).await;
    let Ok(instance_id) = resolve_instance_id(state, instance).await else {
        return Ok(());
    };
    let base = state.evolution_api_url.trim_end_matches('/');
    let resp = state
        .http
        .delete(format!("{base}/instance/delete/{instance_id}"))
        .timeout(Duration::from_secs(15))
        .header("apikey", instance)
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() || r.status().as_u16() == 404 => {}
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::warn!("evolution go delete instance {instance} returned {status}: {body}");
        }
        Err(e) => {
            tracing::warn!("evolution go delete instance {instance} failed: {e}");
        }
    }
    state.whatsapp_connect_cache.lock().await.remove(&format!("__id__{instance}"));
    Ok(())
}
