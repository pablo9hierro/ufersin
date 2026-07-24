use crate::error::AppError;

/// Applies the admin-role portion of the order status flow.
/// Returns `true` if the transition should also set `payment_status = 'pago'`.
pub fn admin_apply_transition(
    current_status: &str,
    target_status: &str,
    delivery_type: &str,
    payment_method: &str,
    payment_status: &str,
    payment_confirmed: Option<bool>,
) -> Result<bool, AppError> {
    match (current_status, target_status) {
        ("pendente", "montando_pedido") => Ok(false),
        ("montando_pedido", "pedido_pronto") => Ok(false),
        ("pedido_pronto", "retiradas") => {
            if delivery_type != "retirada" {
                return Err(AppError::BadRequest(
                    "only retirada orders can move to retiradas".to_string(),
                ));
            }
            Ok(false)
        }
        ("retiradas", "concluido") => {
            if delivery_type != "retirada" {
                return Err(AppError::BadRequest(
                    "only retirada orders can be concluded from retiradas".to_string(),
                ));
            }
            confirm_payment_if_needed(payment_method, payment_status, payment_confirmed)
        }
        _ => Err(AppError::BadRequest(format!(
            "invalid status transition: {current_status} -> {target_status}"
        ))),
    }
}

/// Applies the motoboy-role portion of the order status flow. Note:
/// pedido_pronto -> aguardando_localizacao is intentionally NOT handled here,
/// it only happens via the bulk request-location endpoint.
///
/// Payment confirmation (for non-pix orders) is gated on the
/// em_rota_de_entrega -> entregue transition, not on entregue -> concluido:
/// the motoboy fills the payment popup right when marking the order as
/// delivered, and the final "concluir" step is then a plain advance.
pub fn motoboy_apply_transition(
    current_status: &str,
    target_status: &str,
    payment_method: &str,
    payment_status: &str,
    payment_confirmed: Option<bool>,
) -> Result<bool, AppError> {
    match (current_status, target_status) {
        ("aguardando_localizacao", "em_rota_de_entrega") => Ok(false),
        ("em_rota_de_entrega", "entregue") => {
            confirm_payment_if_needed(payment_method, payment_status, payment_confirmed)
        }
        // Normally payment is already confirmed by the time an order reaches
        // "entregue" (gated above). This also accepts payment_confirmed here
        // as a fallback so an order can never get stuck unable to reach
        // "concluido" if it somehow arrived at "entregue" without payment
        // having been confirmed yet.
        ("entregue", "concluido") => {
            if payment_status == "pago" {
                Ok(false)
            } else {
                confirm_payment_if_needed(payment_method, payment_status, payment_confirmed)
            }
        }
        _ => Err(AppError::BadRequest(format!(
            "invalid status transition: {current_status} -> {target_status}"
        ))),
    }
}

fn confirm_payment_if_needed(
    payment_method: &str,
    payment_status: &str,
    payment_confirmed: Option<bool>,
) -> Result<bool, AppError> {
    if payment_method == "pix" {
        if payment_status != "pago" {
            return Err(AppError::BadRequest(
                "pix payment has not been confirmed yet".to_string(),
            ));
        }
        Ok(false)
    } else {
        if payment_confirmed != Some(true) {
            return Err(AppError::BadRequest(
                "payment_confirmed: true is required to complete this order".to_string(),
            ));
        }
        Ok(true)
    }
}
