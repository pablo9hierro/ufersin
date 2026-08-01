use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct OnboardingInput {
    pub nome_loja: String,
    pub categoria: String,
    pub whatsapp: String,
    pub endereco: String,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default = "default_color")]
    pub cor_principal: String,
    #[serde(default)]
    pub banner_url: Option<String>,
    pub slug: String,

    // Etapa 1/2 do onboarding do plano Essential.
    pub documento: String,
    pub tipo_documento: String, // 'cnpj' | 'cpf'
    #[serde(default = "default_true")]
    pub vender_externamente: bool,

    // Etapa 2/2.
    #[serde(default = "default_true")]
    pub whatsapp_habilitado: bool,
    #[serde(default = "default_forma_pagamento")]
    pub forma_pagamento: String, // 'manual' | 'plataforma'
    #[serde(default)]
    pub plataforma_pagamento: Option<String>, // 'mercado_pago' | 'abacate_pay'
    #[serde(default)]
    pub plataforma_credenciais: Option<serde_json::Value>,
}
fn default_color() -> String {
    "#0f5132".to_string()
}
fn default_true() -> bool {
    true
}
fn default_forma_pagamento() -> String {
    "manual".to_string()
}

#[derive(Debug, Serialize)]
struct ProvisionRequest<'a> {
    organization_name: &'a str,
    organization_email: &'a str,
    tenant_name: &'a str,
    tenant_slug: &'a str,
    theme_primary_color: &'a str,
    whatsapp_instance: String,
    pickup_address: &'a str,
    plan_code: &'a str,
    admin_email: &'a str,
    admin_password_hash: &'a str,
    admin_name: &'a str,
}

#[derive(Debug, Deserialize)]
struct ProvisionResponse {
    tenant_id: String,
}

#[derive(Debug, Serialize)]
pub struct OnboardingOutput {
    pub tenant_id: String,
    pub slug: String,
    pub admin_login_hint: String,
}

/// Último passo do fluxo Landing -> Checkout -> Onboarding -> "Entrar no
/// Ecommerce": chama o motor de e-commerce (POST /internal/provision-tenant
/// lá) pra criar Organization+Tenant+Subscription+Admin automaticamente, e
/// grava o tenant_id aqui. Só roda uma vez por assinante — se já tem
/// tenant_id, o motor já foi provisionado antes (idempotência simples via
/// checagem do estado local, não da chamada em si).
pub async fn onboarding(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<OnboardingInput>,
) -> Result<Json<OnboardingOutput>, AppError> {
    if state.ecommerce_internal_url.is_empty() || state.ecommerce_internal_key.is_empty() {
        return Err(AppError::Internal(
            "ECOMMERCE_INTERNAL_URL/ECOMMERCE_INTERNAL_KEY not configured on this backend".to_string(),
        ));
    }

    let row: Option<(String, String, String, Option<String>, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT loja_nome, responsavel_nome, email, password_hash, tenant_id, plan_code, status FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (loja_nome_atual, responsavel_nome, email, password_hash, tenant_id_atual, plan_code, status) =
        row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    let Some(password_hash) = password_hash else {
        return Err(AppError::Internal("assinante sem senha cadastrada — cadastro incompleto".to_string()));
    };

    if status != "ativo" {
        return Err(AppError::BadRequest("o pagamento ainda não foi confirmado — aguarde antes de finalizar o onboarding".to_string()));
    }
    if let Some(tenant_id) = tenant_id_atual {
        return Ok(Json(OnboardingOutput { tenant_id, slug: body.slug, admin_login_hint: email }));
    }
    let Some(plan_code) = plan_code else {
        return Err(AppError::Internal("assinante sem plano — assine um plano antes do onboarding".to_string()));
    };

    let slug = body.slug.trim().to_lowercase();
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::BadRequest("o slug/subdomínio só pode ter letras minúsculas, números e hífen".to_string()));
    }
    if body.nome_loja.trim().is_empty() || body.categoria.trim().is_empty() {
        return Err(AppError::BadRequest("nome da loja e categoria são obrigatórios".to_string()));
    }
    validate_essential_fields(&body)?;

    // Instância de WhatsApp única por tenant (spec: "cada Tenant deverá
    // possuir SUA PRÓPRIA INSTÂNCIA") — deriva do slug, que já é único.
    let whatsapp_instance = format!("loja-{slug}");

    let payload = ProvisionRequest {
        organization_name: body.nome_loja.trim(),
        organization_email: email.trim(),
        tenant_name: body.nome_loja.trim(),
        tenant_slug: &slug,
        theme_primary_color: &body.cor_principal,
        whatsapp_instance,
        pickup_address: body.endereco.trim(),
        plan_code: &plan_code,
        admin_email: email.trim(),
        admin_password_hash: &password_hash,
        admin_name: responsavel_nome.trim(),
    };

    let resp = state
        .http
        .post(format!("{}/internal/provision-tenant", state.ecommerce_internal_url.trim_end_matches('/')))
        .header("x-internal-key", state.ecommerce_internal_key.as_str())
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("motor de e-commerce inacessível: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("provision-tenant failed: {status} {text}");
        return Err(AppError::Internal(format!("não foi possível provisionar a loja (status {status})")));
    }

    let parsed: ProvisionResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("provision-tenant parse error: {e}")))?;

    sqlx::query(
        "UPDATE subscribers SET tenant_id = $1, slug = $2, categoria = $3, endereco = $4, logo_url = $5, \
         cor_principal = $6, banner_url = $7, loja_nome = $8, whatsapp = $9, onboarding_status = 'provisionado', \
         documento = $11, tipo_documento = $12, vender_externamente = $13, whatsapp_habilitado = $14, \
         forma_pagamento = $15, plataforma_pagamento = $16, plataforma_credenciais = $17, updated_at = now() \
         WHERE id = $10",
    )
    .bind(&parsed.tenant_id)
    .bind(&slug)
    .bind(body.categoria.trim())
    .bind(body.endereco.trim())
    .bind(&body.logo_url)
    .bind(&body.cor_principal)
    .bind(&body.banner_url)
    .bind(if body.nome_loja.trim().is_empty() { &loja_nome_atual } else { body.nome_loja.trim() })
    .bind(body.whatsapp.trim())
    .bind(&claims.sub)
    .bind(body.documento.trim())
    .bind(&body.tipo_documento)
    .bind(body.vender_externamente)
    .bind(body.whatsapp_habilitado)
    .bind(&body.forma_pagamento)
    .bind(&body.plataforma_pagamento)
    .bind(&body.plataforma_credenciais)
    .execute(&state.pool)
    .await?;

    Ok(Json(OnboardingOutput { tenant_id: parsed.tenant_id, slug, admin_login_hint: email }))
}

