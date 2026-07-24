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
}
fn default_color() -> String {
    "#0f5132".to_string()
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

    let row: Option<(String, String, String, Option<String>, Option<String>, String, String)> = sqlx::query_as(
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

    let slug = body.slug.trim().to_lowercase();
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::BadRequest("o slug/subdomínio só pode ter letras minúsculas, números e hífen".to_string()));
    }
    if body.nome_loja.trim().is_empty() || body.categoria.trim().is_empty() {
        return Err(AppError::BadRequest("nome da loja e categoria são obrigatórios".to_string()));
    }

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
         cor_principal = $6, banner_url = $7, loja_nome = $8, whatsapp = $9, onboarding_status = 'provisionado', updated_at = now() \
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
    .execute(&state.pool)
    .await?;

    Ok(Json(OnboardingOutput { tenant_id: parsed.tenant_id, slug, admin_login_hint: email }))
}
