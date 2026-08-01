use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use tokio::sync::RwLock;

use crate::error::AppError;
use crate::gateway::{BillingCycle, GatewayCharge, PaymentMethod};
use crate::state::AppState;

// Cobrança da assinatura do lojista via AbacatePay API v2.
// Chaves `abc_dev_*` (homologação) NÃO funcionam na v1 — usamos só v2.
// Cartão e Pix: checkout de assinatura recorrente (/subscriptions/create)
// com produto MONTHLY ou SEMIANNUALLY.

const BASE_V2: &str = "https://api.abacatepay.com/v2";

static PRODUCT_CACHE: std::sync::OnceLock<RwLock<HashMap<String, String>>> = std::sync::OnceLock::new();

fn product_cache() -> &'static RwLock<HashMap<String, String>> {
    PRODUCT_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn is_sandbox_key(token: &str) -> bool {
    let t = token.trim();
    t.starts_with("abc_dev_") || t.contains("_dev_") || t.starts_with("abc_test_")
}

fn extract_abacate_error_message(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    match v.get("error") {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(other) => Some(other.to_string()),
        None => None,
    }
}

pub fn sandbox_mode(state: &AppState) -> bool {
    match state.abacatepay_token.as_ref().as_ref() {
        Some(t) => is_sandbox_key(t),
        None => true, // sem chave = mock local
    }
}

#[derive(Debug, Deserialize)]
struct AbacateEnvelope<T> {
    data: Option<T>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AbacateProduct {
    id: String,
    #[serde(rename = "externalId")]
    external_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AbacateBilling {
    id: String,
    url: Option<String>,
    status: Option<String>,
}

fn cycle_api(cycle: BillingCycle) -> &'static str {
    match cycle {
        BillingCycle::Mensal => "MONTHLY",
        BillingCycle::Semestral => "SEMIANNUALLY",
    }
}

fn product_external_id(plan_code: &str, cycle: BillingCycle) -> String {
    format!("rodoletas-{plan_code}-{}", cycle.as_str())
}

fn product_name(plan_code: &str, cycle: BillingCycle) -> String {
    let plan = match plan_code {
        "essential" => "Essential",
        "management" => "Management",
        "premium" => "Premium",
        other => other,
    };
    match cycle {
        BillingCycle::Mensal => format!("Resolutoo {plan} — mensal"),
        BillingCycle::Semestral => format!("Resolutoo {plan} — semestral (−5%)"),
    }
}

fn site_origin(state: &AppState) -> String {
    // BACK_URL tipicamente é https://resolutoo.com/obrigado — extrai origem.
    let raw = state.back_url.as_str().trim();
    if raw.is_empty() {
        return "https://resolutoo.com".to_string();
    }
    // scheme://host[:port]/path...
    if let Some(rest) = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
    {
        let hostport = rest.split('/').next().unwrap_or("");
        if !hostport.is_empty() {
            let scheme = if raw.starts_with("https://") { "https" } else { "http" };
            return format!("{scheme}://{hostport}");
        }
    }
    "https://resolutoo.com".to_string()
}

fn completion_url(state: &AppState, external_reference: &str) -> String {
    if state.back_url.is_empty() {
        format!("{}/obrigado?id={external_reference}", site_origin(state))
    } else if state.back_url.contains('?') {
        format!("{}&id={external_reference}", state.back_url.as_str())
    } else {
        format!("{}?id={external_reference}", state.back_url.as_str())
    }
}

async fn ensure_product(
    state: &AppState,
    token: &str,
    plan_code: &str,
    cycle: BillingCycle,
    amount_reais: f64,
) -> Result<String, AppError> {
    let external_id = product_external_id(plan_code, cycle);
    if let Some(id) = product_cache().read().await.get(&external_id).cloned() {
        return Ok(id);
    }

    let amount_centavos = (amount_reais * 100.0).round() as i64;
    let body = json!({
        "externalId": external_id,
        "name": product_name(plan_code, cycle),
        "price": amount_centavos,
        "currency": "BRL",
        "description": product_name(plan_code, cycle),
        "cycle": cycle_api(cycle),
    });

    let resp = state
        .http
        .post(format!("{BASE_V2}/products/create"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay product create failed: {e}")))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        if let Some(id) = find_product_by_external_id(state, token, &external_id).await? {
            product_cache().write().await.insert(external_id, id.clone());
            return Ok(id);
        }
        tracing::error!("abacatepay product create failed: {status} {text}");
        return Err(AppError::Internal(format!(
            "falha ao criar produto AbacatePay ({status}). Verifique permissões da chave (PRODUCT:CREATE)."
        )));
    }

    let parsed: AbacateEnvelope<AbacateProduct> = serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("abacatepay product parse error: {e}")))?;
    if let Some(err) = parsed.error {
        return Err(AppError::Internal(format!("abacatepay rejected the product: {err}")));
    }
    let data = parsed
        .data
        .ok_or_else(|| AppError::Internal("abacatepay product response missing data".to_string()))?;
    product_cache().write().await.insert(external_id, data.id.clone());
    Ok(data.id)
}