fn validate_essential_fields(body: &OnboardingInput) -> Result<(), AppError> {
    if body.documento.trim().is_empty() {
        return Err(AppError::BadRequest("CNPJ ou CPF é obrigatório".to_string()));
    }
    if !matches!(body.tipo_documento.as_str(), "cnpj" | "cpf") {
        return Err(AppError::BadRequest("tipo_documento deve ser 'cnpj' ou 'cpf'".to_string()));
    }
    if !matches!(body.forma_pagamento.as_str(), "manual" | "plataforma") {
        return Err(AppError::BadRequest("forma_pagamento deve ser 'manual' ou 'plataforma'".to_string()));
    }
    if body.forma_pagamento == "plataforma" {
        match body.plataforma_pagamento.as_deref() {
            Some("mercado_pago") | Some("abacate_pay") => {}
            _ => {
                return Err(AppError::BadRequest(
                    "escolha uma plataforma de pagamento (mercado_pago ou abacate_pay) ou marque cobrança manual".to_string(),
                ))
            }
        }
        if body.plataforma_credenciais.is_none() {
            return Err(AppError::BadRequest("informe as credenciais da plataforma de pagamento escolhida".to_string()));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct EditOnboardingInput {
    #[serde(default)]
    pub categoria: Option<String>,
    #[serde(default)]
    pub whatsapp: Option<String>,
    #[serde(default)]
    pub endereco: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub cor_principal: Option<String>,
    #[serde(default)]
    pub documento: Option<String>,
    #[serde(default)]
    pub tipo_documento: Option<String>,
    #[serde(default)]
    pub vender_externamente: Option<bool>,
    #[serde(default)]
    pub whatsapp_habilitado: Option<bool>,
    #[serde(default)]
    pub forma_pagamento: Option<String>,
    #[serde(default)]
    pub plataforma_pagamento: Option<String>,
    #[serde(default)]
    pub plataforma_credenciais: Option<serde_json::Value>,
}

/// Edição pós-onboarding (/meu-plano) — atualiza os mesmos campos, mas
/// NUNCA chama provision-tenant de novo (o tenant já existe). Só campos
/// enviados são trocados; omitidos ficam como já estavam (COALESCE), pra
/// não exigir o formulário inteiro repreenchido a cada pequena edição.
pub async fn editar_onboarding(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<EditOnboardingInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT tenant_id, status FROM subscribers WHERE id = $1")
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await?;
    let (tenant_id, status) = row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    if tenant_id.is_none() {
        return Err(AppError::BadRequest("finalize o onboarding inicial antes de editar".to_string()));
    }
    if status != "ativo" {
        return Err(AppError::BadRequest("assinatura não está ativa".to_string()));
    }
    if let Some(td) = &body.tipo_documento {
        if !matches!(td.as_str(), "cnpj" | "cpf") {
            return Err(AppError::BadRequest("tipo_documento deve ser 'cnpj' ou 'cpf'".to_string()));
        }
    }
    if let Some(fp) = &body.forma_pagamento {
        if !matches!(fp.as_str(), "manual" | "plataforma") {
            return Err(AppError::BadRequest("forma_pagamento deve ser 'manual' ou 'plataforma'".to_string()));
        }
    }
    if let Some(pp) = &body.plataforma_pagamento {
        if !matches!(pp.as_str(), "mercado_pago" | "abacate_pay") {
            return Err(AppError::BadRequest(
                "plataforma_pagamento deve ser 'mercado_pago' ou 'abacate_pay'".to_string(),
            ));
        }
    }

    sqlx::query(
        "UPDATE subscribers SET \
         categoria = COALESCE($1, categoria), whatsapp = COALESCE($2, whatsapp), endereco = COALESCE($3, endereco), \
         logo_url = COALESCE($4, logo_url), cor_principal = COALESCE($5, cor_principal), \
         documento = COALESCE($6, documento), tipo_documento = COALESCE($7, tipo_documento), \
         vender_externamente = COALESCE($8, vender_externamente), whatsapp_habilitado = COALESCE($9, whatsapp_habilitado), \
         forma_pagamento = COALESCE($10, forma_pagamento), plataforma_pagamento = COALESCE($11, plataforma_pagamento), \
         plataforma_credenciais = COALESCE($12, plataforma_credenciais), updated_at = now() \
         WHERE id = $13",
    )
    .bind(&body.categoria)
    .bind(&body.whatsapp)
    .bind(&body.endereco)
    .bind(&body.logo_url)
    .bind(&body.cor_principal)
    .bind(&body.documento)
    .bind(&body.tipo_documento)
    .bind(body.vender_externamente)
    .bind(body.whatsapp_habilitado)
    .bind(&body.forma_pagamento)
    .bind(&body.plataforma_pagamento)
    .bind(&body.plataforma_credenciais)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "updated": true })))
}

