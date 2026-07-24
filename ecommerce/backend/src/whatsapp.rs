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

/// Current connection state of the given instance
/// (`{"instance": {"instanceName": "...", "state": "open"|"connecting"|"close"}}`,
/// exact shape depends on the Evolution API version).
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
    evolution_json(resp).await
}

/// Creates the given instance if it doesn't exist yet (ignored if it already
/// does) and returns a fresh QR code / pairing code to scan.
pub async fn connect(state: &AppState, instance: &str) -> Result<serde_json::Value, crate::error::AppError> {
    require_configured(state)?;
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
    if let Err(e) = &create_result {
        tracing::warn!("evolution api instance/create failed (may already exist): {e}");
    }

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
    evolution_json(resp).await
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
    evolution_json(resp).await.map(|_| ())
}
