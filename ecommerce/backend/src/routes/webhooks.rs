use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::Value;

use crate::state::AppState;
use crate::tenant;

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
