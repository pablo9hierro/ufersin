//! CRUD de Perfis fiscais (migration 0056) -- somente no admin da loja
//! (ecommerce), nao replicado na plataforma/Meu Plano, por decisao
//! explicita do usuario. Nome e valores sao texto livre (nunca um enum
//! fixo de "tipos de perfil"); templates ("Venda interna", "Venda
//! interestadual") sao so sugestao de preenchimento no frontend.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::state::AppState;

async fn require_beta(pool: &sqlx::PgPool, tenant_id: &str) -> Result<(), AppError> {
    features::require_feature(pool, tenant_id, Feature::EmissaoFiscal).await
}

#[derive(Debug, Serialize)]
pub struct FiscalProfileDto {
    pub id: String,
    pub nome: String,
    pub cfop: Option<String>,
    pub cst: Option<String>,
    pub csosn: Option<String>,
    pub cclass_trib: Option<String>,
    pub is_default: bool,
    /// CFOPs adicionais habilitados pra override no produto, alem do
    /// `cfop` padrao acima (secao 5 do pedido de reorganizacao fiscal) --
    /// nunca um catalogo pesquisavel, so os que o proprio lojista digitou.
    pub allowed_cfops: Vec<String>,
}

type ProfileRow = (String, String, Option<String>, Option<String>, Option<String>, Option<String>, bool, Vec<String>);

fn to_dto((id, nome, cfop, cst, csosn, cclass_trib, is_default, allowed_cfops): ProfileRow) -> FiscalProfileDto {
    FiscalProfileDto { id, nome, cfop, cst, csosn, cclass_trib, is_default, allowed_cfops }
}

pub async fn list_profiles(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<FiscalProfileDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProfileRow> = sqlx::query_as(
        "SELECT id, nome, cfop, cst, csosn, cclass_trib, is_default, allowed_cfops FROM fiscal_profiles \
         WHERE tenant_id = $1 ORDER BY is_default DESC, nome",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(to_dto).collect()))
}

/// Perfil completo (cfop + allowed_cfops) pra validar override de CFOP no
/// produto -- usado por `fiscal.rs::update_product_fiscal`.
pub async fn profile_cfop_options(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    profile_id: &str,
) -> Result<Option<(Option<String>, Vec<String>)>, AppError> {
    let row: Option<(Option<String>, Vec<String>)> = sqlx::query_as(
        "SELECT cfop, allowed_cfops FROM fiscal_profiles WHERE tenant_id = $1 AND id = $2",
    )
    .bind(tenant_id)
    .bind(profile_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[derive(Debug, Deserialize)]
pub struct UpsertProfileInput {
    pub nome: String,
    #[serde(default)]
    pub cfop: Option<String>,
    #[serde(default)]
    pub cst: Option<String>,
    #[serde(default)]
    pub csosn: Option<String>,
    #[serde(default)]
    pub cclass_trib: Option<String>,
    #[serde(default)]
    pub allowed_cfops: Vec<String>,
}

fn non_empty(v: &Option<String>) -> Option<String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Valida formato (nunca existencia em catalogo fechado) dos codigos
/// informados -- ver fiscal::validation. Campos vazios sao permitidos (o
/// perfil pode nao definir todos, o produto complementa via override).
fn validate_format(body: &UpsertProfileInput) -> Result<(), AppError> {
    use crate::fiscal::validation::*;
    if let Some(v) = non_empty(&body.cfop) {
        if !valid_cfop_format(&v) {
            return Err(AppError::BadRequest("CFOP deve ter 4 dígitos".to_string()));
        }
    }
    if let Some(v) = non_empty(&body.cst) {
        if !valid_cst_format(&v) {
            return Err(AppError::BadRequest("CST deve ter 2 dígitos".to_string()));
        }
    }
    if let Some(v) = non_empty(&body.csosn) {
        if !valid_csosn_format(&v) {
            return Err(AppError::BadRequest("CSOSN deve ter 3 dígitos".to_string()));
        }
    }
    for v in &body.allowed_cfops {
        if !valid_cfop_format(v) {
            return Err(AppError::BadRequest(format!("CFOP alternativo \"{v}\" deve ter 4 dígitos")));
        }
    }
    Ok(())
}

fn clean_allowed_cfops(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = raw.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    out.dedup();
    out
}

pub async fn create_profile(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<UpsertProfileInput>,
) -> Result<Json<Vec<FiscalProfileDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if body.nome.trim().is_empty() {
        return Err(AppError::BadRequest("nome do perfil é obrigatório".to_string()));
    }
    validate_format(&body)?;
    let has_default: Option<(bool,)> =
        sqlx::query_as("SELECT true FROM fiscal_profiles WHERE tenant_id = $1 AND is_default LIMIT 1")
            .bind(&claims.tenant_id)
            .fetch_optional(&state.pool)
            .await?;
    sqlx::query(
        "INSERT INTO fiscal_profiles (id, tenant_id, nome, cfop, cst, csosn, cclass_trib, is_default, allowed_cfops) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(body.nome.trim())
    .bind(non_empty(&body.cfop))
    .bind(non_empty(&body.cst))
    .bind(non_empty(&body.csosn))
    .bind(non_empty(&body.cclass_trib))
    .bind(has_default.is_none())
    .bind(clean_allowed_cfops(&body.allowed_cfops))
    .execute(&state.pool)
    .await?;
    list_profiles(State(state), AdminUser(claims)).await
}

pub async fn update_profile(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(body): Json<UpsertProfileInput>,
) -> Result<Json<Vec<FiscalProfileDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if body.nome.trim().is_empty() {
        return Err(AppError::BadRequest("nome do perfil é obrigatório".to_string()));
    }
    validate_format(&body)?;
    let updated = sqlx::query(
        "UPDATE fiscal_profiles SET nome = $3, cfop = $4, cst = $5, csosn = $6, cclass_trib = $7, \
           allowed_cfops = $8, updated_at = now()::text WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(body.nome.trim())
    .bind(non_empty(&body.cfop))
    .bind(non_empty(&body.cst))
    .bind(non_empty(&body.csosn))
    .bind(non_empty(&body.cclass_trib))
    .bind(clean_allowed_cfops(&body.allowed_cfops))
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("perfil fiscal não encontrado".to_string()));
    }
    list_profiles(State(state), AdminUser(claims)).await
}

/// Nunca mais de um perfil default por tenant (garantido pelo índice
/// único parcial da migration 0056) -- mesmo padrão de set_default_cfop.
pub async fn set_default_profile(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<Vec<FiscalProfileDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE fiscal_profiles SET is_default = false WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
    let updated = sqlx::query("UPDATE fiscal_profiles SET is_default = true WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("perfil fiscal não encontrado".to_string()));
    }
    tx.commit().await?;
    list_profiles(State(state), AdminUser(claims)).await
}

/// Produtos vinculados a este perfil ficam com `fiscal_profile_id = NULL`
/// (ON DELETE SET NULL, migration 0057) -- nunca apaga o produto, so
/// deixa de herdar (fica sem CFOP efetivo ate o lojista linkar outro).
pub async fn delete_profile(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<Vec<FiscalProfileDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    sqlx::query("DELETE FROM fiscal_profiles WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    list_profiles(State(state), AdminUser(claims)).await
}