async fn find_product_by_external_id(
    state: &AppState,
    token: &str,
    external_id: &str,
) -> Result<Option<String>, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_V2}/products/list"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay products list failed: {e}")))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let parsed: AbacateEnvelope<Vec<AbacateProduct>> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay products list parse error: {e}")))?;
    Ok(parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .find(|p| p.external_id.as_deref() == Some(external_id))
        .map(|p| p.id))
}

pub async fn create_subscription(
    state: &AppState,
    _reason: &str,
    payer_email: &str,
    plan_code: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    external_reference: &str,
    method: PaymentMethod,
) -> Result<GatewayCharge, AppError> {
    match state.abacatepay_token.as_ref().as_ref() {
        Some(token) => {
            let sandbox = is_sandbox_key(token);
            let prefer_card = matches!(method, PaymentMethod::Cartao | PaymentMethod::CartaoParcelado);
            // Ordem: método pedido → o outro → (só sandbox) mock local com "Simular pagamento".
            let order = if prefer_card {
                ["CARD", "PIX"]
            } else {
                ["PIX", "CARD"]
            };

            let mut last_err: Option<AppError> = None;
            for method_name in order {
                let methods = [method_name];
                match create_subscription_checkout(
                    state,
                    token,
                    plan_code,
                    amount_reais,
                    cycle,
                    payer_email,
                    external_reference,
                    &methods,
                )
                .await
                {
                    Ok(charge) => return Ok(charge),
                    Err(e) if is_method_unavailable_error(&e) => {
                        tracing::warn!(
                            "abacatepay method {method_name} unavailable — trying next fallback: {}",
                            err_message(&e)
                        );
                        last_err = Some(e);
                    }
                    Err(e) => {
                        last_err = Some(e);
                        break;
                    }
                }
            }

            if sandbox {
                tracing::warn!(
                    "abacatepay homolog store has no CARD/PIX automático — using local sandbox mock so checkout can proceed via Simular pagamento. last_err={:?}",
                    last_err
                );
                return Ok(sandbox_mock_charge(state, external_reference));
            }

            Err(last_err.unwrap_or_else(|| {
                AppError::BadRequest(
                    "AbacatePay recusou o checkout. Ative Pix/Cartão na loja AbacatePay ou use chave de produção."
                        .to_string(),
                )
            }))
        }
        None => Ok(sandbox_mock_charge(state, external_reference)),
    }
}

fn sandbox_mock_charge(state: &AppState, external_reference: &str) -> GatewayCharge {
    GatewayCharge {
        external_id: format!("mock-abacatepay-{}", uuid::Uuid::new_v4()),
        checkout_url: Some(completion_url(state, external_reference)),
        pix_qr_code: None,
        pix_qr_base64: None,
        sandbox: true,
    }
}

fn err_message(err: &AppError) -> &str {
    match err {
        AppError::BadRequest(m) | AppError::Internal(m) | AppError::Unauthorized(m) | AppError::NotFound(m) => m.as_str(),
    }
}

fn is_method_unavailable_error(err: &AppError) -> bool {
    let lower = err_message(err).to_ascii_lowercase();
    lower.contains("not available for this store")
        || lower.contains("não dispon")
        || lower.contains("pix automático")
        || lower.contains("card is not available")
}

