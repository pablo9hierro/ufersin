//! Cupons de assinatura da plataforma (não confundir com cupons CRM da loja).

use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::error::AppError;
use crate::plans;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CouponRow {
    pub id: String,
    pub code: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub duration_kind: String,
    pub duration_days: Option<i32>,
    pub max_redemptions: Option<i32>,
    pub redemptions: i32,
    pub active: bool,
}

#[derive(Debug, Serialize)]
pub struct CouponPreview {
    pub code: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub duration_kind: String,
    pub duration_days: Option<i32>,
    pub monthly_before: f64,
    pub monthly_after: f64,
}

pub fn apply_discount(monthly: f64, discount_type: &str, discount_value: f64) -> f64 {
    let after = match discount_type {
        "percent" => monthly * (1.0 - discount_value / 100.0),
        "fixed" => (monthly - discount_value).max(0.0),
        _ => monthly,
    };
    (after * 100.0).round() / 100.0
}

pub async fn find_active(pool: &PgPool, code: &str) -> Result<CouponRow, AppError> {
    let normalized = code.trim().to_uppercase();
    if normalized.is_empty() {
        return Err(AppError::BadRequest("cupom vazio".to_string()));
    }
    let row: Option<CouponRow> = sqlx::query_as(
        "SELECT id, code, discount_type, discount_value, duration_kind, duration_days, \
                max_redemptions, redemptions, active \
         FROM platform_coupons WHERE upper(code) = $1",
    )
    .bind(&normalized)
    .fetch_optional(pool)
    .await?;
    let row = row.ok_or_else(|| AppError::BadRequest("cupom inválido".to_string()))?;
    if !row.active {
        return Err(AppError::BadRequest("cupom inativo".to_string()));
    }
    if let Some(max) = row.max_redemptions {
        if row.redemptions >= max {
            return Err(AppError::BadRequest("cupom esgotado".to_string()));
        }
    }
    Ok(row)
}

pub async fn preview(pool: &PgPool, code: &str, plan_code: &str) -> Result<CouponPreview, AppError> {
    let monthly = plans::monthly_price(pool, plan_code).await?;
    let coupon = find_active(pool, code).await?;
    let after = apply_discount(monthly, &coupon.discount_type, coupon.discount_value);
    Ok(CouponPreview {
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        duration_kind: coupon.duration_kind,
        duration_days: coupon.duration_days,
        monthly_before: monthly,
        monthly_after: after,
    })
}

/// Aplica cupom no subscriber e registra redemption. Retorna monthly com desconto.
pub async fn redeem_on_subscribe(
    pool: &PgPool,
    subscriber_id: &str,
    plan_code: &str,
    code: &str,
) -> Result<(f64, CouponRow), AppError> {
    let monthly = plans::monthly_price(pool, plan_code).await?;
    let coupon = find_active(pool, code).await?;
    let after = apply_discount(monthly, &coupon.discount_type, coupon.discount_value);

    let expires = match coupon.duration_kind.as_str() {
        "timed" => {
            let days = coupon.duration_days.unwrap_or(30);
            Some(Utc::now() + Duration::days(i64::from(days)))
        }
        _ => None,
    };

    let (discount_amount, discount_percent) = if coupon.discount_type == "fixed" {
        (Some(coupon.discount_value), None)
    } else {
        (None, Some(coupon.discount_value))
    };

    let plan_locked = if coupon.duration_kind == "lifetime_current_plan" {
        Some(plan_code.to_string())
    } else {
        None
    };

    sqlx::query(
        "UPDATE subscribers SET coupon_code = $1, coupon_kind = $2, discount_amount = $3, \
         discount_percent = $4, coupon_expires_at = $5, coupon_plan_locked = $6, updated_at = now() \
         WHERE id = $7",
    )
    .bind(&coupon.code)
    .bind(&coupon.duration_kind)
    .bind(discount_amount)
    .bind(discount_percent)
    .bind(expires)
    .bind(&plan_locked)
    .bind(subscriber_id)
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO platform_coupon_redemptions (coupon_id, subscriber_id, plan_code_at) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (coupon_id, subscriber_id) DO UPDATE SET revoked = false, revoke_reason = NULL, \
         plan_code_at = EXCLUDED.plan_code_at, created_at = now()",
    )
    .bind(&coupon.id)
    .bind(subscriber_id)
    .bind(plan_code)
    .execute(pool)
    .await?;

    sqlx::query("UPDATE platform_coupons SET redemptions = redemptions + 1, updated_at = now() WHERE id = $1")
        .bind(&coupon.id)
        .execute(pool)
        .await?;

    Ok((after, coupon))
}

/// Remove desconto do subscriber (downgrade timed / upgrade lifetime).
pub async fn revoke_subscriber_coupon(
    pool: &PgPool,
    subscriber_id: &str,
    reason: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE platform_coupon_redemptions SET revoked = true, revoke_reason = $2 \
         WHERE subscriber_id = $1 AND revoked = false",
    )
    .bind(subscriber_id)
    .bind(reason)
    .execute(pool)
    .await?;

    sqlx::query(
        "UPDATE subscribers SET coupon_code = NULL, coupon_kind = NULL, discount_amount = NULL, \
         discount_percent = NULL, coupon_expires_at = NULL, coupon_plan_locked = NULL, updated_at = now() \
         WHERE id = $1",
    )
    .bind(subscriber_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Preço mensal efetivo considerando cupom ainda válido.
pub async fn effective_monthly(
    pool: &PgPool,
    subscriber_id: &str,
    plan_code: &str,
    list_monthly: f64,
) -> Result<f64, AppError> {
    let row: Option<(Option<String>, Option<String>, Option<f64>, Option<f64>, Option<chrono::DateTime<Utc>>, Option<String>)> =
        sqlx::query_as(
            "SELECT coupon_code, coupon_kind, discount_amount, discount_percent, coupon_expires_at, coupon_plan_locked \
             FROM subscribers WHERE id = $1",
        )
        .bind(subscriber_id)
        .fetch_optional(pool)
        .await?;

    let Some((Some(_code), kind, amount, percent, expires, plan_locked)) = row else {
        return Ok(list_monthly);
    };

    if let Some(exp) = expires {
        if exp < Utc::now() {
            revoke_subscriber_coupon(pool, subscriber_id, "expired").await?;
            return Ok(list_monthly);
        }
    }

    if kind.as_deref() == Some("lifetime_current_plan") {
        if let Some(locked) = plan_locked {
            if locked != plan_code {
                return Ok(list_monthly);
            }
        }
    }

    if let Some(p) = percent {
        return Ok(apply_discount(list_monthly, "percent", p));
    }
    if let Some(a) = amount {
        return Ok(apply_discount(list_monthly, "fixed", a));
    }
    Ok(list_monthly)
}
