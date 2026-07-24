use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;
use crate::state::AppState;

pub struct SubscriptionResult {
    pub preapproval_id: String,
    /// URL do checkout hospedado do Mercado Pago — o lojista é redirecionado
    /// pra lá, escolhe cartão/Pix, e a cobrança recorrente já sai
    /// configurada. Nunca lidamos com dado de cartão aqui (evita todo o
    /// escopo de PCI compliance).
    pub init_point: String,
}

#[derive(Debug, Deserialize)]
struct MpPreapprovalResponse {
    id: String,
    init_point: Option<String>,
    status: Option<String>,
}

/// Cria uma assinatura recorrente direto (sem passar por preapproval_plan —
/// pra um preço fixo único isso é desnecessário, um preapproval sozinho já
/// aceita o bloco auto_recurring embutido). status:"pending" é o que faz o
/// Mercado Pago devolver um init_point pra redirecionar o lojista pro
/// checkout hospedado deles, em vez de exigir que a GENTE tokenize cartão.
pub async fn create_subscription(
    state: &AppState,
    reason: &str,
    payer_email: &str,
    valor_mensal: f64,
    external_reference: &str,
) -> Result<SubscriptionResult, AppError> {
    // Anexa o id da assinatura no back_url — sem isso, quando o Mercado
    // Pago manda o lojista de volta pro site não tem como saber QUAL
    // assinatura ele acabou de tentar autorizar, pra consultar o status certo.
    let separador = if state.back_url.contains('?') { "&" } else { "?" };
    let back_url = format!("{}{separador}id={external_reference}", state.back_url.as_str());

    match state.mp_token.as_ref() {
        Some(token) => {
            let body = json!({
                "reason": reason,
                "external_reference": external_reference,
                "payer_email": payer_email,
                "back_url": back_url,
                "status": "pending",
                "auto_recurring": {
                    "frequency": 1,
                    "frequency_type": "months",
                    "transaction_amount": valor_mensal,
                    "currency_id": "BRL"
                }
            });

            let resp = state
                .http
                .post("https://api.mercadopago.com/preapproval")
                .bearer_auth(token)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                tracing::error!("mercado pago create preapproval failed: {status} {text}");
                return Err(AppError::Internal(format!(
                    "não foi possível criar a assinatura no Mercado Pago (status {status})"
                )));
            }

            let parsed: MpPreapprovalResponse = resp
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("mercado pago parse error: {e}")))?;

            let init_point = parsed.init_point.ok_or_else(|| {
                AppError::Internal("mercado pago não devolveu o link de checkout (init_point)".to_string())
            })?;

            Ok(SubscriptionResult { preapproval_id: parsed.id, init_point })
        }
        None => {
            // Modo mock: sem MP_ACCESS_TOKEN configurado (ou sem o produto
            // de assinaturas aprovado na conta ainda), devolve um link
            // fake só pra não travar o fluxo de teste local.
            Ok(SubscriptionResult {
                preapproval_id: format!("mock-{}", uuid::Uuid::new_v4()),
                init_point: format!("{back_url}&mock_subscription=1"),
            })
        }
    }
}

/// Consulta o status atual de uma assinatura direto na API (polling — mesmo
/// padrão já usado no Pix do site do lojista: mais simples e confiável que
/// depender do formato do webhook do Mercado Pago, que varia por produto).
/// "pending" -> lojista ainda não completou o checkout; "authorized" -> a
/// cobrança recorrente está ativa; "cancelled"/"paused" são autoexplicativos.
pub async fn get_subscription_status(state: &AppState, preapproval_id: &str) -> Result<String, AppError> {
    if preapproval_id.starts_with("mock-") {
        return Ok("authorized".to_string());
    }

    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;

    let url = format!("https://api.mercadopago.com/preapproval/{preapproval_id}");
    let resp = state
        .http
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago get preapproval failed: {status} {text}");
        return Err(AppError::Internal("failed to fetch subscription status".to_string()));
    }

    let parsed: MpPreapprovalResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago parse error: {e}")))?;
    Ok(parsed.status.unwrap_or_else(|| "pending".to_string()))
}

/// Cancela a cobrança recorrente (PUT status:"cancelled") — chamado quando
/// o assinante cancela pelo dashboard.
pub async fn cancel_subscription(state: &AppState, preapproval_id: &str) -> Result<(), AppError> {
    if preapproval_id.starts_with("mock-") {
        return Ok(());
    }
    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;

    let url = format!("https://api.mercadopago.com/preapproval/{preapproval_id}");
    let resp = state
        .http
        .put(&url)
        .bearer_auth(token)
        .json(&json!({ "status": "cancelled" }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago cancel preapproval failed: {status} {text}");
        return Err(AppError::Internal("failed to cancel subscription".to_string()));
    }
    Ok(())
}