async fn create_subscription_checkout(
    state: &AppState,
    token: &str,
    plan_code: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    payer_email: &str,
    external_reference: &str,
    methods: &[&str],
) -> Result<GatewayCharge, AppError> {
    let product_id = ensure_product(state, token, plan_code, cycle, amount_reais).await?;
    let completion = completion_url(state, external_reference);
    let return_url = format!(
        "{}/assinar?plano={plan_code}&ciclo={}",
        site_origin(state),
        cycle.as_str()
    );

    let body = json!({
        "items": [{ "id": product_id, "quantity": 1 }],
        "methods": methods,
        "externalId": external_reference,
        "completionUrl": completion,
        "returnUrl": return_url,
        "metadata": {
            "email": payer_email,
            "plan": plan_code,
            "cycle": cycle.as_str(),
        }
    });

    let resp = state
        .http
        .post(format!("{BASE_V2}/subscriptions/create"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay subscription create failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("abacatepay subscription create failed: {status} {text}");
        let api_err = extract_abacate_error_message(&text);
        if status.as_u16() == 400 {
            return Err(AppError::BadRequest(api_err.unwrap_or_else(|| {
                "AbacatePay recusou o checkout. Tente Pix ou ative Cartão no painel AbacatePay.".to_string()
            })));
        }
        return Err(AppError::Internal(api_err.unwrap_or_else(|| {
            format!("falha ao criar checkout AbacatePay ({status})")
        })));
    }

    let parsed: AbacateEnvelope<AbacateBilling> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay subscription parse error: {e}")))?;
    if let Some(err) = parsed.error {
        tracing::error!("abacatepay subscription error: {err}");
        let msg = err.as_str().map(|s| s.to_string()).unwrap_or_else(|| err.to_string());
        return Err(AppError::BadRequest(format!("abacatepay: {msg}")));
    }
    let data = parsed
        .data
        .ok_or_else(|| AppError::Internal("abacatepay subscription response missing data".to_string()))?;

    Ok(GatewayCharge {
        external_id: data.id,
        checkout_url: data.url,
        pix_qr_code: None,
        pix_qr_base64: None,
        sandbox: is_sandbox_key(token),
    })
}

pub async fn get_status(state: &AppState, external_id: &str) -> Result<String, AppError> {
    // Mock local (homolog sem PIX/CARD na loja Abacate) — já foi ativado
    // no assinar_plano; nunca reportar PENDING senão o poller reverte ativo→pendente.
    if external_id.starts_with("mock-") {
        return Ok("PAID".to_string());
    }
    let token = state
        .abacatepay_token
        .as_ref()
        .as_ref()
        .ok_or_else(|| AppError::Internal("abacatepay not configured".to_string()))?;

    let resp = state
        .http
        .get(format!("{BASE_V2}/subscriptions/get"))
        .bearer_auth(token)
        .query(&[("id", external_id)])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay request failed: {e}")))?;

    if !resp.status().is_success() {
        // Fallback: checkout avulso / transparent
        let resp2 = state
            .http
            .get(format!("{BASE_V2}/checkouts/get"))
            .bearer_auth(token)
            .query(&[("id", external_id)])
            .send()
            .await;
        if let Ok(r) = resp2 {
            if r.status().is_success() {
                let parsed: AbacateEnvelope<AbacateBilling> = r
                    .json()
                    .await
                    .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
                return Ok(parsed.data.and_then(|d| d.status).unwrap_or_else(|| "PENDING".to_string()));
            }
        }
        return Err(AppError::Internal("failed to fetch abacatepay subscription status".to_string()));
    }
    let parsed: AbacateEnvelope<AbacateBilling> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay parse error: {e}")))?;
    Ok(parsed.data.and_then(|d| d.status).unwrap_or_else(|| "PENDING".to_string()))
}

pub async fn cancel(state: &AppState, external_id: &str) -> Result<(), AppError> {
    if external_id.starts_with("mock-") {
        return Ok(());
    }
    let Some(token) = state.abacatepay_token.as_ref().as_ref() else {
        return Ok(());
    };
    let resp = state
        .http
        .post(format!("{BASE_V2}/subscriptions/cancel"))
        .bearer_auth(token)
        .json(&json!({ "id": external_id }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("abacatepay cancel failed: {e}")))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::warn!("abacatepay cancel non-success: {text}");
    }
    Ok(())
}

/// Em homologação (chave abc_dev_): tenta simular na AbacatePay e/ou libera localmente.
pub async fn simulate_payment(state: &AppState, external_id: &str) -> Result<(), AppError> {
    if external_id.starts_with("mock-") {
        return Ok(());
    }
    let Some(token) = state.abacatepay_token.as_ref().as_ref() else {
        return Ok(());
    };
    if !is_sandbox_key(token) {
        return Err(AppError::BadRequest(
            "simulação de pagamento só está disponível com chave de homologação (abc_dev_)".to_string(),
        ));
    }

    // Best-effort — endpoints de simulate variam; se falhar, o caller ainda
    // pode ativar localmente em sandbox.
    for path in [
        format!("{BASE_V2}/subscriptions/simulate-payment"),
        format!("{BASE_V2}/checkouts/simulate-payment"),
        format!("{BASE_V2}/transparents/simulate-payment"),
    ] {
        let resp = state
            .http
            .post(&path)
            .bearer_auth(token)
            .json(&json!({ "id": external_id }))
            .send()
            .await;
        if let Ok(r) = resp {
            if r.status().is_success() {
                tracing::info!("abacatepay simulate ok via {path}");
                return Ok(());
            }
            let text = r.text().await.unwrap_or_default();
            tracing::warn!("abacatepay simulate {path}: {text}");
        }
    }
    Ok(())
}

pub async fn handle_webhook(payload: &serde_json::Value) -> Option<(String, String)> {
    let event = payload.get("event").and_then(|v| v.as_str())?;
    let external_id = payload
        .get("data")?
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("data")?.get("billing")?.get("id").and_then(|v| v.as_str()))?
        .to_string();
    let status = match event {
        "billing.paid"
        | "pixQrCode.paid"
        | "subscription.paid"
        | "checkout.paid"
        | "checkout.completed"
        | "transparent.completed"
        | "subscription.activated" => "PAID",
        _ => return None,
    };
    Some((external_id, status.to_string()))
}
