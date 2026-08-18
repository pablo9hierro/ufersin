//! Worker de expiração de pagamento — segundo processo periódico do
//! backend (o primeiro é `appointment_reminders.rs`, mesmo padrão).
//!
//! Pedido com Pix/link gerado (`payment_expires_at` setado em
//! `create_pix_payment`/`create_card_link`) e não pago dentro do prazo é
//! cancelado sozinho — reusa exatamente `cancel::apply_cancel`, o mesmo
//! caminho que cancelamento manual (cliente/admin) já usa, então estoque
//! reservado e estorno (se algum dia isso ficar `pago` por uma corrida
//! rara antes do tick rodar) seguem a MESMA lógica testada.

use std::time::Duration;

use crate::cancel::{self, CancelInput};
use crate::error::AppError;
use crate::models::OrderRow;
use crate::state::AppState;
use crate::tenant;

const TICK: Duration = Duration::from_secs(60);

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        ticker.tick().await; // pula o disparo imediato do primeiro tick, ver appointment_reminders.rs
        loop {
            ticker.tick().await;
            if let Err(e) = run_tick(&state).await {
                tracing::warn!("order-expiration tick failed: {e:?}");
            }
        }
    });
}

async fn run_tick(state: &AppState) -> anyhow::Result<()> {
    let expired: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, tenant_id FROM orders \
         WHERE payment_status = 'pendente' AND status NOT IN ('cancelado', 'concluido') \
           AND payment_expires_at IS NOT NULL AND now() >= payment_expires_at \
         LIMIT 200",
    )
    .fetch_all(&state.pool)
    .await?;

    for (order_id, tenant_id) in expired {
        if let Err(e) = expire_one(state, &tenant_id, &order_id).await {
            tracing::warn!("order-expiration: falha ao cancelar pedido {order_id}: {e:?}");
        }
    }
    Ok(())
}

async fn expire_one(state: &AppState, tenant_id: &str, order_id: &str) -> Result<(), AppError> {
    let payment_cfg = tenant::load_tenant_payment(&state.pool, tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, tenant_id).await?;

    // Relê dentro da transação: outro request pode ter pago ou cancelado
    // entre a varredura (fora de transação) e agora — condição de corrida
    // real, não hipotética (pagamento confirma via webhook a qualquer hora).
    let Some(order): Option<OrderRow> = crate::orders_common::fetch_order_row(&mut *tx, tenant_id, order_id).await? else {
        return Ok(());
    };
    if order.payment_status == "pago" || order.status == "cancelado" || order.status == "concluido" {
        return Ok(());
    }

    cancel::apply_cancel(
        state,
        &mut tx,
        tenant_id,
        &order,
        &payment_cfg,
        CancelInput {
            cancel_by: "sistema",
            cancel_reason: "Pagamento expirado".to_string(),
            cancel_note: Some("Cobrança (Pix/link) gerada há mais de 30 minutos sem confirmação — cancelado automaticamente.".to_string()),
        },
    )
    .await?;
    tx.commit().await?;
    tracing::info!("order-expiration: pedido {order_id} cancelado por expiração (tenant {tenant_id})");
    Ok(())
}
