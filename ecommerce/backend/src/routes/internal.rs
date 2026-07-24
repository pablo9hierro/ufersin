use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

/// Chamado pela plataforma Rodoletas (ufersin/backend) uma única vez, no
/// fim do onboarding de um lojista novo — cria Organization + Tenant +
/// Subscription + o admin da loja, tudo de uma vez. Backend-a-backend só:
/// nunca chamado pelo navegador, por isso a autenticação é uma chave
/// compartilhada simples (INTERNAL_API_KEY) em vez de JWT de usuário.
pub struct InternalAuth;

impl InternalAuth {
    fn check(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
        if state.internal_api_key.is_empty() {
            return Err(AppError::Internal("INTERNAL_API_KEY not configured on this backend".to_string()));
        }
        let provided = headers
            .get("x-internal-key")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if provided != state.internal_api_key.as_str() {
            return Err(AppError::Unauthorized("invalid internal key".to_string()));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct ProvisionTenantInput {
    pub organization_name: String,
    pub organization_email: String,
    pub tenant_name: String,
    pub tenant_slug: String,
    #[serde(default = "default_color")]
    pub theme_primary_color: String,
    pub whatsapp_instance: String,
    #[serde(default = "default_pickup")]
    pub pickup_address: String,
    pub plan_code: String,
    pub admin_email: String,
    /// Hash Argon2 já pronto (mesmo formato/crate usado aqui) — a senha em
    /// si nunca trafega, só o hash que a plataforma Rodoletas já gerou no
    /// cadastro do assinante. Deixa o lojista entrar na própria loja com a
    /// MESMA senha que já usa no painel da Rodoletas.
    pub admin_password_hash: String,
    pub admin_name: String,
}
fn default_color() -> String {
    "#0f5132".to_string()
}
fn default_pickup() -> String {
    "combine o endereço pelo WhatsApp da loja".to_string()
}

#[derive(Debug, Serialize)]
pub struct ProvisionTenantOutput {
    pub tenant_id: String,
    pub organization_id: String,
}

pub async fn provision_tenant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ProvisionTenantInput>,
) -> Result<Json<ProvisionTenantOutput>, AppError> {
    InternalAuth::check(&headers, &state)?;

    if !matches!(input.plan_code.as_str(), "essential" | "management" | "premium") {
        return Err(AppError::BadRequest("plan_code inválido".to_string()));
    }
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::BadRequest("tenant_slug precisa ser [a-z0-9-]".to_string()));
    }

    let mut tx = state.pool.begin().await?;

    let org_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO organizations (id, name, email) VALUES ($1, $2, $3)")
        .bind(&org_id)
        .bind(input.organization_name.trim())
        .bind(input.organization_email.trim())
        .execute(&mut *tx)
        .await?;

    let tenant_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO tenants (id, organization_id, slug, name, status, theme_primary_color, whatsapp_instance, pickup_address) \
         VALUES ($1, $2, $3, $4, 'ativo', $5, $6, $7)",
    )
    .bind(&tenant_id)
    .bind(&org_id)
    .bind(&slug)
    .bind(input.tenant_name.trim())
    .bind(&input.theme_primary_color)
    .bind(input.whatsapp_instance.trim())
    .bind(&input.pickup_address)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("esse slug/subdomínio já está em uso".to_string())
        }
        other => other.into(),
    })?;

    let plan_id = format!("plan_{}", input.plan_code);
    sqlx::query("INSERT INTO subscriptions (id, tenant_id, plan_id, status) VALUES ($1, $2, $3, 'active')")
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&plan_id)
        .execute(&mut *tx)
        .await?;

    let admin_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO admins (id, tenant_id, email, password_hash, name) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&admin_id)
    .bind(&tenant_id)
    .bind(input.admin_email.trim())
    .bind(&input.admin_password_hash)
    .bind(input.admin_name.trim())
    .execute(&mut *tx)
    .await?;

    // shipping_settings precisa de uma linha (NOT NULL store_lat/lng) pra
    // otimização de rota do motoboy não quebrar — coordenadas neutras até o
    // lojista configurar o endereço real da loja pelo admin.
    sqlx::query("INSERT INTO shipping_settings (tenant_id, store_lat, store_lng) VALUES ($1, 0, 0)")
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(ProvisionTenantOutput { tenant_id, organization_id: org_id }))
}

pub async fn health() -> StatusCode {
    StatusCode::OK
}
