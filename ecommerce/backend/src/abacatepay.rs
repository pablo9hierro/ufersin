use base64::{engine::general_purpose, Engine as _};
use image::{DynamicImage, Luma};
use qrcode::QrCode;
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use std::io::Cursor;

use crate::error::AppError;
use crate::state::AppState;

const BASE_URL: &str = "https://api.abacatepay.com/v2";

/// Renderiza um QR code (PNG) codificando `data`, como string base64 (sem o
/// prefixo "data:image/png;base64," — quem chama decide se precisa dele).
fn render_qr_base64(data: &str) -> Result<String, AppError> {
    let code = QrCode::new(data.as_bytes()).map_err(|e| AppError::Internal(format!("qr generation error: {e}")))?;
    let image = code.render::<Luma<u8>>().build();
    let dynamic = DynamicImage::ImageLuma8(image);
    let mut buf = Cursor::new(Vec::new());
    dynamic
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| AppError::Internal(format!("qr encode error: {e}")))?;
    Ok(general_purpose::STANDARD.encode(buf.into_inner()))
}

/// Gera uma string "copia e cola" Pix no formato EMV, fake mas bem-formada —
/// só pra modo mock (sem chave configurada) ter algo escaneável pra testar
/// o fluxo visual sem cobrar nada de verdade. O nome do recebedor (campo
/// 59, máx. 25 chars pelo padrão EMV) é o do tenant dono do pedido, não
/// mais fixo — cada loja vê o próprio nome no QR de teste.
fn fake_copia_cola(store_name: &str) -> String {
    let mut rng = rand::thread_rng();
    let chunk: String = (0..24)
        .map(|_| {
            let c = rng.gen_range(0..36);
            std::char::from_digit(c, 36).unwrap_or('0').to_ascii_uppercase()
        })
        .collect();
    let nome: String = store_name.chars().take(25).collect::<String>().to_uppercase();
    let nome = if nome.is_empty() { "LOJA".to_string() } else { nome };
    format!(
        "00020126580014BR.GOV.BCB.PIX0136{chunk}5204000053039865802BR59{:02}{nome}6009SAO PAULO62070503***6304ABCD",
        nome.len()
    )
}

pub struct PixResult {
    pub payment_id: String,
    pub qr_code: String,
    pub qr_code_base64: String,
}

#[derive(Debug, Deserialize)]
struct ChargeData {
    id: String,
    #[serde(rename = "brCode")]
    br_code: Option<String>,
    #[serde(rename = "brCodeBase64")]
    br_code_base64: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChargeResponse {
    data: Option<ChargeData>,
    error: Option<serde_json::Value>,
}

/// Cria uma cobrança Pix (QR code + copia-e-cola) via AbacatePay. Em modo
/// mock (sem ABACATEPAY_API_KEY configurada), fabrica um QR fake mas
/// escaneável só pra não travar o fluxo de teste local.
pub async fn create_pix_charge(
    state: &AppState,
    store_name: &str,
    total: f64,
    customer_name: &str,
    whatsapp_digits: &str,
) -> Result<PixResult, AppError> {
    match state.abacatepay_key.as_ref() {
        Some(key) => {
            // Valor em centavos, conforme a API.
            let amount_centavos = (total * 100.0).round() as i64;
            let body = json!({
                "amount": amount_centavos,
                "description": format!("Pedido {store_name}"),
                "customer": {
                    "name": customer_name,
                    "cellphone": whatsapp_digits,
                }
            });

            let resp = state
                .http
                .post(format!("{BASE_URL}/transparents/create"))
                .bearer_auth(key)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                tracing::error!("abacatepay create charge failed: {status} {text}");
                return Err(AppError::Internal("failed to create pix charge".to_string()));
            }

            let parsed: ChargeResponse = resp
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;

            if let Some(err) = parsed.error {
                tracing::error!("abacatepay returned an error: {err}");
                return Err(AppError::Internal("abacatepay rejected the charge".to_string()));
            }

            let data = parsed
                .data
                .ok_or_else(|| AppError::Internal("abacatepay response missing data".to_string()))?;

            let qr_code = data
                .br_code
                .ok_or_else(|| AppError::Internal("abacatepay response missing brCode".to_string()))?;
            let raw_b64 = data
                .br_code_base64
                .ok_or_else(|| AppError::Internal("abacatepay response missing brCodeBase64".to_string()))?;
            let qr_code_base64 = if raw_b64.starts_with("data:") {
                raw_b64
            } else {
                format!("data:image/png;base64,{raw_b64}")
            };

            Ok(PixResult { payment_id: data.id, qr_code, qr_code_base64 })
        }
        None => {
            let copia_cola = fake_copia_cola(store_name);
            let raw_b64 = render_qr_base64(&copia_cola)?;
            Ok(PixResult {
                payment_id: format!("mock-{}", uuid::Uuid::new_v4()),
                qr_code: copia_cola,
                qr_code_base64: format!("data:image/png;base64,{raw_b64}"),
            })
        }
    }
}

/// Consulta o status atual de uma cobrança. Só chamada quando uma
/// ABACATEPAY_API_KEY de verdade está configurada (cobranças mock nunca têm
/// status real pra consultar — o pagamento simulado localmente já cobre isso).
pub async fn get_charge_status(state: &AppState, charge_id: &str) -> Result<String, AppError> {
    let key = state
        .abacatepay_key
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("abacatepay not configured".to_string()))?;

    let resp = state
        .http
        .get(format!("{BASE_URL}/transparents/check"))
        .bearer_auth(key)
        .query(&[("id", charge_id)])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("abacatepay check charge failed: {status} {text}");
        return Err(AppError::Internal("failed to fetch pix charge status".to_string()));
    }

    let parsed: ChargeResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
    Ok(parsed.data.and_then(|d| d.status).unwrap_or_else(|| "PENDING".to_string()))
}
