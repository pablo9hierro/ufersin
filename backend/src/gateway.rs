use serde::Serialize;

use crate::error::AppError;
use crate::mercadopago;
use crate::state::AppState;

/// Unified result across gateways. Platform Assinar is **on-site only** —
/// `checkout_url` stays None (never redirect to mercadopago.com.br).
#[derive(Debug, Serialize)]
pub struct GatewayCharge {
    pub external_id: String,
    /// Deprecated for platform Assinar — always None (no hosted redirect).
    pub checkout_url: Option<String>,
    pub pix_qr_code: Option<String>,
    pub pix_qr_base64: Option<String>,
    /// true = homologação / mock — front oferece "Simular pagamento".
    pub sandbox: bool,
    /// `pix` | `card` | `done`
    pub payment_step: String,
}

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

pub const SEMESTRAL_DISCOUNT: f64 = 0.05;

pub fn charge_amount(monthly_price: f64, cycle: BillingCycle) -> f64 {
    match cycle {
        BillingCycle::Mensal => monthly_price,
        BillingCycle::Semestral => {
            ((monthly_price * 6.0) * (1.0 - SEMESTRAL_DISCOUNT) * 100.0).round() / 100.0
        }
    }
}

/// `PAYMENT_MODE=sandbox|production` overrides token inference.
pub fn payment_mode_sandbox(state: &AppState) -> bool {
    match state.payment_mode.as_str() {
        "sandbox" | "test" | "homolog" | "homologacao" => true,
        "production" | "prod" => false,
        _ => mercadopago::sandbox_mode(state),
    }
}

/// Único gateway suportado pra assinatura da plataforma.
pub fn resolve_gateway_kind(_state: &AppState) -> &'static str {
    "mercadopago"
}

/// Cria cobrança **on-site** (Pix QR ou passo cartão). Nunca devolve URL
/// de checkout hospedado do Mercado Pago.
pub async fn create_subscription(
    state: &AppState,
    _gateway: &str,
    reason: &str,
    payer_email: &str,
    _plan_code: &str,
    amount_reais: f64,
    _cycle: BillingCycle,
    external_reference: &str,
    method: PaymentMethod,
) -> Result<GatewayCharge, AppError> {
    let sandbox = payment_mode_sandbox(state);
    let prefer_pix = matches!(method, PaymentMethod::Pix);

    if prefer_pix {
        let mut charge = mercadopago::create_onsite_pix(
            state,
            reason,
            payer_email,
            amount_reais,
            external_reference,
        )
        .await?;
        charge.checkout_url = None;
        return Ok(charge);
    }

    // Cartão: front renderiza formulário on-site; backend só marca pending.
    Ok(mercadopago::create_onsite_card_pending(sandbox))
}

pub fn sandbox_mode(state: &AppState) -> bool {
    payment_mode_sandbox(state)
}

pub async fn get_status(state: &AppState, _gateway: &str, external_id: &str) -> Result<String, AppError> {
    mercadopago::get_onsite_payment_status(state, external_id).await
}

pub async fn cancel(state: &AppState, _gateway: &str, external_id: &str) {
    if let Err(e) = mercadopago::cancel_subscription(state, external_id).await {
        tracing::warn!("gateway cancel failed (proceeding with local cancellation anyway): {e:?}");
    }
}

pub async fn refund_latest_subscription_payment(
    state: &AppState,
    _gateway: &str,
    external_id: &str,
) -> Result<Option<String>, AppError> {
    mercadopago::refund_latest_subscription_payment(state, external_id).await
}

pub async fn simulate_payment(_state: &AppState, _gateway: &str, _external_id: &str) -> Result<(), AppError> {
    Ok(())
}

pub async fn update_amount(
    state: &AppState,
    _gateway: &str,
    external_id: &str,
    amount_reais: f64,
) -> Result<(), AppError> {
    mercadopago::update_subscription_amount(state, external_id, amount_reais).await
}
