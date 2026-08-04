use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;
use crate::gateway::{BillingCycle, GatewayCharge};
use crate::state::AppState;

/// Prefixo gravado em `subscribers.mp_preapproval_id` quando o checkout
/// foi criado via `/preapproval_plan` (necessário em contas TEST onde
/// `POST /preapproval` com status pending devolve 500).
const PLAN_ID_PREFIX: &str = "mpp-";

/// Pix avulso on-site (`POST /v1/payments`) — nunca init_point.
pub const PIX_ID_PREFIX: &str = "mpix-";
pub const PAY_ID_PREFIX: &str = "pay-";
pub const PENDING_CARD_PREFIX: &str = "pending-card-";
const MOCK_PIX_PREFIX: &str = "mock-pix-";

pub struct SubscriptionResult {
    pub preapproval_id: String,
    /// Legado — NÃO usar pra redirecionar. Assinar Resolutoo é on-site.
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

#[derive(Debug, Deserialize)]
struct MpPaymentResponse {
    id: Option<serde_json::Value>,
    status: Option<String>,
    point_of_interaction: Option<MpPoi>,
}

#[derive(Debug, Deserialize)]
struct MpPoi {
    transaction_data: Option<MpTxData>,
}

#[derive(Debug, Deserialize)]
struct MpTxData {
    qr_code: Option<String>,
    qr_code_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpAuthorizedPayment {
    id: Option<i64>,
    payment: Option<MpAuthorizedPaymentInner>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpAuthorizedPaymentInner {
    id: Option<i64>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpAuthorizedSearch {
    results: Option<Vec<MpAuthorizedPayment>>,
}

#[derive(Debug, Deserialize)]
struct MpRefundResponse {
    id: Option<i64>,
}

/// Credencial de teste (`TEST-...`) ou ausência de token → sandbox/mock.
pub fn sandbox_mode(state: &AppState) -> bool {
    match state.mp_token.as_ref().as_ref() {
        None => true,
        Some(t) => t.trim().starts_with("TEST-"),
    }
}

fn pick_init_point(parsed: &MpPreapprovalResponse, prefer_sandbox: bool) -> Option<String> {
    if prefer_sandbox {
        parsed
            .sandbox_init_point
            .clone()
            .or_else(|| parsed.init_point.clone())
    } else {
        parsed
            .init_point
            .clone()
            .or_else(|| parsed.sandbox_init_point.clone())
    }
}

fn cycle_frequency(cycle: BillingCycle) -> (i32, &'static str) {
    match cycle {
        BillingCycle::Mensal => (1, "months"),
        BillingCycle::Semestral => (6, "months"),
    }
}

fn completion_back_url(state: &AppState, external_reference: &str) -> String {
    let separador = if state.back_url.contains('?') { "&" } else { "?" };
    format!("{}{separador}id={external_reference}", state.back_url.as_str())
}

fn payment_id_string(v: &Option<serde_json::Value>) -> Option<String> {
    match v {
        Some(serde_json::Value::Number(n)) => Some(n.to_string()),
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn normalize_qr_b64(raw: Option<String>) -> Option<String> {
    let raw = raw.filter(|s| !s.is_empty())?;
    if raw.starts_with("data:") {
        Some(raw)
    } else {
        Some(format!("data:image/png;base64,{raw}"))
    }
}

fn fake_pix_copia_cola(reason: &str) -> String {
    let chunk = uuid::Uuid::new_v4().simple().to_string().to_uppercase();
    let nome: String = reason.chars().take(25).collect::<String>().to_uppercase();
    let nome = if nome.is_empty() {
        "RESOLUTOO".to_string()
    } else {
        nome
    };
    format!(
        "00020126580014BR.GOV.BCB.PIX0136{chunk}5204000053039865802BR59{:02}{nome}6009SAO PAULO62070503***6304ABCD",
        nome.len()
    )
}

fn mock_pix_charge(reason: &str, sandbox: bool) -> GatewayCharge {
    GatewayCharge {
        external_id: format!("{MOCK_PIX_PREFIX}{}", uuid::Uuid::new_v4()),
        checkout_url: None,
        pix_qr_code: Some(fake_pix_copia_cola(reason)),
        pix_qr_base64: None,
        sandbox,
        payment_step: "pix".to_string(),
    }
}

/// Cobrança Pix on-site via Payments API — **nunca** devolve init_point/redirect.
pub async fn create_onsite_pix(
    state: &AppState,
    reason: &str,
    payer_email: &str,
    amount_reais: f64,
    external_reference: &str,
) -> Result<GatewayCharge, AppError> {
    let sandbox = sandbox_mode(state);
    let Some(token) = state.mp_token.as_ref().as_ref() else {
        return Ok(mock_pix_charge(reason, true));
    };

    match create_mp_pix_payment(state, token, reason, payer_email, amount_reais, external_reference).await
    {
        Ok(c) => Ok(c),
        Err(e) if sandbox => {
            tracing::warn!("MP Pix failed in sandbox ({e:?}) — using mock PIX QR");
            Ok(mock_pix_charge(reason, true))
        }
        Err(e) => Err(e),
    }
}

async fn create_mp_pix_payment(
    state: &AppState,
    token: &str,
    reason: &str,
    payer_email: &str,
    amount_reais: f64,
    external_reference: &str,
) -> Result<GatewayCharge, AppError> {
    let body = json!({
        "transaction_amount": (amount_reais * 100.0).round() / 100.0,
        "description": reason.chars().take(200).collect::<String>(),
        "payment_method_id": "pix",
        "external_reference": external_reference,
        "payer": { "email": payer_email },
    });

    let resp = state
        .http
        .post("https://api.mercadopago.com/v1/payments")
        .bearer_auth(token)
        .header("X-Idempotency-Key", uuid::Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago pix request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago create pix failed: {status} {text}");
        return Err(AppError::Internal(format!(
            "não foi possível criar cobrança Pix no Mercado Pago ({status})"
        )));
    }

    let parsed: MpPaymentResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago pix parse error: {e}")))?;

    let payment_id = payment_id_string(&parsed.id)
        .ok_or_else(|| AppError::Internal("mercado pago pix sem payment id".to_string()))?;

    let tx = parsed
        .point_of_interaction
        .and_then(|p| p.transaction_data)
        .ok_or_else(|| AppError::Internal("mercado pago pix sem QR".to_string()))?;

    let qr_code = tx
        .qr_code
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("mercado pago pix sem qr_code".to_string()))?;

    Ok(GatewayCharge {
        external_id: format!("{PIX_ID_PREFIX}{payment_id}"),
        checkout_url: None,
        pix_qr_code: Some(qr_code),
        pix_qr_base64: normalize_qr_b64(tx.qr_code_base64),
        sandbox: sandbox_mode(state),
        payment_step: "pix".to_string(),
    })
}

/// Placeholder on-site card — front coleta cartão; nunca redirect.
pub fn create_onsite_card_pending(sandbox: bool) -> GatewayCharge {
    GatewayCharge {
        external_id: format!("{PENDING_CARD_PREFIX}{}", uuid::Uuid::new_v4()),
        checkout_url: None,
        pix_qr_code: None,
        pix_qr_base64: None,
        sandbox,
        payment_step: "card".to_string(),
    }
}

/// Cartões de teste MP (sandbox) + token real em produção.
pub async fn pay_onsite_card(
    state: &AppState,
    payer_email: &str,
    amount_reais: f64,
    external_reference: &str,
    reason: &str,
    card_number: &str,
    card_holder: &str,
    exp_month: &str,
    exp_year: &str,
    cvv: &str,
    card_token: Option<&str>,
    auto_debit: bool,
) -> Result<String, AppError> {
    let digits: String = card_number.chars().filter(|c| c.is_ascii_digit()).collect();
    let sandbox = sandbox_mode(state);

    if sandbox {
        let ok = matches!(
            digits.as_str(),
            "5031433215406351"
                | "4235647728025682"
                | "4009175336724084"
                | "5411750505590619"
                | "371180303257522"
                | "4111111111111111"
        ) || (digits.len() >= 13 && digits.starts_with('4'));
        if !ok {
            return Err(AppError::BadRequest(
                "no sandbox use um cartão de teste do Mercado Pago (ex.: 5031 4332 1540 6351, CVV 123)"
                    .to_string(),
            ));
        }
        if cvv.trim().len() < 3 {
            return Err(AppError::BadRequest("CVV inválido".to_string()));
        }
        let _ = (card_holder, exp_month, exp_year, auto_debit);
        return Ok(format!("mock-card-{}", uuid::Uuid::new_v4()));
    }

    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("Mercado Pago não configurado".to_string()))?;

    let payment_token = if let Some(t) = card_token.map(str::trim).filter(|s| !s.is_empty()) {
        t.to_string()
    } else {
        create_card_token(state, token, &digits, card_holder, exp_month, exp_year, cvv).await?
    };

    let body = json!({
        "transaction_amount": (amount_reais * 100.0).round() / 100.0,
        "token": payment_token,
        "description": reason.chars().take(200).collect::<String>(),
        "installments": 1,
        "payment_method_id": detect_brand(&digits),
        "external_reference": external_reference,
        "payer": { "email": payer_email },
    });

    let resp = state
        .http
        .post("https://api.mercadopago.com/v1/payments")
        .bearer_auth(token)
        .header("X-Idempotency-Key", uuid::Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago card request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago card payment failed: {status} {text}");
        return Err(AppError::BadRequest(
            "pagamento com cartão recusado. Verifique os dados ou tente Pix.".to_string(),
        ));
    }

    let parsed: MpPaymentResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago card parse error: {e}")))?;

    let status = parsed.status.unwrap_or_default();
    if !matches!(status.as_str(), "approved" | "authorized") {
        return Err(AppError::BadRequest(format!(
            "pagamento não aprovado (status: {status})"
        )));
    }

    let payment_id = payment_id_string(&parsed.id)
        .ok_or_else(|| AppError::Internal("mercado pago card sem payment id".to_string()))?;

    if auto_debit {
        tracing::info!(
            "auto_debit solicitado — preapproval best-effort (sem redirect) para {external_reference}"
        );
        let _ = create_subscription(
            state,
            reason,
            payer_email,
            amount_reais,
            BillingCycle::Mensal,
            external_reference,
        )
        .await;
    }

    Ok(format!("{PAY_ID_PREFIX}{payment_id}"))
}

fn detect_brand(digits: &str) -> &'static str {
    if digits.starts_with('4') {
        "visa"
    } else if digits.starts_with('5') || digits.starts_with('2') {
        "master"
    } else if digits.starts_with('3') {
        "amex"
    } else {
        "visa"
    }
}

async fn create_card_token(
    state: &AppState,
    access_token: &str,
    number: &str,
    holder: &str,
    exp_month: &str,
    exp_year: &str,
    cvv: &str,
) -> Result<String, AppError> {
    let year = exp_year.trim();
    let year_n: i32 = if year.len() <= 2 {
        year.parse::<i32>().unwrap_or(0) + 2000
    } else {
        year.parse().unwrap_or(0)
    };
    let body = json!({
        "card_number": number,
        "security_code": cvv.trim(),
        "expiration_month": exp_month.trim().parse::<i32>().unwrap_or(0),
        "expiration_year": year_n,
        "cardholder": {
            "name": holder.trim(),
            "identification": { "type": "CPF", "number": "19119119100" }
        }
    });

    let resp = state
        .http
        .post("https://api.mercadopago.com/v1/card_tokens")
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("card token request failed: {e}")))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago card_tokens failed: {text}");
        return Err(AppError::BadRequest(
            "não foi possível tokenizar o cartão. Confira número, validade e CVV.".to_string(),
        ));
    }

    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("card token parse: {e}")))?;
    v.get("id")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal("card token sem id".to_string()))
}

