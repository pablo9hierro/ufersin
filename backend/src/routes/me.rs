use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::coupons;
use crate::error::AppError;
use crate::gateway::{self, BillingCycle};
use crate::plans;
use crate::state::AppState;

#[derive(Debug, sqlx::FromRow)]
struct SubscriberRow {
    id: String,
    loja_nome: String,
    responsavel_nome: String,
    whatsapp: String,
    email: String,
    plan_code: Option<String>,
    valor_mensal: Option<f64>,
    billing_cycle: String,
    status: String,
    gateway: Option<String>,
    slug: Option<String>,
    onboarding_status: String,
    tenant_id: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    categoria: Option<String>,
    endereco: Option<String>,
    logo_url: Option<String>,
    cor_principal: Option<String>,
    documento: Option<String>,
    tipo_documento: Option<String>,
    vender_externamente: bool,
    whatsapp_habilitado: bool,
    forma_pagamento: String,
    plataforma_pagamento: Option<String>,
    layout_style: String,
    instagram: Option<String>,
    facebook: Option<String>,
    endereco_numero: Option<String>,
    vende_mais_18: bool,
    coupon_code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: String,
    pub loja_nome: String,
    pub responsavel_nome: String,
    pub whatsapp: String,
    pub email: String,
    /// `null` = conta criada mas ainda sem plano escolhido (ver
    /// ARQUITETURA.md §6) — o front mostra a tela de escolher plano nesse
    /// caso, em vez da seção de gerenciar plano.
    pub plano: Option<String>,
    pub valor_mensal: Option<f64>,
    pub billing_cycle: String,
    pub status: String,
    pub gateway: Option<String>,
    pub metodo_pagamento: Option<String>,
    pub slug: Option<String>,
    pub dominio: Option<String>,
    pub onboarding_status: String,
    pub tenant_id: Option<String>,
    pub assinante_desde: chrono::DateTime<chrono::Utc>,
    pub categoria: Option<String>,
    pub endereco: Option<String>,
    pub logo_url: Option<String>,
    pub cor_principal: Option<String>,
    pub documento: Option<String>,
    pub tipo_documento: Option<String>,
    pub vender_externamente: bool,
    pub whatsapp_habilitado: bool,
    pub forma_pagamento: String,
    pub plataforma_pagamento: Option<String>,
    pub layout_style: String,
    pub instagram: Option<String>,
    pub facebook: Option<String>,
    pub endereco_numero: Option<String>,
    pub vende_mais_18: bool,
    pub coupon_code: Option<String>,
    /// Próxima cobrança / histórico de faturas dependem de consultar o
    /// gateway (Mercado Pago não expõe isso na mesma chamada de status) ou
    /// de um worker que registre cada cobrança recebida por webhook — não
    /// implementado ainda, por isso fica null em vez de um valor
    /// inventado. Ver ecommerce/README-TENANCY.md-style nota: melhor não
    /// mostrar um dado do que fingir um.
    pub proxima_cobranca: Option<String>,
}

