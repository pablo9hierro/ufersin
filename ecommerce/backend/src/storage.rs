use std::time::Duration;

use crate::error::AppError;
use crate::state::AppState;

const BUCKET: &str = "sunset-products";

/// Uploads raw image bytes to the `sunset-products` Supabase Storage bucket
/// using the service_role key (server-side only — bypasses RLS, so this
/// must never run with anything but an admin-authenticated request behind
/// it). Returns the public URL to store as the product's image_url.
pub async fn upload_image(
    state: &AppState,
    filename: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<String, AppError> {
    if state.supabase_url.is_empty() || state.supabase_service_key.is_empty() {
        return Err(AppError::BadRequest(
            "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured".to_string(),
        ));
    }

    let base = state.supabase_url.trim_end_matches('/');
    let upload_url = format!("{base}/storage/v1/object/{BUCKET}/{filename}");

    let resp = state
        .http
        .post(&upload_url)
        .timeout(Duration::from_secs(30))
        .header("Authorization", format!("Bearer {}", state.supabase_service_key))
        .header("apikey", state.supabase_service_key.as_str())
        .header("Content-Type", content_type)
        .header("x-upsert", "true")
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("supabase storage unreachable: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("supabase storage upload failed ({status}): {body}");

        // Supabase Storage devolve JSON tipo {"statusCode":"404","error":"Bucket
        // not found","message":"..."} — tenta extrair algo legível pro admin em
        // vez de despejar o corpo cru, e dá um diagnóstico específico pros
        // status mais comuns (bucket não existe, chave errada, arquivo grande).
        let parsed_message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()));

        let message = match status.as_u16() {
            404 => format!(
                "Bucket \"{BUCKET}\" não existe no Supabase Storage — crie esse bucket (público) no painel do Supabase."
            ),
            401 | 403 => "Supabase recusou a chave de serviço (SUPABASE_SERVICE_ROLE_KEY inválida ou sem permissão no Storage).".to_string(),
            413 => "Arquivo grande demais para o Supabase Storage aceitar.".to_string(),
            _ => parsed_message.unwrap_or_else(|| format!("Supabase Storage recusou o upload (HTTP {status}).")),
        };
        return Err(AppError::BadRequest(message));
    }

    Ok(format!("{base}/storage/v1/object/public/{BUCKET}/{filename}"))
}

/// Picks a file extension from the upload's content-type, since browsers
/// don't always send a trustworthy filename.
pub fn extension_for(content_type: &str) -> &'static str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        _ => "bin",
    }
}
