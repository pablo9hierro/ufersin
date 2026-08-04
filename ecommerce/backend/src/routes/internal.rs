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

    let default_intervals = serde_json::json!([{ "opens_at": "09:00", "closes_at": "18:00" }]);
    for day in 0i16..=6 {
        sqlx::query(
            "INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals) VALUES ($1, $2, true, $3)",
        )
        .bind(&tenant_id)
        .bind(day)
        .bind(&default_intervals)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO store_status (tenant_id, manually_closed) VALUES ($1, false)")
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(ProvisionTenantOutput { tenant_id, organization_id: org_id }))
}

#[derive(Debug, Deserialize)]
pub struct TeardownWhatsappInput {
    pub tenant_slug: String,
}

/// Rodoletas chama quando o lojista desmarca WhatsApp no Meu plano —
/// derruba a sessão/instância Evolution da loja.
pub async fn teardown_whatsapp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<TeardownWhatsappInput>,
) -> Result<StatusCode, AppError> {
    InternalAuth::check(&headers, &state)?;
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    let store: Option<(String,)> =
        sqlx::query_as("SELECT whatsapp_instance FROM tenants WHERE slug = $1")
            .bind(&slug)
            .fetch_optional(&state.pool)
            .await?;
    if let Some((instance,)) = store {
        crate::whatsapp::teardown(&state, &instance).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn health() -> StatusCode {
    StatusCode::OK
}

#[derive(Debug, Deserialize)]
pub struct SyncPaymentCredentialsInput {
    pub tenant_slug: String,
    pub forma_pagamento: String,
    #[serde(default)]
    pub plataforma_pagamento: Option<String>,
    /// `{ "token": "..." }` — never logged. Null clears credentials.
    #[serde(default)]
    pub plataforma_credenciais: Option<serde_json::Value>,
}

/// Resolutoo pushes payment gateway settings after onboarding / Meu plano
/// so ecommerce-api can create & refund Mercado Pago Pix with the store token.
pub async fn sync_payment_credentials(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SyncPaymentCredentialsInput>,
) -> Result<StatusCode, AppError> {
    InternalAuth::check(&headers, &state)?;
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    if !matches!(input.forma_pagamento.as_str(), "manual" | "plataforma") {
        return Err(AppError::BadRequest(
            "forma_pagamento deve ser 'manual' ou 'plataforma'".to_string(),
        ));
    }
    if let Some(pp) = &input.plataforma_pagamento {
        if pp.as_str() != "mercado_pago" {
            return Err(AppError::BadRequest(
                "plataforma_pagamento deve ser 'mercado_pago'".to_string(),
            ));
        }
    }

    let result = sqlx::query(
        "UPDATE tenants SET forma_pagamento = $1, plataforma_pagamento = $2, \
         plataforma_credenciais = $3 WHERE slug = $4",
    )
    .bind(&input.forma_pagamento)
    .bind(&input.plataforma_pagamento)
    .bind(&input.plataforma_credenciais)
    .bind(&slug)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("tenant not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SetTenantStatusInput {
    pub tenant_slug: String,
    /// `ativo` | `suspenso` | `cancelado` — never deletes the tenant or its data.
    pub status: String,
    /// Optional: `essential` | `management` | `premium` — updates subscription plan_id on reactivate/upgrade.
    #[serde(default)]
    pub plan_code: Option<String>,
}

/// Rodoletas pushes subscription lifecycle (cancel / non-payment / re-subscribe)
/// so painel + vitrine go offline without wiping store data.
pub async fn set_tenant_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SetTenantStatusInput>,
) -> Result<StatusCode, AppError> {
    InternalAuth::check(&headers, &state)?;
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    if !matches!(input.status.as_str(), "ativo" | "suspenso" | "cancelado") {
        return Err(AppError::BadRequest(
            "status deve ser 'ativo', 'suspenso' ou 'cancelado'".to_string(),
        ));
    }
    let plan_id = match input.plan_code.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(code) if matches!(code, "essential" | "management" | "premium") => {
            Some(format!("plan_{code}"))
        }
        Some(_) => {
            return Err(AppError::BadRequest(
                "plan_code deve ser essential, management ou premium".to_string(),
            ))
        }
        None => None,
    };

    let sub_status = match input.status.as_str() {
        "ativo" => "active",
        "suspenso" => "past_due",
        _ => "canceled",
    };

    let mut tx = state.pool.begin().await?;
    let result = sqlx::query("UPDATE tenants SET status = $1, updated_at = now()::text WHERE slug = $2")
        .bind(&input.status)
        .bind(&slug)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("tenant not found".to_string()));
    }

    if let Some(plan_id) = plan_id {
        sqlx::query(
            "UPDATE subscriptions SET status = $1, plan_id = $2, \
             canceled_at = CASE WHEN $1 = 'canceled' THEN COALESCE(canceled_at, now()::text) ELSE NULL END \
             WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $3)",
        )
        .bind(sub_status)
        .bind(&plan_id)
        .bind(&slug)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE subscriptions SET status = $1, \
             canceled_at = CASE WHEN $1 = 'canceled' THEN COALESCE(canceled_at, now()::text) ELSE NULL END \
             WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $2)",
        )
        .bind(sub_status)
        .bind(&slug)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SyncAdminPasswordInput {
    pub tenant_slug: String,
    pub admin_email: String,
    /// Argon2 hash already produced by Resolutoo — plaintext never crosses this hop.
    pub admin_password_hash: String,
    #[serde(default)]
    pub admin_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncAdminPasswordOutput {
    pub created: bool,
    pub updated: bool,
}

/// Resolutoo calls this whenever a lojista changes their platform password
/// (Trocar senha / redefinir senha) so the same credentials open
/// `/loja/admin/login`. Creates the admin row if provision left it missing.
pub async fn sync_admin_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SyncAdminPasswordInput>,
) -> Result<Json<SyncAdminPasswordOutput>, AppError> {
    InternalAuth::check(&headers, &state)?;

    let slug = input.tenant_slug.trim().to_lowercase();
    let email = input.admin_email.trim();
    let hash = input.admin_password_hash.trim();
    if slug.is_empty() || email.is_empty() || hash.is_empty() {
        return Err(AppError::BadRequest(
            "tenant_slug, admin_email e admin_password_hash são obrigatórios".to_string(),
        ));
    }
    if !hash.starts_with("$argon2") {
        return Err(AppError::BadRequest(
            "admin_password_hash deve ser Argon2".to_string(),
        ));
    }

    let tenant: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.pool)
        .await?;
    let Some((tenant_id,)) = tenant else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };

    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM admins WHERE tenant_id = $1 AND lower(email) = lower($2)",
    )
    .bind(&tenant_id)
    .bind(email)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((admin_id,)) = existing {
        sqlx::query("UPDATE admins SET password_hash = $1 WHERE id = $2")
            .bind(hash)
            .bind(&admin_id)
            .execute(&state.pool)
            .await?;
        if let Some(name) = input
            .admin_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let _ = sqlx::query("UPDATE admins SET name = $1 WHERE id = $2")
                .bind(name)
                .bind(&admin_id)
                .execute(&state.pool)
                .await;
        }
        return Ok(Json(SyncAdminPasswordOutput {
            created: false,
            updated: true,
        }));
    }

    let name = input
        .admin_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Admin");
    let admin_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO admins (id, tenant_id, email, password_hash, name) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&admin_id)
    .bind(&tenant_id)
    .bind(email)
    .bind(hash)
    .bind(name)
    .execute(&state.pool)
    .await?;

    Ok(Json(SyncAdminPasswordOutput {
        created: true,
        updated: false,
    }))
}