#[derive(Debug, Serialize)]
pub struct TenantConfigResponse {
    pub slug: String,
    pub loja_nome: String,
    pub plano: String,
    pub vender_externamente: bool,
    pub whatsapp_habilitado: bool,
    pub forma_pagamento: String,
    pub plataforma_pagamento: Option<String>,
}

/// Endpoint PÚBLICO (sem auth) que o motor de e-commerce (ecommerce/
/// frontend) consulta pra saber como aplicar o gating condicional do
/// onboarding daquele tenant — Pedidos, seção de WhatsApp em
/// Configurações, toggle de confirmar recebimento manual. Só devolve as
/// FLAGS, nunca `plataforma_credenciais` (isso fica só no /api/me
/// autenticado do próprio assinante, nunca sai daqui).
pub async fn tenant_config(
    State(state): State<AppState>,
    axum::extract::Path(slug): axum::extract::Path<String>,
) -> Result<Json<TenantConfigResponse>, AppError> {
    let row: Option<(String, String, bool, bool, String, Option<String>)> = sqlx::query_as(
        "SELECT loja_nome, plan_code, vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento \
         FROM subscribers WHERE slug = $1 AND status = 'ativo'",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;
    let (loja_nome, plano, vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento) =
        row.ok_or_else(|| AppError::NotFound("loja não encontrada".to_string()))?;

    Ok(Json(TenantConfigResponse {
        slug,
        loja_nome,
        plano,
        vender_externamente,
        whatsapp_habilitado,
        forma_pagamento,
        plataforma_pagamento,
    }))
}
