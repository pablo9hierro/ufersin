//! Rotas de simulação de pagamento, para lojas em modo sandbox.
//!
//! Só respondem quando a loja tem credencial simulada
//! (`plataforma_credenciais.token` com o prefixo `TEST-SANDBOX-`). Loja com
//! Mercado Pago real conectado recebe `403` — não existe caminho aqui para
//! marcar um pedido de loja real como pago sem pagamento.
//!
//! Aprovar um pagamento chama o **mesmo handler do webhook real**
//! (`webhooks::handle_mercadopago`), então o que é exercitado é o fluxo de
//! produção inteiro: rebusca do pagamento, idempotência, baixa de estoque,
//! transição de status e notificação no WhatsApp.

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;

use crate::error::AppError;
use crate::mp_sandbox;
use crate::routes::webhooks;
use crate::state::AppState;
use crate::tenant;

#[derive(Serialize)]
pub struct SimulatedPaymentDto {
    pub payment_id: String,
    pub status: String,
    pub order_id: String,
    pub amount: f64,
    pub method: String,
}

#[derive(Serialize)]
pub struct SandboxActionResult {
    pub payment_id: String,
    pub status: String,
    pub order_id: String,
    /// `true` quando o handler do webhook rodou e liquidou o pedido.
    pub webhook_processed: bool,
}

/// Garante que a loja do pedido está em modo simulado. Devolve o `user_id`
/// das credenciais, que o webhook usa para achar o tenant.
async fn require_sandbox_tenant(state: &AppState, order_id: &str) -> Result<String, AppError> {
    let store = tenant::tenant_for_order(&state.pool, order_id).await?;
    let payment = tenant::load_tenant_payment(&state.pool, &store.id).await?;

    let token = payment.mp_access_token().unwrap_or_default();
    if !mp_sandbox::is_sandbox_token(token) {
        return Err(AppError::Forbidden(
            "esta loja não está em modo de simulação de pagamento".to_string(),
        ));
    }

    payment
        .plataforma_credenciais
        .as_ref()
        .and_then(|v| v.get("user_id"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::BadRequest(
                "credencial simulada sem `user_id` — o webhook não consegue achar a loja".to_string(),
            )
        })
}

/// `GET /api/sandbox/orders/{order_id}/payments`
/// Lista os pagamentos simulados de um pedido, para a tela de simulação.
pub async fn list_order_payments(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> Result<Json<Vec<SimulatedPaymentDto>>, AppError> {
    require_sandbox_tenant(&state, &order_id).await?;

    let out = mp_sandbox::list_for_order(&order_id)
        .into_iter()
        .map(|(payment_id, p)| SimulatedPaymentDto {
            payment_id,
            status: p.status,
            order_id: p.external_reference,
            amount: p.amount,
            method: p.method.to_string(),
        })
        .collect();
    Ok(Json(out))
}

/// Dispara o handler real do webhook para o pagamento informado.
async fn fire_webhook(state: &AppState, payment_id: &str, mp_user_id: &str) -> bool {
    let payload = json!({
        "type": "payment",
        "data": { "id": payment_id },
        "user_id": mp_user_id,
    });
    // Sem header de assinatura: o handler apenas registra aviso e segue,
    // porque ele rebusca o pagamento antes de confiar em qualquer coisa —
    // e, em sandbox, a rebusca vem do simulador.
    match webhooks::handle_mercadopago(state, &HeaderMap::new(), &HashMap::new(), &payload).await {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!("sandbox: webhook simulado falhou: {e:?}");
            false
        }
    }
}

/// `POST /api/sandbox/payments/{payment_id}/approve`
/// Equivale ao cliente ter pago: aprova e roda o webhook de verdade.
pub async fn approve_payment(
    State(state): State<AppState>,
    Path(payment_id): Path<String>,
) -> Result<Json<SandboxActionResult>, AppError> {
    let Some(order_id) = mp_sandbox::get(&payment_id).map(|p| p.external_reference) else {
        return Err(AppError::NotFound(format!(
            "pagamento simulado {payment_id} não encontrado"
        )));
    };
    let mp_user_id = require_sandbox_tenant(&state, &order_id).await?;

    mp_sandbox::approve(&payment_id);
    let webhook_processed = fire_webhook(&state, &payment_id, &mp_user_id).await;

    Ok(Json(SandboxActionResult {
        payment_id,
        status: "approved".to_string(),
        order_id,
        webhook_processed,
    }))
}

/// `POST /api/sandbox/payments/{payment_id}/reject`
/// Recusa o pagamento — para testar o caminho de falha, não só o feliz.
/// O pedido continua pendente, como aconteceria de verdade.
pub async fn reject_payment(
    State(state): State<AppState>,
    Path(payment_id): Path<String>,
) -> Result<Json<SandboxActionResult>, AppError> {
    let Some(order_id) = mp_sandbox::get(&payment_id).map(|p| p.external_reference) else {
        return Err(AppError::NotFound(format!(
            "pagamento simulado {payment_id} não encontrado"
        )));
    };
    require_sandbox_tenant(&state, &order_id).await?;
    mp_sandbox::reject(&payment_id);

    Ok(Json(SandboxActionResult {
        payment_id,
        status: "rejected".to_string(),
        order_id,
        webhook_processed: false,
    }))
}
