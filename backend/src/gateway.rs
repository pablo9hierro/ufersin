use serde::Serialize;

use crate::abacatepay_gateway;
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
        _ => match resolve_gateway_kind(state) {
            "abacatepay" => abacatepay_gateway::sandbox_mode(state),
            _ => mercadopago::sandbox_mode(state),
        },
    }
}

/// Prefer sandbox gateways; never prefer live MP redirect for Assinar.
///
/// With `PAYMENT_MODE=production` and an MP token, always label as
/// `mercadopago` — even if a leftover AbacatePay `abc_dev_` key is set
/// (that used to mis-tag live Pix as `gateway=abacatepay`).
pub fn resolve_gateway_kind(state: &AppState) -> &'static str {
    let has_mp = state.mp_token_sync().is_some();
    let has_ab = state.abacatepay_token.as_ref().as_ref().is_some();

    if matches!(state.payment_mode.as_str(), "production" | "prod") && has_mp {
        return "mercadopago";
    }

    let mp_sandbox = mercadopago::sandbox_mode(state);
    let ab_sandbox = abacatepay_gateway::sandbox_mode(state);

    if has_mp && mp_sandbox {
        "mercadopago"
    } else if has_ab && ab_sandbox {
        "abacatepay"
    } else if has_mp {
        "mercadopago"
    } else if has_ab {
        "abacatepay"
    } else {
        "mercadopago"
    }
}

/// Cria cobrança **on-site** (Pix QR ou passo cartão). Nunca devolve URL
/// de checkout hospedado do Mercado Pago / AbacatePay.
pub async fn create_subscription(
    state: &AppState,
    gateway: &str,
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
        // Pix on-site: MP Payments API (ou mock). Abacate subscription URL é
        // redirect — não usamos pra plataforma.
        let mut charge = mercadopago::create_onsite_pix(
            state,
            reason,
            payer_email,
            amount_reais,
            external_reference,
        )
        .await?;
        charge.checkout_url = None;
        if gateway == "abacatepay" {
            charge.sandbox = sandbox || charge.sandbox;
        }
        return Ok(charge);
    }

    // Cartão: front renderiza formulário on-site; backend só marca pending.
    let _ = gateway;
    Ok(mercadopago::create_onsite_card_pending(sandbox))
}

pub fn sandbox_mode(state: &AppState) -> bool {
    payment_mode_sandbox(state)
}

pub async fn get_status(state: &AppState, gateway: &str, external_id: &str) -> Result<String, AppError> {
    let onsite = external_id.starts_with("pay-")
        || external_id.starts_with("mpix-")
        || external_id.starts_with("mock-")
        || external_id.starts_with("pending-card-");
    match gateway {
        "abacatepay" if !onsite => abacatepay_gateway::get_status(state, external_id).await,
        _ => mercadopago::get_onsite_payment_status(state, external_id).await,
    }
}

pub async fn cancel(state: &AppState, gateway: &str, external_id: &str) {
    let onsite = external_id.starts_with("pay-")
        || external_id.starts_with("mpix-")
        || external_id.starts_with("mock-")
        || external_id.starts_with("pending-card-");
    let result = match gateway {
        "abacatepay" if !onsite => abacatepay_gateway::cancel(state, external_id).await,
        _ => mercadopago::cancel_subscription(state, external_id).await,
    };
    if let Err(e) = result {
        tracing::warn!("gateway cancel failed (proceeding with local cancellation anyway): {e:?}");
    }
}

pub async fn refund_latest_subscription_payment(
    state: &AppState,
    gateway: &str,
    external_id: &str,
) -> Result<Option<String>, AppError> {
    match gateway {
        "abacatepay" => {
            tracing::warn!(
                "abacatepay subscription refund não implementado — external_id={external_id}"
            );
            Ok(None)
        }
        _ => mercadopago::refund_latest_subscription_payment(state, external_id).await,
    }
}

pub async fn simulate_payment(state: &AppState, gateway: &str, external_id: &str) -> Result<(), AppError> {
    match gateway {
        "abacatepay"
            if !external_id.starts_with("mock-")
                && !external_id.starts_with("pay-")
                && !external_id.starts_with("pending-card-") =>
        {
            abacatepay_gateway::simulate_payment(state, external_id).await
        }
        _ => Ok(()),
    }
}

pub async fn update_amount(
    state: &AppState,
    gateway: &str,
    external_id: &str,
    amount_reais: f64,
) -> Result<(), AppError> {
    match gateway {
        "abacatepay" => {
            tracing::warn!(
                "abacatepay update_amount não implementado — valor local={amount_reais}; external_id={external_id}"
            );
            Ok(())
        }
        _ => mercadopago::update_subscription_amount(state, external_id, amount_reais).await,
    }
}
