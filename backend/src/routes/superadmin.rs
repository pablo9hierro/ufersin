//! Painel do dono da Resolutoo — exige `platform_admins`.

use axum::{extract::Path, extract::State, http::StatusCode, Json};
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

#[derive(Debug, Serialize)]
pub struct PlatformMercadoPagoStatus {
    pub connected: bool,
    pub connection_status: Option<String>,
}

/// Status da conta Mercado Pago DA RESOLUTOO (recebe as assinaturas dos
/// lojistas) — nunca a conta de um lojista específico, ver
/// mercadopago_oauth.rs.
pub async fn mercadopago_status(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<PlatformMercadoPagoStatus>, AppError> {
    let row: Option<(Option<serde_json::Value>,)> =
        sqlx::query_as("SELECT credenciais FROM platform_payment_credentials WHERE id = 'default'")
            .fetch_optional(&state.pool)
            .await?;
    let credenciais = row.and_then(|(c,)| c);
    let has_token = credenciais
        .as_ref()
        .and_then(|c| c.get("token"))
        .and_then(|t| t.as_str())
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let connection_status = credenciais
        .as_ref()
        .and_then(|c| c.get("connection_status"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    Ok(Json(PlatformMercadoPagoStatus {
        connected: has_token,
        connection_status,
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
    /// Desconto CORRENTE do assinante (snapshot mutável, independente do
    /// cupom original — ver `adjust_store_discount`). Exatamente um dos
    /// dois vem preenchido, espelhando `discount_type` do cupom.
    pub discount_percent: Option<f64>,
    pub discount_amount: Option<f64>,
}

pub async fn list_stores(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
) -> Result<Json<Vec<StoreRow>>, AppError> {
    let rows = sqlx::query_as::<_, StoreRow>(
        "SELECT id, loja_nome, email, whatsapp, slug, plan_code, valor_mensal, status, \
         onboarding_status, coupon_code, created_at, discount_percent, discount_amount \
         FROM subscribers ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct AdjustDiscountInput {
    /// Novo valor de desconto pra este assinante (mesma unidade do cupom
    /// original: pontos percentuais ou R$ fixo). Clampado entre 0 e o
    /// `discount_value` do cupom original -- nunca pode superar o que o
    /// cupom concedia, nem ficar negativo.
    pub discount_value: f64,
}

#[derive(Debug, Serialize)]
pub struct AdjustDiscountOutput {
    pub discount_value: f64,
    pub original_discount_value: f64,
    pub valor_mensal: f64,
}

/// Reduz ou restaura (parcial ou totalmente) o desconto que UM assinante
/// específico recebe de um cupom já resgatado -- sem afetar o cupom em si
/// nem outros assinantes que usaram o mesmo código (cada assinante já tinha
/// seu próprio snapshot em `subscribers.discount_percent/discount_amount`,
/// só faltava um endpoint pra editar isso com segurança + repassar pro
/// Mercado Pago). `update_amount` só atualiza o VALOR FUTURO da assinatura
/// (`auto_recurring.transaction_amount` no preapproval) -- a cobrança do
/// ciclo já em andamento não muda, exatamente o "não imediatamente, no
/// próximo ciclo" pedido.
pub async fn adjust_store_discount(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(id): Path<String>,
    Json(body): Json<AdjustDiscountInput>,
) -> Result<Json<AdjustDiscountOutput>, AppError> {
    let row: Option<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT plan_code, gateway, mp_preapproval_id, COALESCE(billing_cycle, 'mensal'), coupon_code \
         FROM subscribers WHERE id = $1",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((Some(plan_code), gateway_kind, external_id, billing_cycle, Some(coupon_code))) = row else {
        return Err(AppError::BadRequest(
            "loja sem plano ou sem cupom aplicado".to_string(),
        ));
    };

    let coupon: Option<(String, f64)> =
        sqlx::query_as("SELECT discount_type, discount_value FROM platform_coupons WHERE upper(code) = upper($1)")
            .bind(&coupon_code)
            .fetch_optional(&state.pool)
            .await?;
    let (discount_type, original_value) =
        coupon.ok_or_else(|| AppError::NotFound("cupom original não encontrado".to_string()))?;

    if !body.discount_value.is_finite() || body.discount_value < 0.0 || body.discount_value > original_value {
        return Err(AppError::BadRequest(format!(
            "desconto deve ficar entre 0 e {original_value} (valor original do cupom)"
        )));
    }

    let list_monthly = plans::monthly_price(&state.pool, &plan_code).await?;
    let new_monthly = coupons::apply_discount(list_monthly, &discount_type, body.discount_value);

    if discount_type == "fixed" {
        sqlx::query(
            "UPDATE subscribers SET discount_amount = $1, discount_percent = NULL, valor_mensal = $2, updated_at = now() WHERE id = $3",
        )
        .bind(body.discount_value)
        .bind(new_monthly)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE subscribers SET discount_percent = $1, discount_amount = NULL, valor_mensal = $2, updated_at = now() WHERE id = $3",
        )
        .bind(body.discount_value)
        .bind(new_monthly)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    }

    let billing_cycle = billing_cycle.unwrap_or_else(|| "mensal".to_string());
    let cycle = crate::gateway::BillingCycle::parse(&billing_cycle).unwrap_or(crate::gateway::BillingCycle::Mensal);
    let charge = crate::gateway::charge_amount(new_monthly, cycle);
    if let (Some(gw), Some(ext)) = (gateway_kind.as_deref(), external_id.as_deref()) {
        crate::gateway::update_amount(&state, gw, ext, charge).await?;
    }

    Ok(Json(AdjustDiscountOutput {
        discount_value: body.discount_value,
        original_discount_value: original_value,
        valor_mensal: new_monthly,
    }))
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
    pub launch_price_monthly: Option<f64>,
    #[serde(default)]
    pub tagline: String,
    #[serde(default = "default_features")]
    pub features: serde_json::Value,
    #[serde(default)]
    pub highlight: bool,
    #[serde(default)]
    pub sort_order: i32,
    /// Ramo do plano -- decide o vertical do tenant de quem assinar (ver
    /// migration 0022 + plans::vertical_for). Default 'ecommerce' preserva
    /// o comportamento de todo plano já cadastrado.
    #[serde(default = "default_plan_vertical")]
    pub vertical: String,
}
fn default_features() -> serde_json::Value {
    serde_json::json!([])
}
fn default_plan_vertical() -> String {
    "ecommerce".to_string()
}

/// Códigos aceitos por ramo. Cada ramo tem sua própria escada de planos --
/// um código nunca pertence aos dois (é o que impede um assinante de
/// eletrônica cair na escada de upgrade do ecommerce e vice-versa).
fn plan_code_allowed(code: &str, vertical: &str) -> bool {
    match vertical {
        "ecommerce" => matches!(code, "essential" | "management" | "premium"),
        "eletronicos" => matches!(code, "eletronica"),
        _ => false,
    }
}

/// Superadmin cadastra planos (não há seed automático de planos).
pub async fn create_plan(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Json(body): Json<CreatePlanInput>,
) -> Result<Json<plans::PlanRow>, AppError> {
    let code = body.code.trim().to_lowercase();
    let vertical = body.vertical.trim().to_lowercase();
    if !matches!(vertical.as_str(), "ecommerce" | "eletronicos") {
        return Err(AppError::BadRequest(
            "vertical deve ser ecommerce ou eletronicos".to_string(),
        ));
    }
    if !plan_code_allowed(&code, &vertical) {
        return Err(AppError::BadRequest(format!(
            "code '{code}' não é válido para o ramo '{vertical}' (ecommerce: essential/management/premium; eletronicos: eletronica)"
        )));
    }
    if body.name.trim().is_empty() || body.price_monthly <= 0.0 {
        return Err(AppError::BadRequest("name e price_monthly obrigatórios".to_string()));
    }
    if let Some(launch) = body.launch_price_monthly {
        if launch <= 0.0 || launch >= body.price_monthly {
            return Err(AppError::BadRequest(
                "launch_price_monthly deve ser positivo e menor que price_monthly".to_string(),
            ));
        }
    }
    sqlx::query(
        "INSERT INTO platform_plans (code, name, price_monthly, launch_price_monthly, tagline, features, highlight, sort_order, vertical) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) \
         ON CONFLICT (code) DO UPDATE SET \
           name = EXCLUDED.name, price_monthly = EXCLUDED.price_monthly, \
           launch_price_monthly = EXCLUDED.launch_price_monthly, tagline = EXCLUDED.tagline, \
           features = EXCLUDED.features, highlight = EXCLUDED.highlight, sort_order = EXCLUDED.sort_order, \
           vertical = EXCLUDED.vertical, active = true, updated_at = now()",
    )
    .bind(&code)
    .bind(body.name.trim())
    .bind(body.price_monthly)
    .bind(body.launch_price_monthly)
    .bind(&body.tagline)
    .bind(&body.features)
    .bind(body.highlight)
    .bind(body.sort_order)
    .bind(&vertical)
    .execute(&state.pool)
    .await?;

    let row = sqlx::query_as::<_, plans::PlanRow>(
        "SELECT code, name, price_monthly, launch_price_monthly, tagline, features, highlight, active, sort_order, vertical \
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
    /// Sempre sobrescrito com o que vier (não usa COALESCE) -- omitir o
    /// campo ou mandar `null` LIMPA o preço de inauguração de propósito,
    /// é o único jeito de o front conseguir "voltar pro normal".
    #[serde(default)]
    pub launch_price_monthly: Option<f64>,
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
    let effective_normal = body.price_monthly.unwrap_or_else(|| 0.0);
    if let Some(launch) = body.launch_price_monthly {
        // Só valida contra o normal quando o normal também veio nesta
        // edição -- senão o front tem que sempre mandar os dois juntos.
        if launch <= 0.0 || (body.price_monthly.is_some() && launch >= effective_normal) {
            return Err(AppError::BadRequest(
                "launch_price_monthly deve ser positivo e menor que price_monthly".to_string(),
            ));
        }
    }
    sqlx::query(
        "UPDATE platform_plans SET \
         name = COALESCE($1, name), \
         price_monthly = COALESCE($2, price_monthly), \
         launch_price_monthly = $3, \
         tagline = COALESCE($4, tagline), \
         features = COALESCE($5, features), \
         highlight = COALESCE($6, highlight), \
         active = COALESCE($7, active), \
         updated_at = now() \
         WHERE code = $8",
    )
    .bind(&body.name)
    .bind(body.price_monthly)
    .bind(body.launch_price_monthly)
    .bind(&body.tagline)
    .bind(&body.features)
    .bind(body.highlight)
    .bind(body.active)
    .bind(&code)
    .execute(&state.pool)
    .await?;

    let row = sqlx::query_as::<_, plans::PlanRow>(
        "SELECT code, name, price_monthly, launch_price_monthly, tagline, features, highlight, active, sort_order, vertical \
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

    // Vitalício: desconto enquanto o assinante permanecer no plano do resgate,
    // sem janela (duration_days). Timed: exige dias. Em ambos os casos,
    // max_redemptions é opcional (teto de quantos assinantes podem resgatar
    // o cupom) — não é mais exclusivo do tipo "timed".
    let duration_days = if body.duration_kind == "lifetime_current_plan" {
        None
    } else {
        let days = body.duration_days.filter(|d| *d > 0).ok_or_else(|| {
            AppError::BadRequest("cupom por tempo limitado exige duration_days > 0".to_string())
        })?;
        Some(days)
    };
    let max_redemptions = body.max_redemptions.filter(|m| *m > 0);

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

#[derive(Debug, Deserialize)]
pub struct UpdateCouponInput {
    pub code: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub duration_kind: String,
    pub duration_days: Option<i32>,
    pub max_redemptions: Option<i32>,
    pub notes: Option<String>,
    pub active: bool,
}

pub async fn update_coupon(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(id): Path<String>,
    Json(body): Json<UpdateCouponInput>,
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
    let duration_days = if body.duration_kind == "lifetime_current_plan" {
        None
    } else {
        let days = body.duration_days.filter(|d| *d > 0).ok_or_else(|| {
            AppError::BadRequest("cupom por tempo limitado exige duration_days > 0".to_string())
        })?;
        Some(days)
    };
    let max_redemptions = body.max_redemptions.filter(|m| *m > 0);

    // Renomear o código não perde nenhum resgate já feito -- assinantes que
    // já usaram o cupom têm o valor snapshotado em `subscribers.coupon_code`
    // (não referenciam mais o cupom original), então mudar o texto aqui não
    // quebra o histórico deles.
    let result = sqlx::query(
        "UPDATE platform_coupons SET code = $1, discount_type = $2, discount_value = $3, duration_kind = $4, \
         duration_days = $5, max_redemptions = $6, notes = $7, active = $8, updated_at = now() \
         WHERE id = $9",
    )
    .bind(&code)
    .bind(&body.discount_type)
    .bind(body.discount_value)
    .bind(&body.duration_kind)
    .bind(duration_days)
    .bind(max_redemptions)
    .bind(body.notes.unwrap_or_default())
    .bind(body.active)
    .bind(&id)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.is_unique_violation() {
                return AppError::BadRequest(format!("já existe outro cupom com o código {code}"));
            }
        }
        AppError::from(e)
    })?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("cupom não encontrado".to_string()));
    }
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn delete_coupon(
    State(state): State<AppState>,
    AuthSuperadmin(_): AuthSuperadmin,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let result = sqlx::query("DELETE FROM platform_coupons WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("cupom não encontrado".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
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
