use serde::Serialize;

use crate::abacatepay_gateway;
use crate::error::AppError;
use crate::mercadopago;
use crate::state::AppState;

/// Unified result across gateways — mercadopago::SubscriptionResult and
/// abacatepay_gateway's own result both map into this at the dispatch
/// point below, so routes/onboarding/dashboard code never needs to know
/// which gateway is behind a given subscriber.
#[derive(Debug, Serialize)]
pub struct GatewayCharge {
    pub external_id: String,
    /// Redirect-based checkout (Mercado Pago hosted checkout, AbacatePay
    /// card/pix checkout). None when the charge is PIX-only (QR code instead).
    pub checkout_url: Option<String>,
    pub pix_qr_code: Option<String>,
    pub pix_qr_base64: Option<String>,
    /// true = chave de homologação / mock — front pode mostrar "Simular pagamento".
    pub sandbox: bool,
}

/// PIX, cartão (à vista) e cartão parcelado — o spec pede suporte aos três;
/// qual deles um gateway realmente honra depende do gateway (Mercado Pago
/// preapproval aqui só faz cartão recorrente; AbacatePay é PIX-first no
/// avulso e CARD no checkout de assinatura recorrente).
#[derive(Debug, Clone, Copy, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Pix,
    Cartao,
    CartaoParcelado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingCycle {
    Mensal,
    Semestral,
}

impl BillingCycle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mensal => "mensal",
            Self::Semestral => "semestral",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "mensal" => Some(Self::Mensal),
            "semestral" => Some(Self::Semestral),
            _ => None,
        }
    }
}

/// Desconto de 5% no total do semestre (6 × mensal × 0.95).
pub const SEMESTRAL_DISCOUNT: f64 = 0.05;

/// Valor cobrado por ciclo: mensal = preço cheio; semestral = 6 meses − 5%.
pub fn charge_amount(monthly_price: f64, cycle: BillingCycle) -> f64 {
    match cycle {
        BillingCycle::Mensal => monthly_price,
        BillingCycle::Semestral => ((monthly_price * 6.0) * (1.0 - SEMESTRAL_DISCOUNT) * 100.0).round() / 100.0,
    }
}

/// Qual gateway processa a assinatura — AbacatePay tem prioridade quando a
/// chave está configurada; senão cai no Mercado Pago.
pub fn resolve_gateway_kind(state: &AppState) -> &'static str {
    if state.abacatepay_token.is_some() {
        "abacatepay"
    } else {
        "mercadopago"
    }
}

pub async fn create_subscription(
    state: &AppState,
    gateway: &str,
    reason: &str,
    payer_email: &str,
    plan_code: &str,
    amount_reais: f64,
    cycle: BillingCycle,
    external_reference: &str,
    method: PaymentMethod,
) -> Result<GatewayCharge, AppError> {
    match gateway {
        "abacatepay" => {
            abacatepay_gateway::create_subscription(
                state,
                reason,
                payer_email,
                plan_code,
                amount_reais,
                cycle,
                external_reference,
                method,
            )
            .await
        }
        _ => {
            // Mercado Pago preapproval é mensal; semestral cobra o valor do
            // período como transaction_amount único por ciclo (ainda mensal
            // no MP — o valor já vem ajustado pelo caller).
            let r = mercadopago::create_subscription(state, reason, payer_email, amount_reais, external_reference).await?;
            let sandbox = r.preapproval_id.starts_with("mock-");
            Ok(GatewayCharge {
                external_id: r.preapproval_id,
                checkout_url: Some(r.init_point),
                pix_qr_code: None,
                pix_qr_base64: None,
                sandbox,
            })
        }
    }
}

pub fn sandbox_mode(state: &AppState) -> bool {
    match resolve_gateway_kind(state) {
        "abacatepay" => abacatepay_gateway::sandbox_mode(state),
        _ => state.mp_token.is_none(),
    }
}

pub async fn get_status(state: &AppState, gateway: &str, external_id: &str) -> Result<String, AppError> {
    match gateway {
        "abacatepay" => abacatepay_gateway::get_status(state, external_id).await,
        _ => mercadopago::get_subscription_status(state, external_id).await,
    }
}

/// Cancela a cobrança recorrente no gateway — chamado por POST
/// /api/me/cancelar. Best-effort: se o gateway estiver em modo mock ou a
/// chamada falhar, o cancelamento local (status do subscriber) ainda
/// segue em frente; só loga o erro.
pub async fn cancel(state: &AppState, gateway: &str, external_id: &str) {
    let result = match gateway {
        "abacatepay" => abacatepay_gateway::cancel(state, external_id).await,
        _ => mercadopago::cancel_subscription(state, external_id).await,
    };
    if let Err(e) = result {
        tracing::warn!("gateway cancel failed (proceeding with local cancellation anyway): {e:?}");
    }
}

pub async fn simulate_payment(state: &AppState, gateway: &str, external_id: &str) -> Result<(), AppError> {
    match gateway {
        "abacatepay" => abacatepay_gateway::simulate_payment(state, external_id).await,
        _ => Ok(()), // mock MP — ativação local basta
    }
}
