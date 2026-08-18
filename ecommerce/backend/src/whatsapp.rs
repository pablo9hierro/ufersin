use serde_json::json;
use std::time::Duration;

use crate::state::AppState;

/// Fire-and-forget WhatsApp notification via a self-hosted Evolution API
/// instance (https://github.com/EvolutionAPI/evolution-api), sent from the
/// given instance (the store's own, or a specific motoboy's). Never blocks
/// or fails the caller: spawns a background task and logs+ignores any
/// error. If Evolution API isn't configured yet, just logs the message.
pub fn notify(state: &AppState, instance: &str, phone: &str, message: &str) {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() || instance.is_empty() {
        tracing::info!("[whatsapp not configured] to {}: {}", phone, message);
        return;
    }

    let http = state.http.clone();
    let url = format!(
        "{}/message/sendText/{instance}",
        state.evolution_api_url.trim_end_matches('/'),
    );
    let api_key = (*state.evolution_api_key).clone();
    let phone = phone.to_string();
    let message = message.to_string();

    tokio::spawn(async move {
        let result = http
            .post(&url)
            .timeout(Duration::from_secs(10))
            .header("apikey", api_key)
            .json(&json!({ "number": phone, "text": message }))
            .send()
            .await;

        match result {
            Ok(resp) if !resp.status().is_success() => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    "evolution api returned non-success status {} for phone {}: {}",
                    status, phone, body
                );
            }
            Err(e) => {
                tracing::warn!("failed to reach evolution api for phone {}: {}", phone, e);
            }
            _ => {}
        }
    });
}

/// Mesma coisa que `notify`, mas AGUARDA o envio terminar antes de voltar —
/// use quando a ORDEM de duas mensagens importa (ex: resumo do pedido antes
/// do link de cobrança). `notify()` sozinho dispara cada chamada como uma
/// task independente (`tokio::spawn`) sem NENHUMA garantia de ordem entre
/// elas — duas chamadas seguidas podiam chegar na Evolution API fora de
/// ordem (mensagem 2 antes da 1) dependendo da latência de rede de cada
/// requisição. `await` simples entre as duas chamadas já resolve isso sem
/// precisar de fila externa (Redis etc.) — só duas requisições HTTP em
/// sequência.
pub async fn notify_sequential(state: &AppState, instance: &str, phone: &str, message: &str) {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() || instance.is_empty() {
        tracing::info!("[whatsapp not configured] to {}: {}", phone, message);
        return;
    }
    let url = format!(
        "{}/message/sendText/{instance}",
        state.evolution_api_url.trim_end_matches('/'),
    );
    let result = state
        .http
        .post(&url)
        .timeout(Duration::from_secs(10))
        .header("apikey", state.evolution_api_key.as_str())
        .json(&json!({ "number": phone, "text": message }))
        .send()
        .await;

    match result {
        Ok(resp) if !resp.status().is_success() => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!(
                "evolution api returned non-success status {} for phone {}: {}",
                status, phone, body
            );
        }
        Err(e) => {
            tracing::warn!("failed to reach evolution api for phone {}: {}", phone, e);
        }
        _ => {}
    }
}

/// Strip everything except digits, so phone numbers are always sent as
/// "digits only with country code" as required by the gateway.
pub fn digits_only(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn require_configured(state: &AppState) -> Result<(), crate::error::AppError> {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "EVOLUTION_API_URL/EVOLUTION_API_KEY not configured".to_string(),
        ));
    }
    Ok(())
}

async fn evolution_json(
    resp: reqwest::Response,
) -> Result<serde_json::Value, crate::error::AppError> {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        return Err(crate::error::AppError::Internal(format!(
            "evolution api returned {status}: {body}"
        )));
    }
    Ok(body)
}

