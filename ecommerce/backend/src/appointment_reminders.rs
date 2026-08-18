//! Worker de disparo por atraso em agendamento.
//!
//! Primeiro processo periódico do backend — todo o resto aqui é
//! request/response ou `tokio::spawn` one-shot dentro de um handler. Roda
//! um tick por minuto varrendo agendamentos que passaram do horário
//! marcado + a tolerância configurada pelo lojista, e manda no WhatsApp do
//! cliente a mensagem do template `agendamento_atraso` perguntando se ele
//! está a caminho ou quer remarcar.
//!
//! A varredura é cross-tenant de propósito (um worker só pra todas as
//! lojas), então usa o pool direto em vez de `tenant::tenant_tx` — mesmo
//! caminho que `resolve_tenant_id` no webhook da Evolution já usa. O
//! `tenant_id` volta em cada linha e é ele que decide de qual instância do
//! WhatsApp a mensagem sai, então uma loja nunca manda pela instância de
//! outra.

use std::time::Duration;

use crate::state::AppState;

const TICK: Duration = Duration::from_secs(60);
pub const LATE_TEMPLATE_KEY: &str = "agendamento_atraso";

/// Texto padrão do disparo — usado quando o lojista ainda não editou o
/// template (linha ausente na tabela). Mantido em sincronia com o valor
/// mostrado como placeholder em /admin/template.
pub const DEFAULT_LATE_TEMPLATE: &str =
    "Oi {cliente}! Vi que seu horário na {loja} era {data} às {hora} ({motivo}) e você ainda não chegou. \
Está a caminho ou prefere remarcar?";

struct LateAppointment {
    id: String,
    tenant_id: String,
    customer_phone: String,
    customer_name: Option<String>,
    scheduled_at: chrono::DateTime<chrono::Utc>,
    reason: String,
    body: String,
    store_name: String,
    whatsapp_instance: String,
}

/// Sobe o loop em background. Nunca derruba o servidor: qualquer erro de um
/// tick é logado e o próximo tick tenta de novo.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        // O primeiro tick de um `interval` dispara imediatamente; pular
        // evita uma varredura no exato instante do boot, quando o pool
        // ainda está esquentando e as migrations podem não ter terminado.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(e) = run_tick(&state).await {
                tracing::warn!("appointment late-reminder tick failed: {e:?}");
            }
        }
    });
}

async fn run_tick(state: &AppState) -> anyhow::Result<()> {
    // Só dispara pra loja que ATIVOU o template (enabled = true) — sem
    // linha na tabela, ou com enabled = false, nenhuma mensagem sai. O
    // JOIN é o que garante isso: não existe fallback "manda mesmo assim".
    let rows: Vec<(String, String, String, Option<String>, chrono::DateTime<chrono::Utc>, String, String, String, String)> =
        sqlx::query_as(
            "SELECT a.id, a.tenant_id, a.customer_phone, a.customer_name, a.scheduled_at, a.reason, \
                    t.body, COALESCE(te.name, ''), COALESCE(te.whatsapp_instance, '') \
             FROM service_appointments a \
             JOIN message_templates t \
               ON t.tenant_id = a.tenant_id AND t.template_key = $1 AND t.enabled = true \
             JOIN tenants te ON te.id = a.tenant_id \
             WHERE a.status = 'agendado' \
               AND a.late_notified_at IS NULL \
               AND now() >= a.scheduled_at + (t.trigger_delay_minutes || ' minutes')::interval \
             LIMIT 200",
        )
        .bind(LATE_TEMPLATE_KEY)
        .fetch_all(&state.pool)
        .await?;

    for (id, tenant_id, customer_phone, customer_name, scheduled_at, reason, body, store_name, whatsapp_instance) in rows {
        let appointment = LateAppointment {
            id,
            tenant_id,
            customer_phone,
            customer_name,
            scheduled_at,
            reason,
            body,
            store_name,
            whatsapp_instance,
        };
        notify_one(state, appointment).await;
    }
    Ok(())
}

async fn notify_one(state: &AppState, a: LateAppointment) {
    // Marca ANTES de enviar. `whatsapp::notify` é fire-and-forget (não dá
    // pra saber aqui se entregou), então marcar depois abriria janela pro
    // próximo tick reenviar a mesma mensagem. Preferimos o risco de um
    // aviso perdido ao de mandar em loop no WhatsApp do cliente.
    let marked = sqlx::query(
        "UPDATE service_appointments SET late_notified_at = now() \
         WHERE id = $1 AND late_notified_at IS NULL",
    )
    .bind(&a.id)
    .execute(&state.pool)
    .await;
    match marked {
        // 0 linhas = outro tick já pegou esse agendamento; não manda de novo.
        Ok(r) if r.rows_affected() == 0 => return,
        Err(e) => {
            tracing::warn!("late-reminder: falha ao marcar agendamento {}: {e:?}", a.id);
            return;
        }
        Ok(_) => {}
    }

    if a.whatsapp_instance.is_empty() {
        tracing::info!("late-reminder: tenant {} sem instância de WhatsApp, pulando", a.tenant_id);
        return;
    }

    let text = render(&a);
    crate::whatsapp::notify(state, &a.whatsapp_instance, &a.customer_phone, &text);
    tracing::info!("late-reminder: disparado pro agendamento {} (tenant {})", a.id, a.tenant_id);
}

/// Substitui os placeholders do template pelos dados reais do agendamento.
/// Fuso fixo -03:00 (Brasília, sem horário de verão desde 2019) — mesma
/// convenção da validação de horário em routes/public.rs.
fn render(a: &LateAppointment) -> String {
    let brasilia = chrono::FixedOffset::west_opt(3 * 3600).expect("offset válido");
    let local = a.scheduled_at.with_timezone(&brasilia);
    a.body
        .replace("{cliente}", a.customer_name.as_deref().unwrap_or("tudo bem"))
        .replace("{loja}", &a.store_name)
        .replace("{data}", &local.format("%d/%m").to_string())
        .replace("{hora}", &local.format("%H:%M").to_string())
        .replace("{motivo}", if a.reason.is_empty() { "seu atendimento" } else { &a.reason })
}
