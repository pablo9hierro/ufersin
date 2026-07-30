use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::error::AppError;
use crate::gateway;
use crate::state::AppState;

#[derive(Debug, sqlx::FromRow)]
struct SubscriberRow {
    id: String,
    loja_nome: String,
    responsavel_nome: String,
    whatsapp: String,
    email: String,
    email_verified: bool,
    plan_code: String,
    valor_mensal: f64,
    status: String,
    gateway: String,
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
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: String,
    pub loja_nome: String,
    pub responsavel_nome: String,
    pub whatsapp: String,
    pub email: String,
    pub email_verified: bool,
    pub plano: String,
    pub valor_mensal: f64,
    pub status: String,
    pub gateway: String,
    pub metodo_pagamento: String,
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
        "SELECT id, loja_nome, responsavel_nome, whatsapp, email, email_verified, plan_code, valor_mensal,
                status, gateway, slug, onboarding_status, tenant_id, created_at,
                categoria, endereco, logo_url, cor_principal, documento, tipo_documento,
                vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let row = row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    let metodo_pagamento = if row.gateway == "abacatepay" { "Pix" } else { "Cartão de crédito" };
    let dominio = row.slug.as_ref().map(|s| format!("{s}.rodoletas.app"));

    Ok(Json(MeResponse {
        id: row.id,
        loja_nome: row.loja_nome,
        responsavel_nome: row.responsavel_nome,
        whatsapp: row.whatsapp,
        email: row.email,
        email_verified: row.email_verified,
        plano: row.plan_code,
        valor_mensal: row.valor_mensal,
        status: row.status,
        gateway: row.gateway,
        metodo_pagamento: metodo_pagamento.to_string(),
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
        proxima_cobranca: None,
    }))
}

#[derive(Debug, Deserialize)]
pub struct MudarPlanoInput {
    pub novo_plano: String,
}

/// Upgrade/downgrade — troca o plano localmente. Sincronizar o VALOR da
/// cobrança recorrente no gateway (PUT /preapproval no Mercado Pago) é
/// TODO: por enquanto o valor cobrado continua o do plano em que a
/// assinatura foi criada até essa sincronização ser feita; o dashboard
/// mostra o plano novo, mas isso precisa ser fechado antes de oferecer
/// upgrade/downgrade de verdade pra um lojista pagante.
pub async fn mudar_plano(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<MudarPlanoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !matches!(body.novo_plano.as_str(), "essential" | "management" | "premium") {
        return Err(AppError::BadRequest("plano inválido".to_string()));
    }
    sqlx::query("UPDATE subscribers SET plan_code = $1, updated_at = now() WHERE id = $2")
        .bind(&body.novo_plano)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "plano": body.novo_plano })))
}

pub async fn cancelar(State(state): State<AppState>, AuthSubscriber(claims): AuthSubscriber) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(String, Option<String>)> = sqlx::query_as("SELECT gateway, mp_preapproval_id FROM subscribers WHERE id = $1")
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;
    let (gw, external_id) = row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;

    if let Some(external_id) = external_id {
        gateway::cancel(&state, &gw, &external_id).await;
    }

    sqlx::query("UPDATE subscribers SET status = 'cancelado', updated_at = now() WHERE id = $1")
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "status": "cancelado" })))
}