/// Baixa o conteúdo de uma mídia recebida (áudio, imagem, etc) como base64,
/// dado o `key` da mensagem original (vem de `data.key` no payload do
/// webhook). Não usa o `webhook_base64` do próprio Evolution API pra isso —
/// esse flag tem histórico de instabilidade em várias versões (não ativa
/// consistentemente), então preferimos buscar sob demanda aqui, só quando
/// realmente precisamos (mensagem de áudio pra transcrição).
/// Retorna (base64, mimetype).
pub async fn get_base64_media(
    state: &AppState,
    instance: &str,
    message_key: &serde_json::Value,
) -> Result<(String, String), crate::error::AppError> {
    require_configured(state)?;
    let resp = state
        .http
        .post(format!(
            "{}/chat/getBase64FromMediaMessage/{instance}",
            state.evolution_api_url.trim_end_matches('/')
        ))
        .timeout(Duration::from_secs(20))
        .header("apikey", state.evolution_api_key.as_str())
        .json(&json!({ "message": { "key": message_key } }))
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution api unreachable: {e}")))?;
    let body = evolution_json(resp).await?;
    let base64 = body
        .get("base64")
        .and_then(|v| v.as_str())
        .ok_or_else(|| crate::error::AppError::Internal("evolution api: resposta sem campo base64".to_string()))?
        .to_string();
    let mimetype = body
        .get("mimetype")
        .and_then(|v| v.as_str())
        .unwrap_or("audio/ogg")
        .to_string();
    Ok((base64, mimetype))
}

/// Current connection state of the given instance
/// (`{"instance": {"instanceName": "...", "state": "open"|"connecting"|"close"}}`,
/// exact shape depends on the Evolution API version).
///
/// Instância ainda não criada = desconectado (não erro). O admin clica
/// Conectar e o `connect` cria a instância + QR.
pub async fn connection_status(
    state: &AppState,
    instance: &str,
) -> Result<serde_json::Value, crate::error::AppError> {
    require_configured(state)?;
    let url = format!(
        "{}/instance/connectionState/{instance}",
        state.evolution_api_url.trim_end_matches('/'),
    );
    let resp = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution api unreachable: {e}")))?;

    let http_status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    let msg = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let instance_missing = http_status.as_u16() == 404
        || msg.contains("does not exist")
        || (msg.contains("not found") && msg.contains("instance"));

    if instance_missing {
        return Ok(json!({
            "instance": { "instanceName": instance, "state": "close" }
        }));
    }
    if !http_status.is_success() {
        return Err(crate::error::AppError::Internal(format!(
            "evolution api returned {http_status}: {body}"
        )));
    }
    Ok(body)
}

/// Chamadas concorrentes de várias abas/dispositivos na mesma instância
/// (cada um com seu próprio poll — ver WhatsAppConnection.tsx) rápido
/// demais faziam o Evolution API entrar num loop de reinicialização de
/// canal (ChannelStartupService várias vezes por segundo, sem parar,
/// confirmado em produção). Menor que o refresh de QR do frontend (25s)
/// pra não atrapalhar o uso normal — só protege contra rajada.
const CONNECT_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(10);

/// Creates the given instance if it doesn't exist yet (ignored if it already
/// does) and returns a fresh QR code / pairing code to scan. Debounced per
/// instance (ver `CONNECT_COOLDOWN`) — devolve a última resposta em cache
/// em vez de bater no Evolution API de novo se chamado rápido demais.
pub async fn connect(state: &AppState, instance: &str) -> Result<serde_json::Value, crate::error::AppError> {
    require_configured(state)?;
    {
        let cache = state.whatsapp_connect_cache.lock().await;
        if let Some((at, cached)) = cache.get(instance) {
            if at.elapsed() < CONNECT_COOLDOWN {
                return Ok(cached.clone());
            }
        }
    }
    let base = state.evolution_api_url.trim_end_matches('/');

    let create_result = state
        .http
        .post(format!("{base}/instance/create"))
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .json(&json!({
            "instanceName": instance,
            "qrcode": true,
            "integration": "WHATSAPP-BAILEYS"
        }))
        .send()
        .await;
    match create_result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // 201/200 = criada; 403/409/"already" = já existia — ok nos dois.
            if !status.is_success()
                && !body.to_lowercase().contains("already")
                && status.as_u16() != 403
                && status.as_u16() != 409
            {
                tracing::warn!("evolution api instance/create {instance}: {status} {body}");
            }
        }
        Err(e) => {
            tracing::warn!("evolution api instance/create failed (may already exist): {e}");
        }
    }

    // Força a sessão atual (se houver) a encerrar antes de pedir um QR novo —
    // testado ao vivo: pedir QR com a instância ainda marcada "open" (mesmo
    // que o socket já esteja morto, ex: WhatsApp deslogou o aparelho) faz o
    // Evolution API devolver o connect SEM nenhum QR/pairing code, porque
    // ele acha que não precisa reconectar. Best-effort — erro aqui (ex:
    // sessão já nem existia) não impede a tentativa de connect logo abaixo.
    // Nunca chama /instance/delete — não apaga histórico de mensagens.
    let _ = logout(state, instance).await;

    // Best-effort: point this instance's webhook at us so incoming messages
    // (customer sharing their location) reach /api/webhooks/evolution. Not
    // fatal if it fails — connecting still works, just without that feature.
    if !state.backend_public_url.is_empty() {
        if let Err(e) = set_webhook(state, instance).await {
            tracing::warn!("failed to configure webhook for instance {instance}: {e:?}");
        }
    }

    let resp = state
        .http
        .get(format!("{base}/instance/connect/{instance}"))
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution api unreachable: {e}")))?;
    let payload = evolution_json(resp).await?;
    state
        .whatsapp_connect_cache
        .lock()
        .await
        .insert(instance.to_string(), (std::time::Instant::now(), payload.clone()));
    Ok(payload)
}