/// Status de cobrança on-site (mpix-/pay-/mock-/pending-card-…) ou preapproval legado.
pub async fn get_onsite_payment_status(state: &AppState, stored_id: &str) -> Result<String, AppError> {
    if stored_id.starts_with(MOCK_PIX_PREFIX)
        || stored_id.starts_with("mock-card-")
        || stored_id.starts_with(PENDING_CARD_PREFIX)
    {
        return Ok("pending".to_string());
    }
    // Mock preapproval antigo (sem token) — treat as authorized for pollers.
    if stored_id.starts_with("mock-") {
        return Ok("authorized".to_string());
    }

    let payment_id = stored_id
        .strip_prefix(PIX_ID_PREFIX)
        .or_else(|| stored_id.strip_prefix(PAY_ID_PREFIX));

    if let Some(pay_id) = payment_id {
        let Some(token) = state.mp_token.as_ref().as_ref() else {
            return Ok("pending".to_string());
        };
        let resp = state
            .http
            .get(format!("https://api.mercadopago.com/v1/payments/{pay_id}"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("mp payment status failed: {e}")))?;
        if !resp.status().is_success() {
            return Ok("pending".to_string());
        }
        let v: serde_json::Value = resp.json().await.unwrap_or_default();
        let st = v.get("status").and_then(|s| s.as_str()).unwrap_or("pending");
        return Ok(match st {
            "approved" | "authorized" => "authorized".to_string(),
            "cancelled" | "canceled" | "rejected" | "refunded" => "cancelled".to_string(),
            _ => "pending".to_string(),
        });
    }

    get_preapproval_status(state, stored_id).await
}

