//! Rotas backend-a-backend da PLATAFORMA — o caminho INVERSO do que já
//! existia. Até aqui só a plataforma chamava o motor de e-commerce
//! (`ECOMMERCE_INTERNAL_URL` + `x-internal-key`, ver
//! `ecommerce/backend/src/routes/internal.rs`). Agora o admin da loja
//! (ecommerce/backend) precisa ler/gravar a configuração de funcionários,
//! que mora em `subscribers` aqui — daí este `/internal/*` gated por
//! `PLATFORM_INTERNAL_KEY`.
//!
//! Nunca é chamado pelo navegador: chave compartilhada simples, sem JWT.

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

fn check_key(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    if state.platform_internal_key.is_empty() {
        return Err(AppError::Internal(
            "PLATFORM_INTERNAL_KEY not configured on this backend".to_string(),
        ));
    }
    let provided = headers.get("x-internal-key").and_then(|v| v.to_str().ok()).unwrap_or("");
    if provided != state.platform_internal_key.as_str() {
        return Err(AppError::Unauthorized("invalid internal key".to_string()));
    }
    Ok(())
}

const IMPRESSAO_MODOS: [&str; 4] = ["nenhuma", "agente_local", "navegador", "ambos"];

/// Payload completo da configuração de funcionários de um tenant — os três
/// booleanos históricos (que o motor inteiro já lê) + as preferências novas.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct EmployeeConfig {
    pub tem_motoboy_proprio: bool,
    pub precisa_vendedor: bool,
    pub precisa_tela_cozinha: bool,
    pub impressao_modo: String,
    pub usa_mesas: bool,
    pub point_terminal_fixo: bool,
}

#[derive(Debug, Deserialize)]
pub struct SlugQuery {
    pub tenant_slug: String,
}

pub async fn get_tenant_employee_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SlugQuery>,
) -> Result<Json<EmployeeConfig>, AppError> {
    check_key(&headers, &state)?;
    let slug = q.tenant_slug.trim().to_lowercase();
    let row: Option<EmployeeConfig> = sqlx::query_as(
        "SELECT COALESCE(tem_motoboy_proprio, false) as tem_motoboy_proprio, \
         COALESCE(precisa_vendedor, false) as precisa_vendedor, \
         COALESCE(precisa_tela_cozinha, false) as precisa_tela_cozinha, \
         COALESCE(impressao_modo, 'nenhuma') as impressao_modo, \
         COALESCE(usa_mesas, false) as usa_mesas, \
         COALESCE(point_terminal_fixo, false) as point_terminal_fixo \
         FROM subscribers WHERE slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;
    row.map(Json).ok_or_else(|| AppError::NotFound("loja não encontrada".to_string()))
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmployeeConfigInput {
    pub tenant_slug: String,
    #[serde(flatten)]
    pub config: EmployeeConfig,
}

pub async fn put_tenant_employee_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<UpdateEmployeeConfigInput>,
) -> Result<Json<EmployeeConfig>, AppError> {
    check_key(&headers, &state)?;
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    let c = input.config;
    if !IMPRESSAO_MODOS.contains(&c.impressao_modo.as_str()) {
        return Err(AppError::BadRequest(format!(
            "impressao_modo inválido — use um de: {}",
            IMPRESSAO_MODOS.join(", ")
        )));
    }

    let updated = sqlx::query(
        "UPDATE subscribers SET tem_motoboy_proprio = $1, precisa_vendedor = $2, \
         precisa_tela_cozinha = $3, impressao_modo = $4, usa_mesas = $5, \
         point_terminal_fixo = $6, updated_at = now() WHERE slug = $7",
    )
    .bind(c.tem_motoboy_proprio)
    .bind(c.precisa_vendedor)
    .bind(c.precisa_tela_cozinha)
    .bind(&c.impressao_modo)
    .bind(c.usa_mesas)
    .bind(c.point_terminal_fixo)
    .bind(&slug)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("loja não encontrada".to_string()));
    }

    // Mesma regra do onboarding: necessidade operacional (e não o plano)
    // libera as features de motoboy/funcionários no motor da loja.
    if let Err(e) = super::onboarding::sync_feature_flags(
        &state,
        &slug,
        c.tem_motoboy_proprio,
        c.precisa_vendedor || c.tem_motoboy_proprio || c.precisa_tela_cozinha,
    )
    .await
    {
        tracing::warn!("sync-feature-flags after employee-config update failed: {e:?}");
    }

    Ok(Json(c))
}
