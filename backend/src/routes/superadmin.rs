//! Painel do dono da Resolutoo — exige `platform_admins`.

use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSuperadmin;
use crate::coupons;
use crate::error::AppError;
use crate::plans;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct Overview {
    pub lojas_ativas: i64,
    pub lojas_total: i64,
    pub mrr: f64,
    pub custos_mensais: f64,
    pub lucro_estimado: f64,
}

pub async fn overview(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<Overview>, AppError> {
    let (ativas,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM subscribers WHERE status = 'ativo'")
            .fetch_one(&state.pool)
            .await?;
    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM subscribers")
        .fetch_one(&state.pool)
        .await?;
    let (mrr,): (Option<f64>,) = sqlx::query_as(
        "SELECT COALESCE(SUM(COALESCE(valor_mensal, 0)), 0)::float8 FROM subscribers WHERE status = 'ativo'",
    )
    .fetch_one(&state.pool)
    .await?;
    let (custos,): (Option<f64>,) = sqlx::query_as(
        "SELECT COALESCE(SUM(amount_monthly), 0)::float8 FROM platform_costs WHERE active = true",
    )
    .fetch_one(&state.pool)
    .await?;
    let mrr = mrr.unwrap_or(0.0);
    let custos_mensais = custos.unwrap_or(0.0);
    Ok(Json(Overview {
        lojas_ativas: ativas,
        lojas_total: total,
        mrr,
        custos_mensais,
        lucro_estimado: mrr - custos_mensais,
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StoreRow {
    pub id: String,
    pub loja_nome: String,
    pub email: String,
    pub whatsapp: String,
    pub slug: Option<String>,
    pub plan_code: Option<String>,
    pub valor_mensal: Option<f64>,
    pub status: String,
    pub onboarding_status: String,
    pub coupon_code: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_stores(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<Vec<StoreRow>>, AppError> {
    let rows = sqlx::query_as::<_, StoreRow>(
        "SELECT id, loja_nome, email, whatsapp, slug, plan_code, valor_mensal, status, \
         onboarding_status, coupon_code, created_at \
         FROM subscribers ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct ApplyCouponInput {
    pub code: String,
}

pub async fn apply_coupon_to_store(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(id): Path<String>,
    Json(body): Json<ApplyCouponInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, Option<f64>)> =
        sqlx::query_as("SELECT plan_code, valor_mensal FROM subscribers WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;
    let (Some(plan), _) = row.ok_or_else(|| AppError::NotFound("loja não encontrada".to_string()))?
    else {
        return Err(AppError::BadRequest("loja sem plano".to_string()));
    };
    let (after, coupon) = coupons::redeem_on_subscribe(&state.pool, &id, &plan, &body.code).await?;
    sqlx::query("UPDATE subscribers SET valor_mensal = $1, updated_at = now() WHERE id = $2")
        .bind(after)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "code": coupon.code,
        "valor_mensal": after,
    })))
}

pub async fn list_plans_admin(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<Vec<plans::PlanRow>>, AppError> {
    Ok(Json(plans::list_all(&state.pool).await?))
}

#[derive(Debug, Deserialize)]
pub struct CreatePlanInput {
    pub code: String,
    pub name: String,
    pub price_monthly: f64,
    #[serde(default)]
    pub tagline: String,
    #[serde(default = "default_features")]
    pub features: serde_json::Value,
    #[serde(default)]
    pub highlight: bool,
    #[serde(default)]
    pub sort_order: i32,
}
fn default_features() -> serde_json::Value {
    serde_json::json!([])
}

/// Superadmin cadastra planos (não há seed automático de planos).
pub async fn create_plan(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<CreatePlanInput>,
) -> Result<Json<plans::PlanRow>, AppError> {
    let code = body.code.trim().to_lowercase();
    if !matches!(code.as_str(), "essential" | "management" | "premium") {
        return Err(AppError::BadRequest(
            "code deve ser essential, management ou premium".to_string(),
        ));
    }
    if body.name.trim().is_empty() || body.price_monthly <= 0.0 {
        return Err(AppError::BadRequest("name e price_monthly obrigatórios".to_string()));
    }
    sqlx::query(
        "INSERT INTO platform_plans (code, name, price_monthly, tagline, features, highlight, sort_order) \
         VALUES ($1,$2,$3,$4,$5,$6,$7) \
         ON CONFLICT (code) DO UPDATE SET \
           name = EXCLUDED.name, price_monthly = EXCLUDED.price_monthly, tagline = EXCLUDED.tagline, \
           features = EXCLUDED.features, highlight = EXCLUDED.highlight, sort_order = EXCLUDED.sort_order, \
           active = true, updated_at = now()",
    )
    .bind(&code)
    .bind(body.name.trim())
    .bind(body.price_monthly)
    .bind(&body.tagline)
    .bind(&body.features)
    .bind(body.highlight)
    .bind(body.sort_order)
    .execute(&state.pool)
    .await?;

    let row = sqlx::query_as::<_, plans::PlanRow>(
        "SELECT code, name, price_monthly, tagline, features, highlight, active, sort_order \
         FROM platform_plans WHERE code = $1",
    )
    .bind(&code)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct UpdatePlanInput {
    pub name: Option<String>,
    pub price_monthly: Option<f64>,
    pub tagline: Option<String>,
    pub features: Option<serde_json::Value>,
    pub highlight: Option<bool>,
    pub active: Option<bool>,
}

pub async fn update_plan(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(code): Path<String>,
    Json(body): Json<UpdatePlanInput>,
) -> Result<Json<plans::PlanRow>, AppError> {
    sqlx::query(
        "UPDATE platform_plans SET \
         name = COALESCE($1, name), \
         price_monthly = COALESCE($2, price_monthly), \
         tagline = COALESCE($3, tagline), \
         features = COALESCE($4, features), \
         highlight = COALESCE($5, highlight), \
         active = COALESCE($6, active), \
         updated_at = now() \
         WHERE code = $7",
    )
    .bind(&body.name)
    .bind(body.price_monthly)
    .bind(&body.tagline)
    .bind(&body.features)
    .bind(body.highlight)
    .bind(body.active)
    .bind(&code)
    .execute(&state.pool)
    .await?;

    let row = sqlx::query_as::<_, plans::PlanRow>(
        "SELECT code, name, price_monthly, tagline, features, highlight, active, sort_order \
         FROM platform_plans WHERE code = $1",
    )
    .bind(&code)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("plano não encontrado".to_string()))?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct UpsertContentInput {
    pub key: String,
    pub value: String,
}

pub async fn upsert_content(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<UpsertContentInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.key.trim().is_empty() {
        return Err(AppError::BadRequest("key vazia".to_string()));
    }
    sqlx::query(
        "INSERT INTO platform_content (key, value, updated_at) VALUES ($1, $2, now()) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(body.key.trim())
    .bind(&body.value)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true, "key": body.key, "value": body.value })))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CostRow {
    pub id: String,
    pub label: String,
    pub amount_monthly: f64,
    pub notes: String,
    pub active: bool,
}

pub async fn list_costs(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<Vec<CostRow>>, AppError> {
    let rows = sqlx::query_as::<_, CostRow>(
        "SELECT id, label, amount_monthly, notes, active FROM platform_costs ORDER BY label",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CostInput {
    pub label: String,
    pub amount_monthly: f64,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

pub async fn create_cost(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<CostInput>,
) -> Result<Json<CostRow>, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO platform_costs (id, label, amount_monthly, notes, active) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&id)
    .bind(body.label.trim())
    .bind(body.amount_monthly)
    .bind(body.notes.unwrap_or_default())
    .bind(body.active.unwrap_or(true))
    .execute(&state.pool)
    .await?;
    Ok(Json(CostRow {
        id,
        label: body.label,
        amount_monthly: body.amount_monthly,
        notes: String::new(),
        active: true,
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CouponAdminRow {
    pub id: String,
    pub code: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub duration_kind: String,
    pub duration_days: Option<i32>,
    pub max_redemptions: Option<i32>,
    pub redemptions: i32,
    pub active: bool,
    pub notes: String,
}

pub async fn list_coupons(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<Vec<CouponAdminRow>>, AppError> {
    let rows = sqlx::query_as::<_, CouponAdminRow>(
        "SELECT id, code, discount_type, discount_value, duration_kind, duration_days, \
         max_redemptions, redemptions, active, notes FROM platform_coupons ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateCouponInput {
    pub code: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub duration_kind: String,
    pub duration_days: Option<i32>,
    pub max_redemptions: Option<i32>,
    pub notes: Option<String>,
}

pub async fn create_coupon(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<CreateCouponInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !matches!(body.discount_type.as_str(), "fixed" | "percent") {
        return Err(AppError::BadRequest("discount_type inválido".to_string()));
    }
    if !matches!(body.duration_kind.as_str(), "timed" | "lifetime_current_plan") {
        return Err(AppError::BadRequest("duration_kind inválido".to_string()));
    }
    let code = body.code.trim().to_uppercase();
    if code.is_empty() {
        return Err(AppError::BadRequest("código vazio".to_string()));
    }

    // Vitalício: desconto enquanto o assinante permanecer no plano do resgate.
    // Sem janela (duration_days) e sem teto de resgates (max_redemptions).
    // Timed: exige dias + máximo de usos.
    let (duration_days, max_redemptions) = if body.duration_kind == "lifetime_current_plan" {
        (None, None)
    } else {
        let days = body.duration_days.filter(|d| *d > 0).ok_or_else(|| {
            AppError::BadRequest("cupom por tempo limitado exige duration_days > 0".to_string())
        })?;
        let max = body.max_redemptions.filter(|m| *m > 0).ok_or_else(|| {
            AppError::BadRequest("cupom por tempo limitado exige max_redemptions > 0".to_string())
        })?;
        (Some(days), Some(max))
    };

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO platform_coupons \
         (id, code, discount_type, discount_value, duration_kind, duration_days, max_redemptions, notes) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(&id)
    .bind(&code)
    .bind(&body.discount_type)
    .bind(body.discount_value)
    .bind(&body.duration_kind)
    .bind(duration_days)
    .bind(max_redemptions)
    .bind(body.notes.unwrap_or_default())
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::BadRequest(format!("não foi possível criar cupom: {e}")))?;
    Ok(Json(serde_json::json!({
        "id": id,
        "code": code,
        "duration_kind": body.duration_kind,
        "duration_days": duration_days,
        "max_redemptions": max_redemptions,
    })))
}

/// Quem sou eu no painel — front usa pra redirecionar login.
pub async fn whoami(
    State(state): State<AppState>,
    AuthSuperadmin(claims): AuthSuperadmin,
) -> Result<Json<serde_json::Value>, AppError> {
    let email: Option<(String,)> =
        sqlx::query_as("SELECT email FROM platform_admins WHERE user_id = $1")
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    Ok(Json(serde_json::json!({
        "superadmin": true,
        "user_id": claims.sub,
        "email": email.map(|e| e.0),
    })))
}
