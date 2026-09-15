//! Configuração de funcionários do admin da loja (/admin/funcionarios).
//!
//! Os dados NÃO moram aqui: moram em `subscribers`, na plataforma
//! (ufersin/backend). Este módulo é só o proxy autenticado — o admin da
//! loja tem JWT normal (`AdminUser`), resolve o slug do próprio tenant e
//! fala com `/internal/tenant-employee-config` da plataforma usando
//! `PLATFORM_INTERNAL_URL` + `PLATFORM_INTERNAL_KEY` (chamada
//! backend-a-backend, a chave nunca chega ao navegador).
//!
//! É o caminho INVERSO do `routes/internal.rs` daqui (onde é a plataforma
//! que chama este backend).

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::{AdminUser, PdvUser};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct EmployeeConfig {
    pub tem_motoboy_proprio: bool,
    pub precisa_vendedor: bool,
    pub precisa_tela_cozinha: bool,
    /// "nenhuma" | "agente_local" | "navegador" | "ambos"
    pub impressao_modo: String,
    pub usa_mesas: bool,
    pub point_terminal_fixo: bool,
}

async fn tenant_slug(state: &AppState, tenant_id: &str) -> Result<String, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT slug FROM tenants WHERE id = $1")
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    row.map(|(s,)| s).ok_or_else(|| AppError::NotFound("tenant não encontrado".to_string()))
}

fn platform_url(state: &AppState) -> Result<String, AppError> {
    if state.platform_internal_url.is_empty() || state.platform_internal_key.is_empty() {
        return Err(AppError::Internal(
            "PLATFORM_INTERNAL_URL/PLATFORM_INTERNAL_KEY não configurados neste backend".to_string(),
        ));
    }
    Ok(format!(
        "{}/internal/tenant-employee-config",
        state.platform_internal_url.trim_end_matches('/')
    ))
}

async fn parse(resp: reqwest::Response) -> Result<Json<EmployeeConfig>, AppError> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "configuração de funcionários indisponível na plataforma ({status}): {text}"
        )));
    }
    resp.json::<EmployeeConfig>()
        .await
        .map(Json)
        .map_err(|e| AppError::Internal(format!("resposta inválida da plataforma: {e}")))
}

/// Núcleo do GET -- reaproveitado pelo handler admin, pelo handler PDV
/// abaixo, e por quem só precisa LER um campo (`point::check_pos_access`,
/// Parte 5), sem duplicar a resolução de slug + chamada à plataforma.
pub async fn fetch(state: &AppState, tenant_id: &str) -> Result<EmployeeConfig, AppError> {
    let url = platform_url(state)?;
    let slug = tenant_slug(state, tenant_id).await?;
    let resp = state
        .http
        .get(&url)
        .query(&[("tenant_slug", slug.as_str())])
        .header("x-internal-key", state.platform_internal_key.as_str())
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("plataforma inacessível: {e}")))?;
    let Json(cfg) = parse(resp).await?;
    Ok(cfg)
}

pub async fn get_employee_config(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<EmployeeConfig>, AppError> {
    fetch(&state, &claims.tenant_id).await.map(Json)
}

/// Mesma leitura, mas liberada pra qualquer PDV (admin OU vendedor) -- só
/// pra front decidir se mostra a grade de mesas (`usa_mesas`) em
/// `ComandasSection.tsx`. Escrita (PUT) continua AdminUser-only acima.
pub async fn get_employee_config_pdv(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
) -> Result<Json<EmployeeConfig>, AppError> {
    fetch(&state, &claims.tenant_id).await.map(Json)
}

pub async fn update_employee_config(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<EmployeeConfig>,
) -> Result<Json<EmployeeConfig>, AppError> {
    let url = platform_url(&state)?;
    let slug = tenant_slug(&state, &claims.tenant_id).await?;
    let mut payload = serde_json::to_value(&body)
        .map_err(|e| AppError::Internal(format!("payload inválido: {e}")))?;
    payload["tenant_slug"] = serde_json::Value::String(slug);
    let resp = state
        .http
        .put(&url)
        .header("x-internal-key", state.platform_internal_key.as_str())
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("plataforma inacessível: {e}")))?;
    parse(resp).await
}
