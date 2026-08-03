//! Order cancel eligibility + refund orchestration.
//!
//! Customer may cancel only **before** "saiu para entrega"
//! (`em_rota_de_entrega` / Essential `entregas`). Admin may cancel at any
//! status except `concluido` (and already-`cancelado`).
//!
//! Online Pix refund: when the order was charged via Mercado Pago and the
//! tenant has an access token, call MP refunds **before** flipping status.
//! On refund API failure we do **not** cancel (customer stays charged with
//! a clear error). Manual / unpaid / Abacate without refund path → cancel
//! only; lojista acerta devolução offline se já recebeu.

use sqlx::PgConnection;

use crate::error::AppError;
use crate::mercadopago;
use crate::models::OrderRow;
use crate::state::AppState;
use crate::tenant::TenantPayment;

/// Statuses at/after "saiu para entrega" — customer cannot cancel.
const CUSTOMER_BLOCKED: &[&str] = &[
    "em_rota_de_entrega",
    "entregas",
    "entregue",
    "concluido",
    "cancelado",
];

pub fn customer_can_cancel(status: &str) -> bool {
    !CUSTOMER_BLOCKED.contains(&status)
}

pub fn admin_can_cancel(status: &str) -> bool {
    !matches!(status, "concluido" | "cancelado")
}

pub const ADMIN_REASON_CLIENTE: &str = "A pedido do cliente";
pub const ADMIN_REASON_OUTRO: &str = "Outro";

#[derive(Debug, Clone)]
pub struct CancelInput {
    pub cancel_by: &'static str, // cliente | admin
    pub cancel_reason: String,
    pub cancel_note: Option<String>,
}

/// True when this order was (or should be treated as) an online Pix charge
/// that we can attempt to refund via Mercado Pago.
fn needs_mp_refund(order: &OrderRow, payment: &TenantPayment) -> bool {
    if order.payment_method != "pix" || order.payment_status != "pago" {
        return false;
    }
    let Some(pid) = order.pix_payment_id.as_deref() else {
        return false;
    };
    if pid.is_empty() || pid.starts_with("mock-") {
        return false;
    }
    // Prefer explicit provider; fall back to tenant MP + numeric MP payment id.
    let provider = order.pix_provider.as_deref().unwrap_or("");
    if provider == "mercado_pago" {
        return payment.mp_access_token().is_some();
    }
    if provider == "abacate_pay" || provider == "mock" {
        return false;
    }
    // Legacy rows without pix_provider: only attempt MP if tenant is on MP
    // and the id looks like an MP payment id (numeric).
    payment.mp_access_token().is_some() && pid.chars().all(|c| c.is_ascii_digit())
}

pub async fn apply_cancel(
    state: &AppState,
    conn: &mut PgConnection,
    tenant_id: &str,
    order: &OrderRow,
    payment: &TenantPayment,
    input: CancelInput,
) -> Result<(), AppError> {
    if order.status == "cancelado" {
        return Err(AppError::BadRequest("pedido já está cancelado".to_string()));
    }

    let mut refund_status = "not_applicable".to_string();
    let mut refund_id: Option<String> = None;
    let mut payment_status = order.payment_status.clone();

    if needs_mp_refund(order, payment) {
        let token = payment.mp_access_token().ok_or_else(|| {
            AppError::BadRequest(
                "Não foi possível estornar o Pix automaticamente — tente de novo ou estorne no painel Mercado Pago"
                    .to_string(),
            )
        })?;
        let pid = order.pix_payment_id.as_deref().unwrap();
        // Refund first — do not cancel if MP rejects.
        match mercadopago::refund_payment(state, token, pid).await {
            Ok(rid) => {
                refund_status = "refunded".to_string();
                refund_id = Some(rid);
                payment_status = "reembolsado".to_string();
            }
            Err(e) => {
                let _ = sqlx::query(
                    "UPDATE orders SET refund_status = 'refund_failed', updated_at = now()::text \
                     WHERE tenant_id = $1 AND id = $2",
                )
                .bind(tenant_id)
                .bind(&order.id)
                .execute(&mut *conn)
                .await;
                return Err(e);
            }
        }
    } else if order.payment_method == "pix"
        && order.payment_status == "pago"
        && order.pix_payment_id.is_some()
    {
        // Charged online via Abacate/mock or MP token missing → cancel only;
        // lojista resolves money manually if needed.
        refund_status = "not_applicable".to_string();
    }

    let note = input.cancel_note.as_deref().map(str::trim).filter(|s| !s.is_empty());

    sqlx::query(
        "UPDATE orders SET status = 'cancelado', payment_status = $1, \
         cancel_by = $2, cancel_reason = $3, cancel_note = $4, canceled_at = now()::text, \
         refund_status = $5, refund_id = $6, updated_at = now()::text \
         WHERE tenant_id = $7 AND id = $8",
    )
    .bind(&payment_status)
    .bind(input.cancel_by)
    .bind(&input.cancel_reason)
    .bind(note)
    .bind(&refund_status)
    .bind(&refund_id)
    .bind(tenant_id)
    .bind(&order.id)
    .execute(&mut *conn)
    .await?;

    Ok(())
}
