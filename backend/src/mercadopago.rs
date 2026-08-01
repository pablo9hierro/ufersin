use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;
use crate::gateway::BillingCycle;
use crate::state::AppState;

/// Prefixo gravado em `subscribers.mp_preapproval_id` quando o checkout
/// foi criado via `/preapproval_plan` (necessário em contas TEST onde
/// `POST /preapproval` com status pending devolve 500).
const PLAN_ID_PREFIX: &str = "mpp-";

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
    sandbox_init_point: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpSearchResponse {
    results: Option<Vec<MpPreapprovalResponse>>,
}

/// Credencial de teste (`TEST-...`) ou ausência de token → sandbox/mock.
/// Com token de produção o checkout é real (sem "Simular pagamento").
pub fn sandbox_mode(state: &AppState) -> bool {
    match state.mp_token.as_ref().as_ref() {
        None => true,
        Some(t) => t.trim().starts_with("TEST-"),
    }
}

fn pick_init_point(parsed: &MpPreapprovalResponse) -> Option<String> {
    parsed
        .init_point
        .clone()
        .or_else(|| parsed.sandbox_init_point.clone())
}

fn cycle_frequency(cycle: BillingCycle) -> (i32, &'static str) {
    match cycle {
        BillingCycle::Mensal => (1, "months"),
        BillingCycle::Semestral => (6, "months"),
    }
}

fn completion_back_url(state: &AppState, external_reference: &str) -> String {
    // Anexa o id da assinatura no back_url — sem isso, quando o Mercado
    // Pago manda o lojista de volta pro site não tem como saber QUAL
    // assinatura ele acabou de tentar autorizar.
    let separador = if state.back_url.contains('?') { "&" } else { "?" };
    format!("{}{separador}id={external_reference}", state.back_url.as_str())
}

/// Cria checkout de assinatura recorrente.
/// 1) Tenta `POST /preapproval` (status pending → init_point) — fluxo clássico.
/// 2) Se falhar (comum em credenciais TEST: HTTP 500), cai em
///    `POST /preapproval_plan`, que devolve init_point estável.
pub async fn create_subscription(
    state: &AppState,
    reason: &str,
    payer_email: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    external_reference: &str,
) -> Result<SubscriptionResult, AppError> {
    let back_url = completion_back_url(state, external_reference);

    match state.mp_token.as_ref() {
        Some(token) => {
            match create_via_preapproval(state, token, reason, payer_email, amount_reais, cycle, external_reference, &back_url)
                .await
            {
                Ok(r) => Ok(r),
                Err(e) => {
                    tracing::warn!(
                        "mercado pago POST /preapproval failed ({e:?}) — falling back to /preapproval_plan"
                    );
                    create_via_plan(state, token, reason, amount_reais, cycle, external_reference, &back_url).await
                }
            }
        }
        None => {
            // Modo mock: sem MP_ACCESS_TOKEN — link fake só pra testar o fluxo.
            Ok(SubscriptionResult {
                preapproval_id: format!("mock-{}", uuid::Uuid::new_v4()),
                init_point: format!("{back_url}&mock_subscription=1"),
            })
        }
    }
}

