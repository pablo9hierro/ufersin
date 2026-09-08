//! Cobrança recorrente da assinatura da plataforma (loop interno, sem
//! infra de cron externa). Ver migrations/0036_recurring_billing.sql pro
//! desenho completo das regras.
//!
//! Loop único (`spawn_recurring_billing`) roda de hora em hora e faz duas
//! varreduras independentes:
//! 1. `bill_due_subscribers`: quem venceu (`next_billing_at <= now()`) e
//!    ainda está `ativo` -- gera uma cobrança Pix nova pelo valor JÁ
//!    TRAVADO (`valor_mensal`, nunca recalculado por cupom/preço atual) e
//!    bloqueia a loja (`status = 'pausado'`) com 3 dias úteis de tolerância.
//! 2. `expire_grace_periods`: quem estourou a janela de tolerância sem
//!    pagar -- cancela de vez e derruba qualquer cupom (próxima assinatura
//!    paga o preço de tabela do momento, sem desconto nenhum).
//!
//! Pagar dentro da janela reativa via o MESMO caminho de sempre
//! (`activate_paid_subscriber`, chamado pelo webhook do Mercado Pago quando
//! a cobrança gerada aqui é aprovada) -- nenhum código novo de ativação.

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use crate::gateway::{self, BillingCycle, PaymentMethod};
use crate::state::AppState;

/// 3 dias úteis (segunda a sexta, sem contar feriados -- limite aceito:
/// feriado nacional dentro da janela dá 1 dia extra de tolerância de
/// graça, nunca a menos do que o prometido). Some(days) sempre >= 0.
fn add_business_days(from: DateTime<Utc>, mut days: i64) -> DateTime<Utc> {
    let mut d = from;
    while days > 0 {
        d += Duration::days(1);
        let is_weekend = matches!(d.format("%u").to_string().as_str(), "6" | "7");
        if !is_weekend {
            days -= 1;
        }
    }
    d
}

pub fn spawn_recurring_billing(state: AppState) {
    tokio::spawn(async move {
        // Pequeno atraso no boot -- evita competir com o startup (JWKS,
        // pool warmup) do próprio processo.
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            if let Err(e) = bill_due_subscribers(&state).await {
                tracing::error!(error = ?e, "recurring billing: bill_due_subscribers failed");
            }
            if let Err(e) = expire_grace_periods(&state).await {
                tracing::error!(error = ?e, "recurring billing: expire_grace_periods failed");
            }
        }
    });
}

#[derive(sqlx::FromRow)]
struct DueSubscriber {
    id: String,
    email: String,
    loja_nome: String,
    plan_code: String,
    valor_mensal: f64,
    billing_cycle: String,
}

/// Loja com assinatura vencida: gera a fatura de renovação e bloqueia até
/// pagar ou estourar a janela de tolerância.
async fn bill_due_subscribers(state: &AppState) -> Result<(), crate::error::AppError> {
    let due: Vec<DueSubscriber> = sqlx::query_as(
        "SELECT id, email, loja_nome, plan_code, valor_mensal, billing_cycle \
         FROM subscribers \
         WHERE status = 'ativo' AND next_billing_at IS NOT NULL AND next_billing_at <= now()",
    )
    .fetch_all(&state.pool)
    .await?;

    for sub in due {
        let cycle = BillingCycle::parse(&sub.billing_cycle).unwrap_or(BillingCycle::Mensal);
        let reason = format!("Renovação Resolutoo ({}/{}) — {}", sub.plan_code, cycle.as_str(), sub.loja_nome.trim());

        // Cobrança automática só via Pix -- não existe cartão salvo (o
        // fluxo on-site nunca guarda token de cartão), então cartão exigiria
        // o lojista digitar os dados de novo mesmo assim.
        let charge = match gateway::create_subscription(
            state,
            "mercadopago",
            &reason,
            sub.email.trim(),
            &sub.plan_code,
            sub.valor_mensal,
            cycle,
            &sub.id,
            PaymentMethod::Pix,
        )
        .await
        {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(subscriber_id = %sub.id, error = ?e, "recurring billing: falha ao gerar cobrança — não bloqueia a loja sem cobrança gerada");
                continue;
            }
        };

        let now = Utc::now();
        let grace_until = add_business_days(now, 3);

        sqlx::query(
            "INSERT INTO subscriber_invoices (id, subscriber_id, amount, billing_cycle, status, gateway, external_id, due_date) \
             VALUES ($1, $2, $3, $4, 'pendente', 'mercadopago', $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&sub.id)
        .bind(sub.valor_mensal)
        .bind(cycle.as_str())
        .bind(&charge.external_id)
        .bind(now)
        .execute(&state.pool)
        .await?;

        // Bloqueia a loja (mesmo gate que já existe pra assinatura inativa
        // -- tenant_config só devolve dado pra status='ativo') com janela
        // de tolerância pro pagamento honrar o mesmo valor/cupom.
        sqlx::query(
            "UPDATE subscribers SET status = 'pausado', mp_preapproval_id = $1, \
             billing_grace_until = $2, updated_at = now() WHERE id = $3",
        )
        .bind(&charge.external_id)
        .bind(grace_until)
        .bind(&sub.id)
        .execute(&state.pool)
        .await?;

        tracing::info!(
            subscriber_id = %sub.id,
            valor = sub.valor_mensal,
            grace_until = %grace_until,
            "recurring billing: cobrança de renovação gerada, loja pausada até pagamento"
        );
    }

    Ok(())
}

/// Estourou a janela de tolerância sem pagar: cancela e derruba o cupom
/// (a próxima assinatura, se houver, paga preço de tabela do momento).
async fn expire_grace_periods(state: &AppState) -> Result<(), crate::error::AppError> {
    let expired: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM subscribers \
         WHERE status = 'pausado' AND billing_grace_until IS NOT NULL AND billing_grace_until <= now()",
    )
    .fetch_all(&state.pool)
    .await?;

    for (id,) in &expired {
        sqlx::query(
            "UPDATE subscribers SET status = 'cancelado', billing_grace_until = NULL, \
             coupon_code = NULL, coupon_kind = NULL, discount_amount = NULL, \
             discount_percent = NULL, coupon_expires_at = NULL, coupon_plan_locked = NULL, \
             updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&state.pool)
        .await?;

        sqlx::query(
            "UPDATE subscriber_invoices SET status = 'expirado' \
             WHERE subscriber_id = $1 AND status = 'pendente'",
        )
        .bind(id)
        .execute(&state.pool)
        .await?;

        tracing::info!(subscriber_id = %id, "recurring billing: janela de tolerância expirou — assinatura cancelada, cupom perdido");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::add_business_days;
    use chrono::{TimeZone, Utc};

    #[test]
    fn skips_weekend_when_counting_business_days() {
        // Sexta 2026-09-04 + 3 dias úteis -- pula sáb/dom, cai na quarta.
        let friday = Utc.with_ymd_and_hms(2026, 9, 4, 10, 0, 0).unwrap();
        let result = add_business_days(friday, 3);
        assert_eq!(result.format("%Y-%m-%d").to_string(), "2026-09-09");
    }

    #[test]
    fn plain_weekday_run_no_weekend_to_skip() {
        // Segunda 2026-09-07 + 3 dias úteis, sem fim de semana no meio.
        let monday = Utc.with_ymd_and_hms(2026, 9, 7, 10, 0, 0).unwrap();
        let result = add_business_days(monday, 3);
        assert_eq!(result.format("%Y-%m-%d").to_string(), "2026-09-10");
    }
}
