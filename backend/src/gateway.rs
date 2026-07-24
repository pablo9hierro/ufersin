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
    /// card checkout). None when the charge is PIX-only (QR code instead).
    pub checkout_url: Option<String>,
    pub pix_qr_code: Option<String>,
    pub pix_qr_base64: Option<String>,
}

/// PIX, cartão (à vista) e cartão parcelado — o spec pede suporte aos três;
/// qual deles um gateway realmente honra depende do gateway (Mercado Pago
/// preapproval aqui só faz cartão recorrente; AbacatePay é PIX-first).
/// Existe pra a intenção do lojista via o formulário de checkout, mesmo
/// enquanto nem todo gateway consegue atender todas as três ainda.
#[derive(Debug, Clone, Copy, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Pix,
    Cartao,
    CartaoParcelado,
}

/// Qual gateway processa a assinatura — hoje só "mercadopago" está
/// realmente ligado (é o que já funciona em produção); "abacatepay" existe
/// como camada preparada e roda em modo mock até ter credencial de
/// verdade (mesmo padrão mock/real já usado no motor de e-commerce pro
/// Pix do cliente final — ver ecommerce/backend/src/abacatepay.rs).
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
    valor_mensal: f64,
    external_reference: &str,
    method: PaymentMethod,
) -> Result<GatewayCharge, AppError> {
    match gateway {
        "abacatepay" => abacatepay_gateway::create_subscription(state, reason, payer_email, valor_mensal, external_reference, method).await,
        _ => {
            let r = mercadopago::create_subscription(state, reason, payer_email, valor_mensal, external_reference).await?;
            Ok(GatewayCharge {
                external_id: r.preapproval_id,
                checkout_url: Some(r.init_point),
                pix_qr_code: None,
                pix_qr_base64: None,
            })
        }
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