async fn create_via_preapproval(
    state: &AppState,
    token: &str,
    reason: &str,
    payer_email: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    external_reference: &str,
    back_url: &str,
) -> Result<SubscriptionResult, AppError> {
    let (frequency, frequency_type) = cycle_frequency(cycle);
    let body = json!({
        "reason": reason,
        "external_reference": external_reference,
        "payer_email": payer_email,
        "back_url": back_url,
        "status": "pending",
        "auto_recurring": {
            "frequency": frequency,
            "frequency_type": frequency_type,
            "transaction_amount": amount_reais,
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

    let init_point = pick_init_point(&parsed).ok_or_else(|| {
        AppError::Internal("mercado pago não devolveu o link de checkout (init_point)".to_string())
    })?;

    Ok(SubscriptionResult {
        preapproval_id: parsed.id,
        init_point,
    })
}

async fn create_via_plan(
    state: &AppState,
    token: &str,
    reason: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    external_reference: &str,
    back_url: &str,
) -> Result<SubscriptionResult, AppError> {
    let (frequency, frequency_type) = cycle_frequency(cycle);
    // Plano único por tentativa de assinatura — permite correlacionar via
    // search?preapproval_plan_id=… depois que o lojista autoriza no checkout.
    let body = json!({
        "reason": format!("{reason} [{external_reference}]"),
        "back_url": back_url,
        "auto_recurring": {
            "frequency": frequency,
            "frequency_type": frequency_type,
            "transaction_amount": amount_reais,
            "currency_id": "BRL"
        }
    });

    let resp = state
        .http
        .post("https://api.mercadopago.com/preapproval_plan")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago plan request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago create preapproval_plan failed: {status} {text}");
        return Err(AppError::Internal(format!(
            "não foi possível criar o plano de assinatura no Mercado Pago (status {status})"
        )));
    }

    let parsed: MpPreapprovalResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago plan parse error: {e}")))?;

    let init_point = pick_init_point(&parsed).ok_or_else(|| {
        AppError::Internal("mercado pago plan sem init_point".to_string())
    })?;

    Ok(SubscriptionResult {
        preapproval_id: format!("{PLAN_ID_PREFIX}{}", parsed.id),
        init_point,
    })
}

fn plan_id_from_stored(stored: &str) -> Option<&str> {
    stored.strip_prefix(PLAN_ID_PREFIX)
}

async fn search_preapprovals_for_plan(
    state: &AppState,
    token: &str,
    plan_id: &str,
) -> Result<Vec<MpPreapprovalResponse>, AppError> {
    let url = format!("https://api.mercadopago.com/preapproval/search?preapproval_plan_id={plan_id}");
    let resp = state
        .http
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago search failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago search preapproval failed: {status} {text}");
        return Err(AppError::Internal("failed to search subscription status".to_string()));
    }

    let parsed: MpSearchResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago search parse error: {e}")))?;
    Ok(parsed.results.unwrap_or_default())
}

/// Consulta o status atual da assinatura.
/// "pending" -> lojista ainda não completou o checkout; "authorized" -> ativa;
/// "cancelled"/"paused" são autoexplicativos.
pub async fn get_subscription_status(state: &AppState, stored_id: &str) -> Result<String, AppError> {
    if stored_id.starts_with("mock-") {
        return Ok("authorized".to_string());
    }

    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;

    if let Some(plan_id) = plan_id_from_stored(stored_id) {
        let results = search_preapprovals_for_plan(state, token, plan_id).await?;
        if results.is_empty() {
            return Ok("pending".to_string());
        }
        // Preferência: authorized > paused > cancelled > pending
        let mut best = "pending".to_string();
        for r in results {
            match r.status.as_deref() {
                Some("authorized") => return Ok("authorized".to_string()),
                Some("paused") => best = "paused".to_string(),
                Some("cancelled") | Some("canceled") if best == "pending" => {
                    best = "cancelled".to_string();
                }
                _ => {}
            }
        }
        return Ok(best);
    }

    let url = format!("https://api.mercadopago.com/preapproval/{stored_id}");
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

/// Cancela a cobrança recorrente — chamado quando o assinante cancela pelo dashboard.
pub async fn cancel_subscription(state: &AppState, stored_id: &str) -> Result<(), AppError> {
    if stored_id.starts_with("mock-") {
        return Ok(());
    }
    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;

    if let Some(plan_id) = plan_id_from_stored(stored_id) {
        let results = search_preapprovals_for_plan(state, token, plan_id).await?;
        for r in results {
            if matches!(r.status.as_deref(), Some("authorized") | Some("paused") | Some("pending")) {
                cancel_preapproval_id(state, token, &r.id).await?;
            }
        }
        // Desativa o plano pra não aceitar novos checkouts nesse id.
        let url = format!("https://api.mercadopago.com/preapproval_plan/{plan_id}");
        let resp = state
            .http
            .put(&url)
            .bearer_auth(token)
            .json(&json!({ "status": "cancelled" }))
            .send()
            .await;
        if let Ok(r) = resp {
            if !r.status().is_success() {
                let text = r.text().await.unwrap_or_default();
                tracing::warn!("mercado pago cancel plan non-success: {text}");
            }
        }
        return Ok(());
    }

    cancel_preapproval_id(state, token, stored_id).await
}

async fn cancel_preapproval_id(state: &AppState, token: &str, preapproval_id: &str) -> Result<(), AppError> {
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
