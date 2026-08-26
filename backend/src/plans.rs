//! Preços e metadados dos planos Resolutoo — sempre do banco (`platform_plans`).

use serde::Serialize;
use sqlx::PgPool;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PlanRow {
    pub code: String,
    pub name: String,
    pub price_monthly: f64,
    pub tagline: String,
    pub features: serde_json::Value,
    pub highlight: bool,
    pub active: bool,
    pub sort_order: i32,
    /// Ramo do plano: 'ecommerce' ou 'eletronicos' (ver migration 0022).
    /// É ele que decide qual vertical o tenant recebe ao assinar -- o
    /// cliente não escolhe mais isso solto no onboarding.
    pub vertical: String,
}

const PLAN_COLUMNS: &str =
    "code, name, price_monthly, tagline, features, highlight, active, sort_order, vertical";

pub async fn list_active(pool: &PgPool) -> Result<Vec<PlanRow>, AppError> {
    let rows = sqlx::query_as::<_, PlanRow>(&format!(
        "SELECT {PLAN_COLUMNS} FROM platform_plans WHERE active = true ORDER BY sort_order, code"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_all(pool: &PgPool) -> Result<Vec<PlanRow>, AppError> {
    let rows = sqlx::query_as::<_, PlanRow>(&format!(
        "SELECT {PLAN_COLUMNS} FROM platform_plans ORDER BY sort_order, code"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Ramo do plano que está sendo assinado -- fonte da verdade pro vertical
/// do tenant. Plano inexistente/inativo vira erro (mesma regra de
/// `monthly_price`), nunca um default silencioso: assinar um plano que não
/// existe não pode acabar criando uma loja de ecommerce por engano.
pub async fn vertical_for(pool: &PgPool, code: &str) -> Result<String, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT vertical FROM platform_plans WHERE code = $1 AND active = true")
            .bind(code)
            .fetch_optional(pool)
            .await?;
    row.map(|r| r.0)
        .ok_or_else(|| AppError::BadRequest("plano inválido ou inativo".to_string()))
}

pub async fn monthly_price(pool: &PgPool, code: &str) -> Result<f64, AppError> {
    let row: Option<(f64,)> = sqlx::query_as(
        "SELECT price_monthly FROM platform_plans WHERE code = $1 AND active = true",
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;
    row.map(|r| r.0)
        .ok_or_else(|| AppError::BadRequest("plano inválido ou inativo".to_string()))
}

pub fn plan_rank(code: &str) -> i32 {
    match code {
        "essential" => 1,
        "management" => 2,
        "premium" => 3,
        _ => 0,
    }
}

pub fn is_upgrade(from: &str, to: &str) -> bool {
    plan_rank(to) > plan_rank(from)
}

pub fn is_downgrade(from: &str, to: &str) -> bool {
    plan_rank(to) < plan_rank(from)
}
