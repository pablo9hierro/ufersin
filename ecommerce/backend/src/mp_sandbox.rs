//! Simulador de Mercado Pago para lojas de teste.
//!
//! Existe porque validar o fluxo de pagamento ponta a ponta (Pix gerado →
//! webhook → pedido `pago` → estoque baixado → WhatsApp) exigia uma conta
//! Mercado Pago real conectada por OAuth. Com este módulo, um tenant marcado
//! como sandbox exercita **os mesmos caminhos de código** — mesma criação de
//! pedido, mesmo webhook, mesma máquina de status — só que sem sair para a
//! API do Mercado Pago e sem dinheiro envolvido.
//!
//! Como a loja entra em modo sandbox: `tenants.plataforma_credenciais.token`
//! começa com `TEST-SANDBOX-`. Token de verdade (`APP_USR-` de produção ou
//! `TEST-` de teste do próprio Mercado Pago) nunca cai aqui — a checagem é
//! por prefixo exato, então não há como uma loja real ser tratada como
//! simulada por engano.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use uuid::Uuid;

use crate::mercadopago::PixResult;

/// Prefixo que marca a credencial como simulada.
pub const SANDBOX_TOKEN_PREFIX: &str = "TEST-SANDBOX-";

pub fn is_sandbox_token(access_token: &str) -> bool {
    access_token.starts_with(SANDBOX_TOKEN_PREFIX)
}

/// Pagamentos simulados, em memória: `payment_id` → status.
///
/// Em memória de propósito: é estado de teste e some no restart, sem sujar o
/// banco da loja com linhas que não existem no Mercado Pago.
fn store() -> &'static Mutex<HashMap<String, SimulatedPayment>> {
    static STORE: OnceLock<Mutex<HashMap<String, SimulatedPayment>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Debug)]
pub struct SimulatedPayment {
    pub status: String,
    pub external_reference: String,
    pub amount: f64,
    pub method: &'static str,
}

/// Cobrança Pix simulada. Nasce `pending`, igual à real — só vira `approved`
/// quando alguém "paga" via `approve()`.
pub fn create_pix_charge(total: f64, external_reference: &str) -> PixResult {
    let payment_id = format!("sandbox-{}", Uuid::new_v4().simple());

    store().lock().unwrap().insert(
        payment_id.clone(),
        SimulatedPayment {
            status: "pending".to_string(),
            external_reference: external_reference.to_string(),
            amount: total,
            method: "pix",
        },
    );

    // Copia-e-cola no formato EMV do Pix (começa com "000201", como o real),
    // pra qualquer validação de formato no frontend continuar valendo.
    let qr_code = format!(
        "000201260{}5204000053039865802BR5913LOJA SANDBOX6009SAO PAULO62070503***6304SIM{}",
        external_reference.len().min(9),
        &payment_id[8..12].to_uppercase()
    );

    PixResult {
        payment_id,
        qr_code: qr_code.clone(),
        // PNG 1x1 transparente — placeholder válido pro <img src="data:...">
        // do checkout renderizar sem quebrar.
        qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".to_string(),
    }
}

/// Pagamento simulado no cartão. Aprova na hora, como um cartão de teste
/// aprovado do Mercado Pago.
pub fn create_card_payment(total: f64, external_reference: &str) -> (String, String) {
    let payment_id = format!("sandbox-{}", Uuid::new_v4().simple());
    store().lock().unwrap().insert(
        payment_id.clone(),
        SimulatedPayment {
            status: "approved".to_string(),
            external_reference: external_reference.to_string(),
            amount: total,
            method: "card",
        },
    );
    (payment_id, "approved".to_string())
}

pub fn get_status(payment_id: &str) -> Option<String> {
    store().lock().unwrap().get(payment_id).map(|p| p.status.clone())
}

pub fn get(payment_id: &str) -> Option<SimulatedPayment> {
    store().lock().unwrap().get(payment_id).cloned()
}

/// Marca o pagamento como aprovado — o equivalente a o cliente ter pago.
/// Devolve o `external_reference` (id do pedido) pra quem chamou seguir com
/// o mesmo tratamento do webhook real.
pub fn approve(payment_id: &str) -> Option<String> {
    let mut guard = store().lock().unwrap();
    let p = guard.get_mut(payment_id)?;
    p.status = "approved".to_string();
    Some(p.external_reference.clone())
}

/// Recusa o pagamento — pra testar o caminho de falha, não só o feliz.
pub fn reject(payment_id: &str) -> Option<String> {
    let mut guard = store().lock().unwrap();
    let p = guard.get_mut(payment_id)?;
    p.status = "rejected".to_string();
    Some(p.external_reference.clone())
}

pub fn refund(payment_id: &str) -> Option<String> {
    let mut guard = store().lock().unwrap();
    let p = guard.get_mut(payment_id)?;
    p.status = "refunded".to_string();
    Some(p.external_reference.clone())
}

/// Pagamentos simulados pendentes de um pedido — usado pela rota que lista
/// o que dá pra "pagar" na tela de simulação.
pub fn list_for_order(external_reference: &str) -> Vec<(String, SimulatedPayment)> {
    store()
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, p)| p.external_reference == external_reference)
        .map(|(id, p)| (id.clone(), p.clone()))
        .collect()
}
