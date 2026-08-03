use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthSubscriber;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct OnboardingInput {
    pub nome_loja: String,
    #[serde(default)]
    pub categoria: String,
    #[serde(default)]
    pub whatsapp: String,
    pub endereco: String,
    #[serde(default)]
    pub endereco_numero: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default = "default_color")]
    pub cor_principal: String,
    #[serde(default)]
    pub banner_url: Option<String>,
    pub slug: String,

    // Etapa 1 (Resolutoo /onboarding) — painel liberado após provision.
    pub documento: String,
    pub tipo_documento: String, // 'cnpj' | 'cpf'
    #[serde(default)]
    pub instagram: Option<String>,
    #[serde(default)]
    pub facebook: Option<String>,
    #[serde(default = "default_true")]
    pub vender_externamente: bool,
    /// Loja vende produtos para maiores de 18 — ativa consentimento checkout_mais18.
    #[serde(default)]
    pub vende_mais_18: bool,

    // WhatsApp: só a flag aqui; QR connect fica na etapa 2 do painel da loja.
    #[serde(default = "default_true")]
    pub whatsapp_habilitado: bool,
    #[serde(default = "default_forma_pagamento")]
    pub forma_pagamento: String, // 'manual' | 'plataforma'
    #[serde(default)]
    pub plataforma_pagamento: Option<String>, // 'mercado_pago' | 'abacate_pay'
    #[serde(default)]
    pub plataforma_credenciais: Option<serde_json::Value>,
    /// Estilo de vitrine: ufersin | burgerbite | burgerhouse
    #[serde(default = "default_layout_style")]
    pub layout_style: String,
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
fn default_layout_style() -> String {
    "ufersin".to_string()
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
    if body.nome_loja.trim().is_empty() {
        return Err(AppError::BadRequest("nome da empresa é obrigatório".to_string()));
    }
    if body.endereco.trim().is_empty() {
        return Err(AppError::BadRequest("endereço é obrigatório".to_string()));
    }
    validate_essential_fields(&body)?;
    if !matches!(body.layout_style.as_str(), "ufersin" | "burgerbite" | "burgerhouse") {
        return Err(AppError::BadRequest(
            "layout_style deve ser ufersin, burgerbite ou burgerhouse".to_string(),
        ));
    }

    // Instância de WhatsApp única por tenant (spec: "cada Tenant deverá
    // possuir SUA PRÓPRIA INSTÂNCIA") — deriva do slug, que já é único.
    let whatsapp_instance = format!("loja-{slug}");
    let pickup = match body.endereco_numero.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => format!("{}, {}", body.endereco.trim(), n),
        None => body.endereco.trim().to_string(),
    };
    let categoria = if body.categoria.trim().is_empty() {
        "Outro"
    } else {
        body.categoria.trim()
    };
    let instagram = body
        .instagram
        .as_deref()
        .map(|s| s.trim().trim_start_matches('@'))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let facebook = body
        .facebook
        .as_deref()
        .map(|s| s.trim().trim_start_matches('@'))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let payload = ProvisionRequest {
        organization_name: body.nome_loja.trim(),
        organization_email: email.trim(),
        tenant_name: body.nome_loja.trim(),
        tenant_slug: &slug,
        theme_primary_color: &body.cor_principal,
        whatsapp_instance,
        pickup_address: &pickup,
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
         forma_pagamento = $15, plataforma_pagamento = $16, plataforma_credenciais = $17, \
         layout_style = $18, instagram = $19, endereco_numero = $20, vende_mais_18 = $21, \
         facebook = $22, updated_at = now() \
         WHERE id = $10",
    )
    .bind(&parsed.tenant_id)
    .bind(&slug)
    .bind(categoria)
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
    .bind(&body.layout_style)
    .bind(&instagram)
    .bind(body.endereco_numero.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(body.vende_mais_18)
    .bind(&facebook)
    .execute(&state.pool)
    .await?;

    Ok(Json(OnboardingOutput { tenant_id: parsed.tenant_id, slug, admin_login_hint: email }))
}