/// Points the given instance's webhook at this backend's own
/// `/api/webhooks/evolution`, subscribed to MESSAGES_UPSERT (incoming
/// messages) — so admin/motoboy never need to touch the Evolution API
/// Manager by hand.
async fn set_webhook(state: &AppState, instance: &str) -> Result<(), crate::error::AppError> {
    let base = state.evolution_api_url.trim_end_matches('/');
    let webhook_url = format!(
        "{}/api/webhooks/evolution",
        state.backend_public_url.trim_end_matches('/')
    );
    let resp = state
        .http
        .post(format!("{base}/webhook/set/{instance}"))
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .json(&json!({
            "webhook": {
                "enabled": true,
                "url": webhook_url,
                "webhookByEvents": false,
                "events": ["MESSAGES_UPSERT"]
            }
        }))
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution api unreachable: {e}")))?;
    evolution_json(resp).await.map(|_| ())
}

/// Logs out the WhatsApp session for the given instance (keeps it registered
/// so it can reconnect later with a new QR code).
pub async fn logout(state: &AppState, instance: &str) -> Result<(), crate::error::AppError> {
    require_configured(state)?;
    state.whatsapp_connect_cache.lock().await.remove(instance);
    let url = format!(
        "{}/instance/logout/{instance}",
        state.evolution_api_url.trim_end_matches('/'),
    );
    let resp = state
        .http
        .delete(&url)
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .send()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("evolution api unreachable: {e}")))?;

    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    // O socket do Baileys pode já estar morto do lado de fora (ex: o próprio
    // WhatsApp deslogou o aparelho) — nesse caso o Evolution API não
    // consegue fechar "educadamente" e devolve 500 "Connection Closed"/"not
    // open" em vez de um logout normal. O resultado prático que o admin
    // quer (sessão fora do ar) já é verdade nesse caso — testado ao vivo:
    // era exatamente isso que fazia "Desconectar" nunca funcionar depois de
    // um logout forçado pelo próprio WhatsApp do lado do celular.
    let lower = body.to_string().to_lowercase();
    let already_dead = lower.contains("connection closed")
        || lower.contains("not open")
        || lower.contains("no connection")
        || lower.contains("not connected");
    if status.as_u16() == 404 || already_dead {
        return Ok(());
    }
    Err(crate::error::AppError::Internal(format!("evolution api returned {status}: {body}")))
}

/// Desliga de vez a instância Evolution (logout + delete). Usado quando o
/// lojista desmarca "notificações por WhatsApp" no onboarding/Meu plano —
/// o serviço cai junto com o campo na UI de Configurações.
pub async fn teardown(state: &AppState, instance: &str) -> Result<(), crate::error::AppError> {
    if state.evolution_api_url.is_empty() || state.evolution_api_key.is_empty() || instance.is_empty() {
        return Ok(());
    }
    let base = state.evolution_api_url.trim_end_matches('/');
    let _ = logout(state, instance).await;
    let url = format!("{base}/instance/delete/{instance}");
    let resp = state
        .http
        .delete(&url)
        .timeout(Duration::from_secs(15))
        .header("apikey", state.evolution_api_key.as_str())
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() || r.status().as_u16() == 404 => Ok(()),
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::warn!("evolution delete instance {instance} returned {status}: {body}");
            Ok(())
        }
        Err(e) => {
            tracing::warn!("evolution delete instance {instance} failed: {e}");
            Ok(())
        }
    }
}
