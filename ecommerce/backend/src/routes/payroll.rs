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

async fn due_alerts_for_role(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    role: &str,
) -> Result<Vec<PayrollAlert>, AppError> {
    let table = if role == "motoboy" { "motoboys" } else { "vendedores" };
    let rows: Vec<EmployeeRow> = sqlx::query_as(&format!(
        "SELECT id, name, payment_frequency, payment_fixed_value, last_payroll_reset_at, active \
         FROM {table} WHERE tenant_id = $1 AND active = 1 \
         AND payment_frequency IS NOT NULL AND payment_fixed_value IS NOT NULL"
    ))
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;

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