pub async fn me(State(state): State<AppState>, AuthSubscriber(claims): AuthSubscriber) -> Result<Json<MeResponse>, AppError> {
    let row: Option<SubscriberRow> = sqlx::query_as(
        "SELECT id, loja_nome, responsavel_nome, whatsapp, email, plan_code, valor_mensal,
                COALESCE(billing_cycle, 'mensal') as billing_cycle,
                status, gateway, slug, onboarding_status, tenant_id, created_at,
                categoria, endereco, logo_url, cor_principal, documento, tipo_documento,
                vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento,
                COALESCE(layout_style, 'ufersin') as layout_style, instagram, facebook, endereco_numero,
                COALESCE(vende_mais_18, false) as vende_mais_18, coupon_code
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let row = row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    let metodo_pagamento = row.gateway.as_deref().map(|g| if g == "abacatepay" { "Pix" } else { "Cartão de crédito" }.to_string());
    let dominio = row.slug.as_ref().map(|s| format!("resolutoo.com/loja/?tenant={s}"));

    Ok(Json(MeResponse {
        id: row.id,
        loja_nome: row.loja_nome,
        responsavel_nome: row.responsavel_nome,
        whatsapp: row.whatsapp,
        email: row.email,
        plano: row.plan_code,
        valor_mensal: row.valor_mensal,
        billing_cycle: row.billing_cycle,
        status: row.status,
        gateway: row.gateway,
        metodo_pagamento,
        slug: row.slug,
        dominio,
        onboarding_status: row.onboarding_status,
        tenant_id: row.tenant_id,
        assinante_desde: row.created_at,
        categoria: row.categoria,
        endereco: row.endereco,
        logo_url: row.logo_url,
        cor_principal: row.cor_principal,
        documento: row.documento,
        tipo_documento: row.tipo_documento,
        vender_externamente: row.vender_externamente,
        whatsapp_habilitado: row.whatsapp_habilitado,
        forma_pagamento: row.forma_pagamento,
        plataforma_pagamento: row.plataforma_pagamento,
        layout_style: row.layout_style,
        instagram: row.instagram,
        facebook: row.facebook,
        endereco_numero: row.endereco_numero,
        vende_mais_18: row.vende_mais_18,
        coupon_code: row.coupon_code,
        proxima_cobranca: None,
    }))
}

#[derive(Debug, Deserialize)]
pub struct MudarPlanoInput {
    pub novo_plano: String,
}

/// Upgrade/downgrade — preço do banco + regras de cupom + sync no gateway.
pub async fn mudar_plano(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<MudarPlanoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let list_monthly = plans::monthly_price(&state.pool, &body.novo_plano).await?;

    let row: Option<(Option<String>, Option<String>, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT plan_code, gateway, mp_preapproval_id, COALESCE(billing_cycle, 'mensal'), coupon_kind \
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let Some((Some(plano_atual), gateway_kind, external_id, billing_cycle, coupon_kind)) = row else {
        return Err(AppError::BadRequest("assine um plano antes de trocar".to_string()));
    };

    if plano_atual == body.novo_plano {
        return Ok(Json(serde_json::json!({ "plano": body.novo_plano })));
    }

    // timed: downgrade perde desconto pra sempre; lifetime: upgrade remove.
    if plans::is_downgrade(&plano_atual, &body.novo_plano) && coupon_kind.as_deref() == Some("timed") {
        coupons::revoke_subscriber_coupon(&state.pool, &claims.sub, "downgrade").await?;
    }
    if plans::is_upgrade(&plano_atual, &body.novo_plano)
        && coupon_kind.as_deref() == Some("lifetime_current_plan")
    {
        coupons::revoke_subscriber_coupon(&state.pool, &claims.sub, "upgrade").await?;
    }

    let monthly =
        coupons::effective_monthly(&state.pool, &claims.sub, &body.novo_plano, list_monthly).await?;
    let cycle = BillingCycle::parse(&billing_cycle).unwrap_or(BillingCycle::Mensal);
    let charge = gateway::charge_amount(monthly, cycle);

    if let (Some(gw), Some(ext)) = (gateway_kind.as_deref(), external_id.as_deref()) {
        gateway::update_amount(&state, gw, ext, charge).await?;
    }

    sqlx::query(
        "UPDATE subscribers SET plan_code = $1, valor_mensal = $2, updated_at = now() WHERE id = $3",
    )
    .bind(&body.novo_plano)
    .bind(monthly)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "plano": body.novo_plano,
        "valor_mensal": monthly,
        "valor_cobrado_ciclo": charge,
    })))
}

pub async fn cancelar(State(state): State<AppState>, AuthSubscriber(claims): AuthSubscriber) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as("SELECT gateway, mp_preapproval_id FROM subscribers WHERE id = $1")
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;
    let (gw, external_id) = row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    let Some(gw) = gw else {
        return Err(AppError::BadRequest("nenhuma assinatura pra cancelar".to_string()));
    };

    if let Some(external_id) = external_id {
        gateway::cancel(&state, &gw, &external_id).await;
    }

    sqlx::query("UPDATE subscribers SET status = 'cancelado', updated_at = now() WHERE id = $1")
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "status": "cancelado" })))
}
