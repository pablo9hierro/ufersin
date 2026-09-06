//! Mercado Pago Point/POS (maquininha física) -- reaproveita 100% o token
//! OAuth por tenant que Pix/Cartão já usam (`tenant::mp_access_token()`,
//! sincronizado da plataforma via `sync_store_payment_credentials`). Nenhum
//! OAuth novo, nenhuma credencial nova.
//!
//! Terminologia (confirmada na doc oficial, nunca inventada):
//! - Store: loja física cadastrada na conta Mercado Pago do tenant.
//! - POS ("caixa"): ponto de venda dentro de uma Store.
//! - Terminal: a maquininha física, associada a um POS pelo app oficial da
//!   Mercado Pago (o Resolutoo nunca automatiza essa etapa -- a doc confirma
//!   que isso é feito no dispositivo/app, não por API de terceiro).
//! - Point Order: a cobrança em si, enviada pro terminal.
//! - Point Tap: operação feita pelo app Mercado Pago no celular do
//!   colaborador -- não é um POS físico do Resolutoo, só documentado e
//!   sinalizado (ver `point_tap_enabled` em `vendedores`).

pub mod client;

use serde::{Deserialize, Serialize};

/// Bate com o CHECK constraint de `mp_point_orders.status`. Mapeamento
/// direto dos status reais retornados pela API de Orders da Mercado Pago
/// (nunca inventa um estado que a API não devolve).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointOrderStatus {
    Created,
    Pending,
    InProcess,
    Approved,
    Rejected,
    Canceled,
    Refunded,
    Failed,
    Unknown,
}

impl PointOrderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PointOrderStatus::Created => "created",
            PointOrderStatus::Pending => "pending",
            PointOrderStatus::InProcess => "in_process",
            PointOrderStatus::Approved => "approved",
            PointOrderStatus::Rejected => "rejected",
            PointOrderStatus::Canceled => "canceled",
            PointOrderStatus::Refunded => "refunded",
            PointOrderStatus::Failed => "failed",
            PointOrderStatus::Unknown => "unknown",
        }
    }

    /// Traduz o status cru vindo da API/webhook da Mercado Pago pro nosso
    /// enum interno -- qualquer valor não reconhecido vira `Unknown` (nunca
    /// panic, nunca inventa um estado que a Mercado Pago não documentou).
    pub fn from_mp_status(raw: &str) -> Self {
        match raw {
            "created" => PointOrderStatus::Created,
            "pending" => PointOrderStatus::Pending,
            "processing" | "in_process" => PointOrderStatus::InProcess,
            "finished" | "approved" => PointOrderStatus::Approved,
            "rejected" => PointOrderStatus::Rejected,
            "canceled" | "cancelled" => PointOrderStatus::Canceled,
            "refunded" => PointOrderStatus::Refunded,
            "failed" => PointOrderStatus::Failed,
            _ => PointOrderStatus::Unknown,
        }
    }

    /// Estados terminais -- uma vez aqui, o índice único parcial de
    /// `mp_point_orders` libera a `external_reference` pra uma nova
    /// tentativa (mesmo padrão de `fiscal_documents`/`deliveries`).
    pub fn is_terminal_failure(self) -> bool {
        matches!(self, PointOrderStatus::Canceled | PointOrderStatus::Rejected | PointOrderStatus::Failed)
    }
}

/// Referência pra quem está fazendo a cobrança -- nunca confiado vindo cru
/// do frontend; sempre resolvido a partir do JWT autenticado (`PdvUser`/
/// `StaffUser`) e revalidado contra `mp_point_employee_pos` antes de criar
/// qualquer Point Order.
#[derive(Debug, Clone)]
pub struct EmployeeRef {
    pub role: String,
    pub id: String,
}

/// Verifica se o POS pedido está entre os permitidos do funcionário.
/// Admin sempre pode usar qualquer POS do tenant (mesma regra de
/// `AdminUser` ter acesso irrestrito ao próprio tenant no resto do
/// código) -- só vendedor/motoboy/cozinha precisam estar na tabela de
/// associação.
pub fn employee_can_use_pos(employee: &EmployeeRef, allowed_pos_ids: &[String], pos_id: &str) -> bool {
    if employee.role == "admin" {
        return true;
    }
    allowed_pos_ids.iter().any(|id| id == pos_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_mp_status_maps_known_values() {
        assert_eq!(PointOrderStatus::from_mp_status("finished"), PointOrderStatus::Approved);
        assert_eq!(PointOrderStatus::from_mp_status("processing"), PointOrderStatus::InProcess);
        assert_eq!(PointOrderStatus::from_mp_status("cancelled"), PointOrderStatus::Canceled);
    }

    #[test]
    fn from_mp_status_unknown_value_never_panics() {
        assert_eq!(PointOrderStatus::from_mp_status("something_new_mp_invented"), PointOrderStatus::Unknown);
    }

    #[test]
    fn terminal_failure_states() {
        assert!(PointOrderStatus::Canceled.is_terminal_failure());
        assert!(PointOrderStatus::Rejected.is_terminal_failure());
        assert!(PointOrderStatus::Failed.is_terminal_failure());
        assert!(!PointOrderStatus::Approved.is_terminal_failure());
        assert!(!PointOrderStatus::Pending.is_terminal_failure());
    }

    #[test]
    fn admin_can_use_any_pos() {
        let admin = EmployeeRef { role: "admin".to_string(), id: "1".to_string() };
        assert!(employee_can_use_pos(&admin, &[], "pos-999"));
    }

    #[test]
    fn vendedor_blocked_from_pos_not_allowed() {
        let vendedor = EmployeeRef { role: "vendedor".to_string(), id: "v1".to_string() };
        let allowed = vec!["pos-1".to_string()];
        assert!(employee_can_use_pos(&vendedor, &allowed, "pos-1"));
        assert!(!employee_can_use_pos(&vendedor, &allowed, "pos-2"));
    }
}