fn digits_only(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn valid_cpf(raw: &str) -> bool {
    let cpf = digits_only(raw);
    if cpf.len() != 11 || cpf.chars().all(|c| c == cpf.as_bytes()[0] as char) {
        return false;
    }
    let calc = |base: &str, factor: u32| -> u32 {
        let mut sum = 0u32;
        for (i, ch) in base.chars().enumerate() {
            sum += ch.to_digit(10).unwrap_or(0) * (factor - i as u32);
        }
        let rest = (sum * 10) % 11;
        if rest == 10 { 0 } else { rest }
    };
    let d1 = calc(&cpf[..9], 10);
    let d2 = calc(&cpf[..10], 11);
    d1 == cpf[9..10].parse().unwrap_or(99) && d2 == cpf[10..11].parse().unwrap_or(99)
}

fn valid_cnpj(raw: &str) -> bool {
    let cnpj = digits_only(raw);
    if cnpj.len() != 14 || cnpj.chars().all(|c| c == cnpj.as_bytes()[0] as char) {
        return false;
    }
    let calc = |base: &str, weights: &[u32]| -> u32 {
        let mut sum = 0u32;
        for (i, w) in weights.iter().enumerate() {
            sum += base.chars().nth(i).and_then(|c| c.to_digit(10)).unwrap_or(0) * w;
        }
        let rest = sum % 11;
        if rest < 2 { 0 } else { 11 - rest }
    };
    let w1 = [5u32, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let w2 = [6u32, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let d1 = calc(&cnpj[..12], &w1);
    let d2 = calc(&cnpj[..13], &w2);
    d1 == cnpj[12..13].parse().unwrap_or(99) && d2 == cnpj[13..14].parse().unwrap_or(99)
}

fn validate_essential_fields(body: &OnboardingInput) -> Result<(), AppError> {
    if body.documento.trim().is_empty() {
        return Err(AppError::BadRequest("CNPJ ou CPF é obrigatório".to_string()));
    }
    if !matches!(body.tipo_documento.as_str(), "cnpj" | "cpf") {
        return Err(AppError::BadRequest("tipo_documento deve ser 'cnpj' ou 'cpf'".to_string()));
    }
    let doc_ok = if body.tipo_documento == "cpf" {
        valid_cpf(&body.documento)
    } else {
        valid_cnpj(&body.documento)
    };
    if !doc_ok {
        return Err(AppError::BadRequest(format!(
            "{} inválido — confira os dígitos",
            body.tipo_documento.to_uppercase()
        )));
    }
    if !matches!(body.forma_pagamento.as_str(), "manual" | "plataforma") {
        return Err(AppError::BadRequest(
            "forma_pagamento deve ser 'manual' ou 'plataforma'".to_string(),
        ));
    }
    if body.forma_pagamento == "plataforma" {
        match body.plataforma_pagamento.as_deref() {
            Some("mercado_pago") | Some("abacate_pay") => {}
            _ => {
                return Err(AppError::BadRequest(
                    "escolha Mercado Pago ou Abacate Pay".to_string(),
                ))
            }
        }
        // CPF (PF) só pode usar Mercado Pago — AbacatePay exige CNPJ.
        if body.tipo_documento == "cpf" && body.plataforma_pagamento.as_deref() == Some("abacate_pay") {
            return Err(AppError::BadRequest(
                "com CPF só é permitido Mercado Pago; AbacatePay exige CNPJ".to_string(),
            ));
        }
        // Sem token: trata como cobrança manual (PIX online só com credencial).
        let token_ok = body
            .plataforma_credenciais
            .as_ref()
            .and_then(|v| v.get("token"))
            .and_then(|t| t.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        if !token_ok {
            // Caller may still send plataforma_pagamento as preference; forma
            // must be manual until credentials exist. Mutate via returning
            // early is awkward — FE sends manual; BE also rejects inconsistent.
            return Err(AppError::BadRequest(
                "informe a credencial da plataforma para ativar cobrança online, ou salve sem ativar (manual)".to_string(),
            ));
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
    pub endereco_numero: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub cor_principal: Option<String>,
    #[serde(default)]
    pub documento: Option<String>,
    #[serde(default)]
    pub tipo_documento: Option<String>,
    #[serde(default)]
    pub instagram: Option<String>,
    #[serde(default)]
    pub facebook: Option<String>,
    #[serde(default)]
    pub vender_externamente: Option<bool>,
    #[serde(default)]
    pub vende_mais_18: Option<bool>,
    #[serde(default)]
    pub whatsapp_habilitado: Option<bool>,
    #[serde(default)]
    pub forma_pagamento: Option<String>,
    #[serde(default)]
    pub plataforma_pagamento: Option<String>,
    #[serde(default)]
    pub plataforma_credenciais: Option<serde_json::Value>,
    #[serde(default)]
    pub nome_loja: Option<String>,
    #[serde(default)]
    pub layout_style: Option<String>,
    #[serde(default)]
    pub landing_headline: Option<String>,
    #[serde(default)]
    pub landing_sub: Option<String>,
    #[serde(default)]
    pub landing_badge: Option<String>,
    #[serde(default)]
    pub cart_fab_style: Option<String>,
    #[serde(default)]
    pub cart_fab_animate: Option<bool>,
}

/// Edição pós-onboarding (/meu-plano) — atualiza os mesmos campos, mas
/// NUNCA chama provision-tenant de novo (o tenant já existe). Só campos
/// enviados são trocados; omitidos ficam como já estavam (COALESCE), pra
/// não exigir o formulário inteiro repreenchido a cada pequena edição.
pub async fn editar_onboarding(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(mut body): Json<EditOnboardingInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>, String, String, bool, String, bool)> = sqlx::query_as(
        "SELECT tenant_id, status, slug, whatsapp_habilitado, COALESCE(tipo_documento, 'cnpj'), \
         COALESCE(NULLIF(trim(plataforma_credenciais->>'token'), ''), NULL) IS NOT NULL \
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (tenant_id, status, slug, was_whatsapp_on, current_tipo_documento, has_existing_creds) =
        row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
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

    // Online PIX only when credentials exist (new token or already saved).
    let new_token_ok = body
        .plataforma_credenciais
        .as_ref()
        .and_then(|v| v.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if body.forma_pagamento.as_deref() == Some("plataforma") && !new_token_ok && !has_existing_creds {
        body.forma_pagamento = Some("manual".to_string());
    }

    // Efetivo após o UPDATE (COALESCE): CPF + AbacatePay é inválido.
    let effective_tipo = body
        .tipo_documento
        .as_deref()
        .unwrap_or(current_tipo_documento.as_str());
    let effective_plataforma = body.plataforma_pagamento.as_deref();
    if effective_tipo == "cpf" && effective_plataforma == Some("abacate_pay") {
        return Err(AppError::BadRequest(
            "com CPF só é permitido Mercado Pago; AbacatePay exige CNPJ".to_string(),
        ));
    }

    if let Some(ls) = &body.layout_style {
        if !matches!(ls.as_str(), "ufersin" | "burgerbite" | "burgerhouse") {
            return Err(AppError::BadRequest(
                "layout_style deve ser ufersin, burgerbite ou burgerhouse".to_string(),
            ));
        }
    }
    if let Some(fab) = &body.cart_fab_style {
        if !matches!(fab.as_str(), "sacola" | "cart_icon") {
            return Err(AppError::BadRequest(
                "cart_fab_style deve ser 'sacola' ou 'cart_icon'".to_string(),
            ));
        }
    }

    let instagram = body.instagram.as_ref().map(|s| {
        let t = s.trim().trim_start_matches('@');
        t.to_string()
    });
    let facebook = body.facebook.as_ref().map(|s| {
        let t = s.trim().trim_start_matches('@');
        t.to_string()
    });

    sqlx::query(
        "UPDATE subscribers SET \
         categoria = COALESCE($1, categoria), whatsapp = COALESCE($2, whatsapp), endereco = COALESCE($3, endereco), \
         logo_url = COALESCE($4, logo_url), cor_principal = COALESCE($5, cor_principal), \
         documento = COALESCE($6, documento), tipo_documento = COALESCE($7, tipo_documento), \
         vender_externamente = COALESCE($8, vender_externamente), whatsapp_habilitado = COALESCE($9, whatsapp_habilitado), \
         forma_pagamento = COALESCE($10, forma_pagamento), plataforma_pagamento = COALESCE($11, plataforma_pagamento), \
         plataforma_credenciais = COALESCE($12, plataforma_credenciais), \
         loja_nome = COALESCE($13, loja_nome), layout_style = COALESCE($14, layout_style), \
         instagram = COALESCE($15, instagram), endereco_numero = COALESCE($16, endereco_numero), \
         vende_mais_18 = COALESCE($17, vende_mais_18), facebook = COALESCE($18, facebook), \
         landing_headline = COALESCE($19, landing_headline), landing_sub = COALESCE($20, landing_sub), \
         landing_badge = COALESCE($21, landing_badge), cart_fab_style = COALESCE($22, cart_fab_style), \
         cart_fab_animate = COALESCE($23, cart_fab_animate), updated_at = now() \
         WHERE id = $24",
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
    .bind(&body.nome_loja)
    .bind(&body.layout_style)
    .bind(&instagram)
    .bind(body.endereco_numero.as_deref().map(str::trim))
    .bind(body.vende_mais_18)
    .bind(&facebook)
    .bind(body.landing_headline.as_deref().map(str::trim))
    .bind(body.landing_sub.as_deref().map(str::trim))
    .bind(body.landing_badge.as_deref().map(str::trim))
    .bind(&body.cart_fab_style)
    .bind(body.cart_fab_animate)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    // Desmarcou WhatsApp depois de ter habilitado → derruba a instância no motor.
    if body.whatsapp_habilitado == Some(false) && was_whatsapp_on {
        if let Err(e) = teardown_store_whatsapp(&state, &slug).await {
            tracing::warn!("teardown-whatsapp for slug {slug} failed (flag already saved): {e:?}");
        }
    }

    Ok(Json(serde_json::json!({ "updated": true })))
}

async fn teardown_store_whatsapp(state: &AppState, slug: &str) -> Result<(), AppError> {
    if state.ecommerce_internal_url.is_empty() || state.ecommerce_internal_key.is_empty() {
        return Ok(());
    }
    let url = format!(
        "{}/internal/teardown-whatsapp",
        state.ecommerce_internal_url.trim_end_matches('/')
    );
    let resp = state
        .http
        .post(&url)
        .header("x-internal-key", state.ecommerce_internal_key.as_str())
        .header("content-type", "application/json")
        .json(&serde_json::json!({ "tenant_slug": slug }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("teardown-whatsapp unreachable: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "teardown-whatsapp failed: {status} {text}"
        )));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct TenantConfigResponse {
    pub slug: String,
    pub loja_nome: String,
    pub plano: String,
    pub vender_externamente: bool,
    pub whatsapp_habilitado: bool,
    /// Número de contato da loja (só dígitos) pra `https://wa.me/{whatsapp}`
    /// na vitrine — nunca credenciais de pagamento.
    pub whatsapp: String,
    pub forma_pagamento: String,
    pub plataforma_pagamento: Option<String>,
    pub layout_style: String,
    pub cor_principal: Option<String>,
    /// Checkout deve exigir consentimento mais18 além da compra normal.
    pub vende_mais_18: bool,
    pub endereco: Option<String>,
    pub endereco_numero: Option<String>,
    pub instagram: Option<String>,
    pub facebook: Option<String>,
    pub logo_url: Option<String>,
    pub landing_headline: Option<String>,
    pub landing_sub: Option<String>,
    pub landing_badge: Option<String>,
    pub cart_fab_style: String,
    pub cart_fab_animate: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct TenantConfigRow {
    loja_nome: String,
    plan_code: String,
    vender_externamente: bool,
    whatsapp_habilitado: bool,
    whatsapp: String,
    forma_pagamento: String,
    plataforma_pagamento: Option<String>,
    layout_style: String,
    cor_principal: Option<String>,
    vende_mais_18: bool,
    endereco: Option<String>,
    endereco_numero: Option<String>,
    instagram: Option<String>,
    facebook: Option<String>,
    logo_url: Option<String>,
    landing_headline: Option<String>,
    landing_sub: Option<String>,
    landing_badge: Option<String>,
    cart_fab_style: String,
    cart_fab_animate: bool,
}

/// Endpoint PÚBLICO (sem auth) que o motor de e-commerce (ecommerce/
/// frontend) consulta pra saber como aplicar o gating condicional do
/// onboarding daquele tenant — Pedidos, seção de WhatsApp em
/// Configurações, toggle de confirmar recebimento manual. Só devolve as
/// FLAGS + WhatsApp de contato da loja, nunca `plataforma_credenciais`
/// (isso fica só no /api/me autenticado do próprio assinante, nunca sai daqui).
pub async fn tenant_config(
    State(state): State<AppState>,
    axum::extract::Path(slug): axum::extract::Path<String>,
) -> Result<Json<TenantConfigResponse>, AppError> {
    let row: Option<TenantConfigRow> = sqlx::query_as(
        "SELECT loja_nome, plan_code, vender_externamente, whatsapp_habilitado, whatsapp, \
         forma_pagamento, plataforma_pagamento, \
         COALESCE(layout_style, 'ufersin') as layout_style, cor_principal, \
         COALESCE(vende_mais_18, false) as vende_mais_18, \
         endereco, endereco_numero, instagram, facebook, logo_url, \
         landing_headline, landing_sub, landing_badge, \
         COALESCE(cart_fab_style, 'sacola') as cart_fab_style, \
         COALESCE(cart_fab_animate, false) as cart_fab_animate \
         FROM subscribers WHERE slug = $1 AND status = 'ativo'",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;
    let row = row.ok_or_else(|| AppError::NotFound("loja não encontrada".to_string()))?;

    let whatsapp: String = row.whatsapp.chars().filter(|c| c.is_ascii_digit()).collect();

    Ok(Json(TenantConfigResponse {
        slug,
        loja_nome: row.loja_nome,
        plano: row.plan_code,
        vender_externamente: row.vender_externamente,
        whatsapp_habilitado: row.whatsapp_habilitado,
        whatsapp,
        forma_pagamento: row.forma_pagamento,
        plataforma_pagamento: row.plataforma_pagamento,
        layout_style: match row.layout_style.as_str() {
            "burgerbite" | "burgerhouse" | "ufersin" => row.layout_style,
            _ => "ufersin".to_string(),
        },
        cor_principal: row.cor_principal,
        vende_mais_18: row.vende_mais_18,
        endereco: row.endereco,
        endereco_numero: row.endereco_numero,
        instagram: row.instagram,
        facebook: row.facebook,
        logo_url: row.logo_url,
        landing_headline: row.landing_headline,
        landing_sub: row.landing_sub,
        landing_badge: row.landing_badge,
        cart_fab_style: match row.cart_fab_style.as_str() {
            "cart_icon" => "cart_icon".to_string(),
            _ => "sacola".to_string(),
        },
        cart_fab_animate: row.cart_fab_animate,
    }))
}
