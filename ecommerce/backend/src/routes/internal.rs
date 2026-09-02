use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::make_token;
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
    /// "ecommerce" (padrão) | "eletronicos" — decide se o tenant é servido
    /// pelo motor genérico (uiux2/3/4 + AdminLayout) ou pelo módulo
    /// isolado de assistência técnica (vrtech). Ver migrations/0019.
    #[serde(default = "default_vertical")]
    pub vertical: String,
}
fn default_color() -> String {
    "#0f5132".to_string()
}
fn default_pickup() -> String {
    "combine o endereço pelo WhatsApp da loja".to_string()
}
fn default_vertical() -> String {
    "ecommerce".to_string()
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

    if !matches!(input.plan_code.as_str(), "essential" | "management" | "premium" | "eletronica") {
        return Err(AppError::BadRequest("plan_code inválido".to_string()));
    }
    if !matches!(input.vertical.as_str(), "ecommerce" | "eletronicos") {
        return Err(AppError::BadRequest("vertical deve ser ecommerce ou eletronicos".to_string()));
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
        "INSERT INTO tenants (id, organization_id, slug, name, status, theme_primary_color, whatsapp_instance, pickup_address, vertical) \
         VALUES ($1, $2, $3, $4, 'ativo', $5, $6, $7, $8)",
    )
    .bind(&tenant_id)
    .bind(&org_id)
    .bind(&slug)
    .bind(input.tenant_name.trim())
    .bind(&input.theme_primary_color)
    .bind(input.whatsapp_instance.trim())
    .bind(&input.pickup_address)
    .bind(&input.vertical)
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

#[derive(Debug, Deserialize)]
pub struct SyncPickupAddressInput {
    pub tenant_slug: String,
    pub pickup_address: String,
}

/// Resolutoo (ufersin/backend) chama sempre que o lojista edita
/// endereço/número em /meu-plano/layout — antes só sincronizava no
/// onboarding inicial, então editar depois nunca atualizava o
/// `pickup_address` real usado pela vitrine/Assistente IA. Também
/// geocodifica esse mesmo endereço e atualiza `shipping_settings.
/// store_lat/store_lng`, usado pelo cálculo real de frete (/admin/frete
/// e a tool de entrega do Assistente IA) — antes só era setado (zerado)
/// no provisionamento inicial, nunca atualizado depois.
pub async fn sync_pickup_address(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SyncPickupAddressInput>,
) -> Result<StatusCode, AppError> {
    InternalAuth::check(&headers, &state)?;
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    let address = input.pickup_address.trim();
    let row: Option<(String,)> = sqlx::query_as(
        "UPDATE tenants SET pickup_address = $1, updated_at = now()::text WHERE slug = $2 RETURNING id",
    )
    .bind(address)
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;
    let Some((tenant_id,)) = row else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };

    if let Some((lat, lng)) = crate::geocode::geocode_address(&state.http, address).await {
        sqlx::query(
            "UPDATE shipping_settings SET store_lat = $1, store_lng = $2 WHERE tenant_id = $3",
        )
        .bind(lat)
        .bind(lng)
        .bind(&tenant_id)
        .execute(&state.pool)
        .await?;
    } else {
        tracing::warn!("sync-pickup-address: geocode falhou pra tenant {slug}, shipping_settings.store_lat/lng não atualizado");
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SyncFeatureFlagsInput {
    pub tenant_slug: String,
    /// Loja marcou "tenho motoboy próprio" / "vou precisar de tela de
    /// cozinha" / "vou precisar de usuário vendedor" em /meu-plano — essas
    /// necessidades operacionais liberam as features correspondentes
    /// independente do plano (override em `feature_flags`, nunca muda o
    /// plano em si). `false` remove o override (volta a valer só o plano).
    pub needs_motoboy: bool,
    pub needs_funcionarios: bool,
}

/// Resolutoo (ufersin/backend) chama sempre que o lojista salva as
/// preferências de venda em /meu-plano — as features "motoboy" e
/// "funcionarios" (por padrão só no plano management+) passam a ser
/// liberadas por necessidade operacional (checkboxes), não só por plano.
pub async fn sync_feature_flags(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SyncFeatureFlagsInput>,
) -> Result<StatusCode, AppError> {
    InternalAuth::check(&headers, &state)?;
    let slug = input.tenant_slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("tenant_slug obrigatório".to_string()));
    }
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.pool)
        .await?;
    let Some((tenant_id,)) = row else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };

    for (code, needed) in [
        ("motoboy", input.needs_motoboy),
        ("funcionarios", input.needs_funcionarios),
    ] {
        if needed {
            sqlx::query(
                "INSERT INTO feature_flags (id, tenant_id, feature_code, enabled) \
                 VALUES ($1, $2, $3, true) \
                 ON CONFLICT (tenant_id, feature_code) DO UPDATE SET enabled = true",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&tenant_id)
            .bind(code)
            .execute(&state.pool)
            .await?;
        } else {
            sqlx::query("DELETE FROM feature_flags WHERE tenant_id = $1 AND feature_code = $2")
                .bind(&tenant_id)
                .bind(code)
                .execute(&state.pool)
                .await?;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn health() -> StatusCode {
    StatusCode::OK
}

#[derive(Debug, Deserialize)]
pub struct MintAdminTokenInput {
    pub tenant_slug: String,
    pub admin_email: String,
}

#[derive(Debug, Serialize)]
pub struct MintAdminTokenOutput {
    pub token: String,
    pub name: String,
}

/// Chamado pelo middleware do vrtech (Next.js) na ponte de sessão vinda do
/// hub da plataforma: a sessão do lojista lá é validada via Supabase JWT
/// (já verificado antes de chegar aqui), não senha — então não dá pra usar
/// o /api/auth/admin/login normal, que exige senha em texto que nunca
/// trafega além do primeiro login. Confia na chamada backend-a-backend
/// (INTERNAL_API_KEY) igual as outras rotas deste arquivo: quem já provou
/// que é o lojista dono da sessão (verificação feita no Next.js, que só
/// conhece o tenant "vrtech") ganha o token normal de AdminUser, idêntico
/// ao que o formulário de login sempre emitiu.
pub async fn mint_admin_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<MintAdminTokenInput>,
) -> Result<Json<MintAdminTokenOutput>, AppError> {
    InternalAuth::check(&headers, &state)?;

    let slug = input.tenant_slug.trim().to_lowercase();
    let email = input.admin_email.trim();
    if slug.is_empty() || email.is_empty() {
        return Err(AppError::BadRequest(
            "tenant_slug e admin_email são obrigatórios".to_string(),
        ));
    }

    let tenant: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.pool)
        .await?;
    let Some((tenant_id,)) = tenant else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };

    let admin: Option<(String, String)> = sqlx::query_as(
        "SELECT id, name FROM admins WHERE tenant_id = $1 AND lower(email) = lower($2)",
    )
    .bind(&tenant_id)
    .bind(email)
    .fetch_optional(&state.pool)
    .await?;
    let Some((admin_id, name)) = admin else {
        return Err(AppError::NotFound("admin not found for this tenant".to_string()));
    };

    let token = make_token(&state.jwt_secret, &admin_id, &tenant_id, "admin", &name);
    Ok(Json(MintAdminTokenOutput { token, name }))
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
        Some(code) if matches!(code, "essential" | "management" | "premium" | "eletronica") => {
            Some(format!("plan_{code}"))
        }
        Some(_) => {
            return Err(AppError::BadRequest(
                "plan_code deve ser essential, management, premium ou eletronica".to_string(),
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

async fn resolve_category_id(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    name: Option<&str>,
) -> Result<Option<String>, AppError> {
    let Some(name) = name.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM categories WHERE tenant_id = $1 AND name = $2")
            .bind(tenant_id)
            .bind(name)
            .fetch_optional(pool)
            .await?;
    if let Some((id,)) = existing {
        return Ok(Some(id));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(tenant_id)
        .bind(name)
        .execute(pool)
        .await?;
    Ok(Some(id))
}

#[derive(Debug, Deserialize)]
pub struct CatalogSyncInput {
    pub tenant_slug: String,
    pub kind: String, // "product" | "service"
    /// ID de origem (vrtech) -- vira o próprio ID aqui também, tornando a
    /// sincronização idempotente (reenviar o mesmo item não duplica).
    pub source_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub price: f64,
    #[serde(default)]
    pub quantity: Option<i64>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub category_name: Option<String>,
    #[serde(default)]
    pub phone_brand: Option<String>,
    #[serde(default)]
    pub phone_model: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub repair_type: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CatalogSyncOutput {
    pub id: String,
    pub already_synced: bool,
}

/// Espelha um produto/serviço cadastrado no painel do vrtech (Supabase
/// próprio) pra dentro do catálogo público real (products/services deste
/// backend, que /api/public/catalog/{slug}/* lê) -- sem isso o item nunca
/// aparece na vitrine nem no WhatsApp/link de pedido. Chamado logo após o
/// INSERT no Supabase, junto da geração de tags (mesma chamada de origem).
pub async fn catalog_sync(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CatalogSyncInput>,
) -> Result<Json<CatalogSyncOutput>, AppError> {
    InternalAuth::check(&headers, &state)?;

    let slug = input.tenant_slug.trim().to_lowercase();
    let tenant: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.pool)
        .await?;
    let Some((tenant_id,)) = tenant else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };

    let table = match input.kind.as_str() {
        "product" => "products",
        "service" => "services",
        _ => return Err(AppError::BadRequest("kind deve ser 'product' ou 'service'".to_string())),
    };

    let existing: Option<String> = sqlx::query_scalar(&format!("SELECT id FROM {table} WHERE id = $1"))
        .bind(&input.source_id)
        .fetch_optional(&state.pool)
        .await?;

    let category_id = resolve_category_id(&state.pool, &tenant_id, input.category_name.as_deref()).await?;

    if existing.is_some() {
        // Reenvio (item editado no painel do vrtech depois do 1º sync) --
        // atualiza os dados exibidos/pesquisáveis na vitrine (nome, preço,
        // descrição, imagem, categoria, compatibilidade, tags). NUNCA toca
        // em `quantity`: esse número aqui é o estoque real já vendido pela
        // vitrine/checkout deste backend, decrementado pelos pedidos de
        // verdade -- sobrescrever com o estoque local do vrtech (contagem
        // separada, do PDV/balcão) apagaria venda online já registrada e
        // permitiria overselling.
        if table == "products" {
            sqlx::query(
                "UPDATE products SET name = $1, description = $2, price = $3, image_url = $4, \
                   category_id = $5, phone_brand = $6, phone_model = $7, tags = $8 \
                 WHERE id = $9 AND tenant_id = $10",
            )
            .bind(&input.name)
            .bind(&input.description)
            .bind(input.price)
            .bind(&input.image_url)
            .bind(&category_id)
            .bind(&input.phone_brand)
            .bind(&input.phone_model)
            .bind(&input.tags)
            .bind(&input.source_id)
            .bind(&tenant_id)
            .execute(&state.pool)
            .await?;
        } else {
            sqlx::query(
                "UPDATE services SET name = $1, description = $2, category_id = $3, price = $4, \
                   model_name = $5, repair_type = $6, tags = $7 \
                 WHERE id = $8 AND tenant_id = $9",
            )
            .bind(&input.name)
            .bind(input.description.as_deref().unwrap_or(""))
            .bind(&category_id)
            .bind(input.price)
            .bind(&input.model_name)
            .bind(&input.repair_type)
            .bind(&input.tags)
            .bind(&input.source_id)
            .bind(&tenant_id)
            .execute(&state.pool)
            .await?;
        }
        return Ok(Json(CatalogSyncOutput { id: input.source_id, already_synced: true }));
    }

    if table == "products" {
        sqlx::query(
            "INSERT INTO products \
               (id, tenant_id, name, description, price, quantity, image_url, category_id, active, phone_brand, phone_model, tags) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11)",
        )
        .bind(&input.source_id)
        .bind(&tenant_id)
        .bind(&input.name)
        .bind(&input.description)
        .bind(input.price)
        .bind(input.quantity.unwrap_or(0))
        .bind(&input.image_url)
        .bind(&category_id)
        .bind(&input.phone_brand)
        .bind(&input.phone_model)
        .bind(&input.tags)
        .execute(&state.pool)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO services \
               (id, tenant_id, name, description, category_id, price, active, model_name, repair_type, tags) \
             VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)",
        )
        .bind(&input.source_id)
        .bind(&tenant_id)
        .bind(&input.name)
        .bind(input.description.as_deref().unwrap_or(""))
        .bind(&category_id)
        .bind(input.price)
        .bind(&input.model_name)
        .bind(&input.repair_type)
        .bind(&input.tags)
        .execute(&state.pool)
        .await?;
    }

    Ok(Json(CatalogSyncOutput { id: input.source_id, already_synced: false }))
}

#[derive(Debug, Deserialize)]
pub struct PdvOrderSyncItem {
    pub item_id: String,
    pub label: String,
    pub unit_price: f64,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct PdvOrderSyncInput {
    pub tenant_slug: String,
    /// ID da venda no banco do vrtech (pdv_sales.id) -- vira o próprio ID
    /// do pedido aqui, o que torna a sincronização idempotente: reenviar a
    /// mesma venda esbarra na PK e é tratado como já sincronizado, sem
    /// duplicar no Financeiro.
    pub sale_id: String,
    pub customer_name: String,
    #[serde(default)]
    pub customer_whatsapp: Option<String>,
    /// orders.payment_method só aceita um valor único -- em venda com
    /// múltiplas formas de pagamento (split), o vrtech manda a de maior
    /// valor como principal.
    pub payment_method: String,
    pub total: f64,
    pub items: Vec<PdvOrderSyncItem>,
}

#[derive(Debug, Serialize)]
pub struct PdvOrderSyncOutput {
    pub order_id: String,
    pub already_synced: bool,
}

/// Espelha uma venda de balcão concluída no vrtech pra dentro de
/// `orders`/`order_items` (delivery_type='balcao') -- é o mesmo lugar que
/// `/api/admin/financeiro` já lê pra "Vendas PDV" (`list_orders` filtra
/// `delivery_type != 'balcao'`, então balcão nunca aparece misturado com
/// pedido de vitrine). Vrtech continua sendo a fonte de verdade da venda
/// em si (estoque, split payment); isso aqui é só o espelho pro relatório
/// financeiro da plataforma enxergar a venda.
pub async fn pdv_order_sync(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<PdvOrderSyncInput>,
) -> Result<Json<PdvOrderSyncOutput>, AppError> {
    InternalAuth::check(&headers, &state)?;

    if input.items.is_empty() {
        return Err(AppError::BadRequest("venda sem itens".to_string()));
    }
    let slug = input.tenant_slug.trim().to_lowercase();
    let tenant: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(&state.pool)
        .await?;
    let Some((tenant_id,)) = tenant else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };

    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM orders WHERE id = $1")
        .bind(&input.sale_id)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Ok(Json(PdvOrderSyncOutput {
            order_id: input.sale_id,
            already_synced: true,
        }));
    }

    let whatsapp = input
        .customer_whatsapp
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("00000000000")
        .to_string();

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO orders \
           (id, customer_id, customer_name, customer_whatsapp, delivery_type, \
            payment_method, payment_status, status, shipping_price, total, discount_amount, tenant_id) \
         VALUES ($1, NULL, $2, $3, 'balcao', $4, 'pago', 'concluido', 0, $5, 0, $6)",
    )
    .bind(&input.sale_id)
    .bind(&input.customer_name)
    .bind(&whatsapp)
    .bind(&input.payment_method)
    .bind(input.total)
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await?;

    for item in &input.items {
        sqlx::query(
            "INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, tenant_id) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&input.sale_id)
        .bind(&item.item_id)
        .bind(&item.label)
        .bind(item.unit_price)
        .bind(item.quantity)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Json(PdvOrderSyncOutput {
        order_id: input.sale_id,
        already_synced: false,
    }))
}
