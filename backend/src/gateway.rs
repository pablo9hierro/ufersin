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

/// Qual gateway processa a assinatura Resolutoo (planos).
/// Preferência: gateway em sandbox/homologação antes de MP produção —
/// evita redirect pro checkout live do Mercado Pago quando há
/// AbacatePay `abc_dev_` / `abc_test_` (ou MP `TEST-…` / mock).
/// Sem nenhum token → MP em modo mock.
pub fn resolve_gateway_kind(state: &AppState) -> &'static str {
    let has_mp = state.mp_token.is_some();
    let has_ab = state.abacatepay_token.is_some();
    let mp_sandbox = mercadopago::sandbox_mode(state);
    let ab_sandbox = abacatepay_gateway::sandbox_mode(state);

    if has_mp && mp_sandbox {
        "mercadopago"
    } else if has_ab && ab_sandbox {
        // Prefer Abacate sandbox over live MP (APP_USR-…).
        "abacatepay"
    } else if has_mp {
        "mercadopago"
    } else if has_ab {
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
            // Mercado Pago preapproval: mensal = frequency 1 month; semestral =
            // frequency 6 months com o valor do semestre já calculado pelo caller.
            let r = mercadopago::create_subscription(
                state,
                reason,
                payer_email,
                amount_reais,
                cycle,
                external_reference,
            )
            .await?;
            // TEST-… / sem token → sandbox=true (front fica on-site em /obrigado
            // com "Simular pagamento"). Antes só mock-* era sandbox e TEST
            // redirecionava pro hosted checkout do MP.
            let sandbox = mercadopago::sandbox_mode(state);
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
        _ => mercadopago::sandbox_mode(state),
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

/// Estorna a cobrança mais recente da assinatura (janela de 7 dias).
/// Retorna `Ok(Some(refund_id))` se estornou, `Ok(None)` se não havia
/// pagamento localizável (mock / ainda não debitou).
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
        "abacatepay" => abacatepay_gateway::simulate_payment(state, external_id).await,
        _ => Ok(()), // mock MP — ativação local basta
    }
}

/// Atualiza o valor recorrente no gateway após upgrade/downgrade.
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
