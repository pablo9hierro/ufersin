//! Pagamento fixo periódico (diária/semanal/quinzenal/mensal) de motoboy e
//! vendedor. Sem cron: "faltam 2 dias" é computado na leitura a partir de
//! `last_payroll_reset_at + intervalo da frequência`, nunca armazenado.
//! Handshake de confirmação: admin registra que pagou (payroll_payments,
//! confirmed_by_employee=false) -> funcionário só CONFIRMA (nunca recusa) ->
//! confirmação é o que reseta `last_payroll_reset_at` (zera o ciclo) e
//! encerra o alerta.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::{AdminUser, StaffUser};
use crate::error::AppError;
use crate::state::AppState;
use crate::tenant;

// ---------- Parte 1: config global (por tenant, não mais por motoboy) ----------
//
// Substitui de vez o modelo antigo (comissão 100% sempre ativa + fixo
// opcional somando em cima): agora é XOR, uma única config por loja.
// `payment_model = 'comissao'` mantém o comportamento anterior (sem
// mudança nenhuma aqui -- comissão por entrega nunca foi calculada neste
// backend, ver deviations no relatório final); `'fixo'` é o que este
// arquivo passa a governar: alerta de vencimento e financeiro usam ESTA
// config pra todo motoboy ativo da loja, não mais o campo por-motoboy.

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MotoboyPayrollConfig {
    pub payment_model: String,
    pub payment_frequency: Option<String>,
    pub payment_fixed_value: Option<f64>,
    pub usa_maquininha: bool,
    pub vendedor_usa_maquininha: bool,
}

impl Default for MotoboyPayrollConfig {
    fn default() -> Self {
        MotoboyPayrollConfig {
            payment_model: "comissao".to_string(),
            payment_frequency: None,
            payment_fixed_value: None,
            usa_maquininha: false,
            vendedor_usa_maquininha: false,
        }
    }
}