/// Preapproval legado (só auto-débito best-effort). Nunca usar no fluxo Pix.
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
            match create_via_preapproval(
                state,
                token,
                reason,
                payer_email,
                amount_reais,
                cycle,
                external_reference,
                &back_url,
            )
            .await
            {
                Ok(r) => Ok(r),
                Err(e) => {
                    tracing::warn!(
                        "mercado pago POST /preapproval failed ({e:?}) — falling back to /preapproval_plan"
                    );
                    create_via_plan(
                        state,
                        token,
                        reason,
                        amount_reais,
                        cycle,
                        external_reference,
                        &back_url,
                    )
                    .await
                }
            }
        }
        None => Ok(SubscriptionResult {
            preapproval_id: format!("mock-{}", uuid::Uuid::new_v4()),
            init_point: format!("{back_url}&mock_subscription=1"),
        }),
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
            "mercado pago preapproval failed ({status})"
        )));
    }

    let parsed: MpPreapprovalResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago parse error: {e}")))?;
    let init_point = pick_init_point(&parsed, sandbox_mode(state)).ok_or_else(|| {
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
    let body = json!({
        "reason": reason,
        "external_reference": external_reference,
        "auto_recurring": {
            "frequency": frequency,
            "frequency_type": frequency_type,
            "transaction_amount": amount_reais,
            "currency_id": "BRL",
            "free_trial": null,
        },
        "back_url": back_url,
    });

    let resp = state
        .http
        .post("https://api.mercadopago.com/preapproval_plan")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago create preapproval_plan failed: {status} {text}");
        return Err(AppError::Internal(format!(
            "mercado pago preapproval_plan failed ({status})"
        )));
    }

    let parsed: MpPreapprovalResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago plan parse error: {e}")))?;
    let init_point = pick_init_point(&parsed, sandbox_mode(state)).ok_or_else(|| {
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
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago search preapproval failed: {status} {text}");
        return Err(AppError::Internal("failed to search preapprovals".to_string()));
    }
    let parsed: MpSearchResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago search parse error: {e}")))?;
    Ok(parsed.results.unwrap_or_default())
}

pub async fn get_subscription_status(state: &AppState, stored_id: &str) -> Result<String, AppError> {
    get_onsite_payment_status(state, stored_id).await
}

async fn get_preapproval_status(state: &AppState, stored_id: &str) -> Result<String, AppError> {
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

pub async fn cancel_subscription(state: &AppState, stored_id: &str) -> Result<(), AppError> {
    if stored_id.starts_with("mock-")
        || stored_id.starts_with(PIX_ID_PREFIX)
        || stored_id.starts_with(PAY_ID_PREFIX)
        || stored_id.starts_with(PENDING_CARD_PREFIX)
    {
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
            if matches!(
                r.status.as_deref(),
                Some("authorized") | Some("paused") | Some("pending")
            ) {
                cancel_preapproval_id(state, token, &r.id).await?;
            }
        }
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

async fn cancel_preapproval_id(
    state: &AppState,
    token: &str,
    preapproval_id: &str,
) -> Result<(), AppError> {
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

pub async fn update_subscription_amount(
    state: &AppState,
    stored_id: &str,
    amount_reais: f64,
) -> Result<(), AppError> {
    if stored_id.starts_with("mock-")
        || stored_id.starts_with(PIX_ID_PREFIX)
        || stored_id.starts_with(PAY_ID_PREFIX)
        || stored_id.starts_with(PENDING_CARD_PREFIX)
    {
        return Ok(());
    }
    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;

    if let Some(plan_id) = plan_id_from_stored(stored_id) {
        let url = format!("https://api.mercadopago.com/preapproval_plan/{plan_id}");
        let resp = state
            .http
            .put(&url)
            .bearer_auth(token)
            .json(&json!({
                "auto_recurring": { "transaction_amount": amount_reais }
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            tracing::error!("mercado pago update plan amount failed: {text}");
            return Err(AppError::Internal(
                "falha ao atualizar valor no Mercado Pago".to_string(),
            ));
        }
        return Ok(());
    }

    let url = format!("https://api.mercadopago.com/preapproval/{stored_id}");
    let resp = state
        .http
        .put(&url)
        .bearer_auth(token)
        .json(&json!({
            "auto_recurring": { "transaction_amount": amount_reais }
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago update preapproval amount failed: {text}");
        return Err(AppError::Internal(
            "falha ao atualizar valor no Mercado Pago".to_string(),
        ));
    }
    Ok(())
}

pub async fn refund_latest_subscription_payment(
    state: &AppState,
    stored_id: &str,
) -> Result<Option<String>, AppError> {
    if stored_id.starts_with("mock-") {
        return Ok(None);
    }

    // Pix/card on-site payment id → refund that payment directly.
    if let Some(pay_id) = stored_id
        .strip_prefix(PIX_ID_PREFIX)
        .or_else(|| stored_id.strip_prefix(PAY_ID_PREFIX))
    {
        return refund_payment_id(state, pay_id).await.map(Some);
    }

    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;

    let preapproval_id = if let Some(plan_id) = plan_id_from_stored(stored_id) {
        let results = search_preapprovals_for_plan(state, token, plan_id).await?;
        let authorized = results.into_iter().find(|r| {
            matches!(
                r.status.as_deref(),
                Some("authorized") | Some("paused") | Some("pending")
            )
        });
        match authorized {
            Some(r) => r.id,
            None => return Ok(None),
        }
    } else {
        stored_id.to_string()
    };

    let url = format!(
        "https://api.mercadopago.com/authorized_payments/search?preapproval_id={preapproval_id}"
    );
    let resp = state
        .http
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago request failed: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago authorized_payments search failed: {text}");
        return Err(AppError::Internal(
            "falha ao localizar cobrança da assinatura".to_string(),
        ));
    }
    let parsed: MpAuthorizedSearch = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago parse error: {e}")))?;

    let payment_id = parsed.results.unwrap_or_default().into_iter().find_map(|ap| {
        let ok = matches!(
            ap.status
                .as_deref()
                .or(ap.payment.as_ref().and_then(|p| p.status.as_deref())),
            Some("approved") | Some("authorized") | Some("processed")
        );
        if !ok {
            return None;
        }
        ap.payment
            .as_ref()
            .and_then(|p| p.id)
            .or(ap.id)
            .map(|id| id.to_string())
    });

    let Some(payment_id) = payment_id else {
        return Ok(None);
    };

    refund_payment_id(state, &payment_id).await.map(Some)
}

async fn refund_payment_id(state: &AppState, payment_id: &str) -> Result<String, AppError> {
    let token = state
        .mp_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("mercado pago not configured".to_string()))?;
    let refund_url = format!("https://api.mercadopago.com/v1/payments/{payment_id}/refunds");
    let resp = state
        .http
        .post(&refund_url)
        .bearer_auth(token)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago refund failed: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("mercado pago refund failed: {text}");
        return Err(AppError::Internal(
            "falha ao estornar pagamento no Mercado Pago".to_string(),
        ));
    }
    let refund: MpRefundResponse = resp.json().await.unwrap_or(MpRefundResponse { id: None });
    Ok(refund
        .id
        .map(|id| id.to_string())
        .unwrap_or_else(|| format!("refund-{payment_id}")))
}