pub async fn load_motoboy_payroll_config(pool: &sqlx::PgPool, tenant_id: &str) -> Result<MotoboyPayrollConfig, AppError> {
    let row: Option<MotoboyPayrollConfig> = sqlx::query_as(
        "SELECT payment_model, payment_frequency, payment_fixed_value, usa_maquininha, vendedor_usa_maquininha \
         FROM motoboy_payroll_config WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_default())
}

pub async fn get_motoboy_payroll_config(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<MotoboyPayrollConfig>, AppError> {
    Ok(Json(load_motoboy_payroll_config(&state.pool, &claims.tenant_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct UpdateMotoboyPayrollConfigInput {
    pub payment_model: String,
    #[serde(default)]
    pub payment_frequency: Option<String>,
    #[serde(default)]
    pub payment_fixed_value: Option<f64>,
    #[serde(default)]
    pub usa_maquininha: bool,
    #[serde(default)]
    pub vendedor_usa_maquininha: bool,
}

pub async fn update_motoboy_payroll_config(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<UpdateMotoboyPayrollConfigInput>,
) -> Result<Json<MotoboyPayrollConfig>, AppError> {
    if input.payment_model != "comissao" && input.payment_model != "fixo" {
        return Err(AppError::BadRequest("payment_model must be comissao or fixo".to_string()));
    }
    // XOR de verdade -- fixo sem frequência/valor não faz sentido (nada
    // pra alertar/acumular); comissão simplesmente ignora os dois campos.
    let (frequency, fixed_value) = if input.payment_model == "fixo" {
        let freq = input.payment_frequency.filter(|f| !f.is_empty()).ok_or_else(|| {
            AppError::BadRequest("payment_frequency is required when payment_model is fixo".to_string())
        })?;
        let value = input.payment_fixed_value.filter(|v| *v > 0.0).ok_or_else(|| {
            AppError::BadRequest("payment_fixed_value must be greater than zero when payment_model is fixo".to_string())
        })?;
        (Some(freq), Some(value))
    } else {
        (None, None)
    };

    sqlx::query(
        "INSERT INTO motoboy_payroll_config (tenant_id, payment_model, payment_frequency, payment_fixed_value, usa_maquininha, vendedor_usa_maquininha) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
           payment_model = EXCLUDED.payment_model, payment_frequency = EXCLUDED.payment_frequency, \
           payment_fixed_value = EXCLUDED.payment_fixed_value, usa_maquininha = EXCLUDED.usa_maquininha, \
           vendedor_usa_maquininha = EXCLUDED.vendedor_usa_maquininha, \
           updated_at = now()",
    )
    .bind(&claims.tenant_id)
    .bind(&input.payment_model)
    .bind(&frequency)
    .bind(fixed_value)
    .bind(input.usa_maquininha)
    .bind(input.vendedor_usa_maquininha)
    .execute(&state.pool)
    .await?;

    Ok(Json(MotoboyPayrollConfig {
        payment_model: input.payment_model,
        payment_frequency: frequency,
        payment_fixed_value: fixed_value,
        usa_maquininha: input.usa_maquininha,
        vendedor_usa_maquininha: input.vendedor_usa_maquininha,
    }))
}

// ---------- Parte 3: dias trabalhados ----------

/// Chamado quando uma entrega é marcada "em rota" (primeira atividade do
/// motoboy no pedido) -- `ON CONFLICT DO NOTHING` garante que só a
/// primeira do dia conta, sem precisar checar antes.
pub async fn record_work_day(pool: &sqlx::PgPool, tenant_id: &str, motoboy_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO motoboy_work_days (id, tenant_id, motoboy_id, work_date) \
         VALUES ($1, $2, $3, CURRENT_DATE) ON CONFLICT (motoboy_id, work_date) DO NOTHING",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(tenant_id)
    .bind(motoboy_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WorkDayDto {
    pub work_date: chrono::NaiveDate,
}

async fn list_work_days(pool: &sqlx::PgPool, tenant_id: &str, motoboy_id: &str) -> Result<Vec<WorkDayDto>, AppError> {
    let rows: Vec<WorkDayDto> = sqlx::query_as(
        "SELECT work_date FROM motoboy_work_days WHERE tenant_id = $1 AND motoboy_id = $2 ORDER BY work_date DESC LIMIT 62",
    )
    .bind(tenant_id)
    .bind(motoboy_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// GET /api/motoboy/work-days -- motoboy vê os próprios dias trabalhados.
pub async fn my_work_days(
    State(state): State<AppState>,
    crate::auth::MotoboyUser(claims): crate::auth::MotoboyUser,
) -> Result<Json<Vec<WorkDayDto>>, AppError> {
    Ok(Json(list_work_days(&state.pool, &claims.tenant_id, &claims.sub).await?))
}

/// GET /api/admin/motoboy/{id}/work-days -- admin vê de qualquer motoboy.
pub async fn admin_motoboy_work_days(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(motoboy_id): Path<String>,
) -> Result<Json<Vec<WorkDayDto>>, AppError> {
    Ok(Json(list_work_days(&state.pool, &claims.tenant_id, &motoboy_id).await?))
}

fn frequency_days(freq: &str) -> i32 {
    match freq {
        "diaria" => 1,
        "semanal" => 7,
        "quinzenal" => 14,
        "mensal" => 30,
        _ => 30,
    }
}

#[derive(Debug, Serialize)]
pub struct PayrollAlert {
    pub employee_role: String,
    pub employee_id: String,
    pub name: String,
    pub amount: f64,
    pub due_at: String,
    /// Já foi informado como pago pelo admin, só falta o funcionário confirmar.
    pub payment_id: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct EmployeeRow {
    id: String,
    name: String,
    payment_frequency: Option<String>,
    payment_fixed_value: Option<f64>,
    last_payroll_reset_at: chrono::DateTime<chrono::Utc>,
    active: i64,
}

/// Motoboy: freq/valor vêm da config GLOBAL (Parte 1) e valem pra TODO
/// motoboy ativo da loja igualmente -- só entra na lista se
/// `payment_model = 'fixo'`. Vendedor: inalterado, cada um com seu próprio
/// `payment_frequency`/`payment_fixed_value` (não fazia parte do pedido).
async fn due_alerts_for_role(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    role: &str,
) -> Result<Vec<PayrollAlert>, AppError> {
    let rows: Vec<EmployeeRow> = if role == "motoboy" {
        let cfg = load_motoboy_payroll_config(pool, tenant_id).await?;
        if cfg.payment_model != "fixo" {
            return Ok(Vec::new());
        }
        let rows: Vec<(String, String, chrono::DateTime<chrono::Utc>, i64)> = sqlx::query_as(
            "SELECT id, name, last_payroll_reset_at, active FROM motoboys WHERE tenant_id = $1 AND active = 1",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?;
        rows.into_iter()
            .map(|(id, name, last_payroll_reset_at, active)| EmployeeRow {
                id,
                name,
                payment_frequency: cfg.payment_frequency.clone(),
                payment_fixed_value: cfg.payment_fixed_value,
                last_payroll_reset_at,
                active,
            })
            .collect()
    } else {
        sqlx::query_as(
            "SELECT id, name, payment_frequency, payment_fixed_value, last_payroll_reset_at, active \
             FROM vendedores WHERE tenant_id = $1 AND active = 1 \
             AND payment_frequency IS NOT NULL AND payment_fixed_value IS NOT NULL",
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?
    };

    let mut alerts = Vec::new();
    for row in rows {
        let freq = row.payment_frequency.as_deref().unwrap_or("mensal");
        let due_at = row.last_payroll_reset_at + chrono::Duration::days(frequency_days(freq) as i64);
        let alert_from = due_at - chrono::Duration::days(2);
        if chrono::Utc::now() < alert_from {
            continue;
        }
        // Já tem pagamento reportado (aguardando confirmação do funcionário)?
        let pending: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM payroll_payments WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3 \
             AND confirmed_by_employee = false ORDER BY created_at DESC LIMIT 1",
        )
        .bind(tenant_id)
        .bind(role)
        .bind(&row.id)
        .fetch_optional(pool)
        .await?;

        alerts.push(PayrollAlert {
            employee_role: role.to_string(),
            employee_id: row.id,
            name: row.name,
            amount: row.payment_fixed_value.unwrap_or(0.0),
            due_at: due_at.to_rfc3339(),
            payment_id: pending.map(|(id,)| id),
        });
    }
    Ok(alerts)
}

/// Autoatendimento: "meu próximo pagamento" -- diferente de `my_pending`
/// (que só mostra pagamento já REPORTADO pelo admin), isso mostra o
/// próximo vencimento mesmo antes de qualquer report, pra
/// MotoboyFinanceiro.tsx exibir "Próximo pagamento: RS X em DD/MM" sem
/// esperar o sino. `None` quando o modelo é comissão (motoboy) ou o
/// vendedor não tem fixo configurado.
pub async fn my_next_payment(
    State(state): State<AppState>,
    StaffUser(claims): StaffUser,
) -> Result<Json<Option<PayrollAlertPreview>>, AppError> {
    let (frequency, fixed_value, last_reset): (Option<String>, Option<f64>, chrono::DateTime<chrono::Utc>) =
        if claims.role == "motoboy" {
            let cfg = load_motoboy_payroll_config(&state.pool, &claims.tenant_id).await?;
            if cfg.payment_model != "fixo" {
                return Ok(Json(None));
            }
            let last_reset: chrono::DateTime<chrono::Utc> =
                sqlx::query_scalar("SELECT last_payroll_reset_at FROM motoboys WHERE tenant_id = $1 AND id = $2")
                    .bind(&claims.tenant_id)
                    .bind(&claims.sub)
                    .fetch_one(&state.pool)
                    .await?;
            (cfg.payment_frequency, cfg.payment_fixed_value, last_reset)
        } else {
            let row: Option<(Option<String>, Option<f64>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
                "SELECT payment_frequency, payment_fixed_value, last_payroll_reset_at FROM vendedores \
                 WHERE tenant_id = $1 AND id = $2",
            )
            .bind(&claims.tenant_id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
            let Some((freq, value, last_reset)) = row else { return Ok(Json(None)) };
            (freq, value, last_reset)
        };

    let (Some(frequency), Some(amount)) = (frequency, fixed_value) else {
        return Ok(Json(None));
    };
    let due_at = last_reset + chrono::Duration::days(frequency_days(&frequency) as i64);
    Ok(Json(Some(PayrollAlertPreview { frequency, amount, due_at: due_at.to_rfc3339() })))
}

#[derive(Debug, Serialize)]
pub struct PayrollAlertPreview {
    pub frequency: String,
    pub amount: f64,
    pub due_at: String,
}

/// Alertas pro admin: todo funcionário (motoboy + vendedor) com pagamento
/// fixo a vencer em até 2 dias (ou já vencido), incluindo os que já foram
/// reportados como pagos mas ainda aguardam confirmação.
pub async fn admin_alerts(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<PayrollAlert>>, AppError> {
    let mut alerts = due_alerts_for_role(&state.pool, &claims.tenant_id, "motoboy").await?;
    alerts.extend(due_alerts_for_role(&state.pool, &claims.tenant_id, "vendedor").await?);
    Ok(Json(alerts))
}

#[derive(Debug, Deserialize)]
pub struct ReportPaymentInput {
    pub employee_role: String,
    pub employee_id: String,
    pub payment_method: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PayrollPaymentDto {
    pub id: String,
    pub employee_role: String,
    pub employee_id: String,
    pub amount: f64,
    pub payment_method: String,
    pub confirmed_by_employee: bool,
    #[serde(with = "time_opt")]
    pub confirmed_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(with = "time_fmt")]
    pub created_at: chrono::DateTime<chrono::Utc>,
}

mod time_fmt {
    use serde::Serializer;
    pub fn serialize<S: Serializer>(v: &chrono::DateTime<chrono::Utc>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_rfc3339())
    }
}
mod time_opt {
    use serde::Serializer;
    pub fn serialize<S: Serializer>(v: &Option<chrono::DateTime<chrono::Utc>>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(v) => s.serialize_str(&v.to_rfc3339()),
            None => s.serialize_none(),
        }
    }
}

/// Admin registra que pagou o valor fixo acumulado -- não zera nada ainda
/// (só o funcionário confirmando é que zera, ver `confirm_payment`).
pub async fn report_payment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<ReportPaymentInput>,
) -> Result<Json<PayrollPaymentDto>, AppError> {
    if input.employee_role != "motoboy" && input.employee_role != "vendedor" {
        return Err(AppError::BadRequest("employee_role must be motoboy or vendedor".to_string()));
    }
    let table = if input.employee_role == "motoboy" { "motoboys" } else { "vendedores" };
    let row: Option<(f64,)> = sqlx::query_as(&format!(
        "SELECT COALESCE(payment_fixed_value, 0) FROM {table} WHERE tenant_id = $1 AND id = $2"
    ))
    .bind(&claims.tenant_id)
    .bind(&input.employee_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((amount,)) = row else {
        return Err(AppError::NotFound("employee not found".to_string()));
    };

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO payroll_payments (id, tenant_id, employee_role, employee_id, amount, payment_method) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.employee_role)
    .bind(&input.employee_id)
    .bind(amount)
    .bind(&input.payment_method)
    .execute(&state.pool)
    .await?;

    let dto: PayrollPaymentDto = sqlx::query_as(
        "SELECT id, employee_role, employee_id, amount, payment_method, confirmed_by_employee, confirmed_at, created_at \
         FROM payroll_payments WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(dto))
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub employee_role: Option<String>,
    pub employee_id: Option<String>,
}

pub async fn admin_history(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Vec<PayrollPaymentDto>>, AppError> {
    let rows: Vec<PayrollPaymentDto> = match (q.employee_role, q.employee_id) {
        (Some(role), Some(id)) => {
            sqlx::query_as(
                "SELECT id, employee_role, employee_id, amount, payment_method, confirmed_by_employee, confirmed_at, created_at \
                 FROM payroll_payments WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3 \
                 ORDER BY created_at DESC LIMIT 100",
            )
            .bind(&claims.tenant_id)
            .bind(role)
            .bind(id)
            .fetch_all(&state.pool)
            .await?
        }
        _ => {
            sqlx::query_as(
                "SELECT id, employee_role, employee_id, amount, payment_method, confirmed_by_employee, confirmed_at, created_at \
                 FROM payroll_payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
            )
            .bind(&claims.tenant_id)
            .fetch_all(&state.pool)
            .await?
        }
    };
    Ok(Json(rows))
}

/// Autoatendimento (motoboy/vendedor): meu próprio alerta de vencimento (se
/// houver) + pagamentos que o admin já reportou e ainda aguardam minha
/// confirmação.
pub async fn my_pending(
    State(state): State<AppState>,
    StaffUser(claims): StaffUser,
) -> Result<Json<Vec<PayrollPaymentDto>>, AppError> {
    let rows: Vec<PayrollPaymentDto> = sqlx::query_as(
        "SELECT id, employee_role, employee_id, amount, payment_method, confirmed_by_employee, confirmed_at, created_at \
         FROM payroll_payments WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3 \
         AND confirmed_by_employee = false ORDER BY created_at DESC",
    )
    .bind(&claims.tenant_id)
    .bind(&claims.role)
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// Só confirma (nunca recusa) -- é isso que zera o ciclo de pagamento do
/// funcionário (`last_payroll_reset_at = now()`), pra próxima cobrança
/// contar a partir de hoje.
pub async fn confirm_payment(
    State(state): State<AppState>,
    StaffUser(claims): StaffUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query(
        "UPDATE payroll_payments SET confirmed_by_employee = true, confirmed_at = now() \
         WHERE tenant_id = $1 AND id = $2 AND employee_role = $3 AND employee_id = $4 AND confirmed_by_employee = false",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&claims.role)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("payment not found".to_string()));
    }

    let table = if claims.role == "motoboy" { "motoboys" } else { "vendedores" };
    sqlx::query(&format!(
        "UPDATE {table} SET last_payroll_reset_at = now() WHERE tenant_id = $1 AND id = $2"
    ))
    .bind(&claims.tenant_id)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
