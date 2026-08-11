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
    /// Vitrine: só aceita retirada no local (sem entrega/frete/motoboy).
    #[serde(default)]
    pub apenas_retirada: bool,
    /// Pagamento de pedidos de retirada só no ato da retirada na loja.
    #[serde(default)]
    pub pagamento_na_retirada: bool,
    /// Entrega só com Pix já pago no checkout.
    #[serde(default)]
    pub entrega_somente_pix: bool,
    /// Modo pagamento manual (confirmação offline; sem QR Pix no checkout).
    #[serde(default)]
    pub pagamento_manual: bool,

    // WhatsApp: só a flag aqui; QR connect fica na etapa 2 do painel da loja.
    #[serde(default = "default_true")]
    pub whatsapp_habilitado: bool,
    #[serde(default = "default_forma_pagamento")]
    pub forma_pagamento: String, // 'manual' | 'plataforma'
    #[serde(default)]
    pub plataforma_pagamento: Option<String>, // 'mercado_pago'
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

    let row: Option<(String, String, String, Option<String>, Option<String>, Option<String>, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT loja_nome, responsavel_nome, email, password_hash, tenant_id, plan_code, status, plataforma_credenciais FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (loja_nome_atual, responsavel_nome, email, password_hash, tenant_id_atual, plan_code, status, plataforma_credenciais_atual) =
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
    validate_essential_fields(&body, plataforma_credenciais_atual.as_ref())?;
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
         forma_pagamento = COALESCE($15, forma_pagamento), \
         plataforma_pagamento = COALESCE($16, plataforma_pagamento), \
         plataforma_credenciais = COALESCE($17, plataforma_credenciais), \
         layout_style = $18, instagram = $19, endereco_numero = $20, vende_mais_18 = $21, \
         facebook = $22, apenas_retirada = $23, pagamento_na_retirada = $24, \
         entrega_somente_pix = $25, pagamento_manual = $26, updated_at = now() \
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
    .bind(body.apenas_retirada)
    .bind(body.pagamento_na_retirada)
    .bind(body.entrega_somente_pix)
    .bind(body.pagamento_manual)
    .execute(&state.pool)
    .await?;

    // Push payment gateway credentials to ecommerce-api (best-effort) so Pix
    // create/refund can use the store Mercado Pago token.
    if let Err(e) = sync_store_payment_credentials(
        &state,
        &slug,
        &body.forma_pagamento,
        body.plataforma_pagamento.as_deref(),
        body.plataforma_credenciais.as_ref(),
    )
    .await
    {
        tracing::warn!("sync-payment-credentials after onboarding failed: {e:?}");
    }

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

/// `plataforma_credenciais_atual`: valor JÁ SALVO no banco (gravado pelo
/// callback OAuth — ver mercadopago_oauth.rs), nunca o do corpo da
/// requisição. Desde que o Access Token passou a vir só via OAuth, o
/// navegador nunca tem (nem deveria ter) o token pra mandar de volta aqui.
fn validate_essential_fields(
    body: &OnboardingInput,
    plataforma_credenciais_atual: Option<&serde_json::Value>,
) -> Result<(), AppError> {
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
    // Lojista payments: Mercado Pago only — Access Token required on first onboarding.
    if body.forma_pagamento != "plataforma" {
        return Err(AppError::BadRequest(
            "informe o Access Token do Mercado Pago pra receber pagamentos na loja".to_string(),
        ));
    }
    if body.plataforma_pagamento.as_deref() != Some("mercado_pago") {
        return Err(AppError::BadRequest(
            "pagamentos da loja usam apenas Mercado Pago".to_string(),
        ));
    }
    let token_ok = plataforma_credenciais_atual
        .and_then(|v| v.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !token_ok {
        return Err(AppError::BadRequest(
            "Access Token do Mercado Pago é obrigatório".to_string(),
        ));
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
    pub apenas_retirada: Option<bool>,
    #[serde(default)]
    pub pagamento_na_retirada: Option<bool>,
    #[serde(default)]
    pub entrega_somente_pix: Option<bool>,
    #[serde(default)]
    pub pagamento_manual: Option<bool>,
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
    pub landing_hero_image_url: Option<String>,
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
    // slug/tenant_id are NULL until first-time onboarding provisions the store.
    // Decode as Option — a non-null String here caused "database error" for
    // merchants mid-onboarding (ativo + aguardando_onboarding, no slug yet).
    let row: Option<(Option<String>, String, Option<String>, bool, bool)> = sqlx::query_as(
        "SELECT tenant_id, status, slug, whatsapp_habilitado, \
         COALESCE(NULLIF(trim(plataforma_credenciais->>'token'), ''), NULL) IS NOT NULL \
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (tenant_id, status, slug_opt, was_whatsapp_on, has_existing_creds) =
        row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    let slug = slug_opt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();
    if tenant_id.is_none() || slug.is_empty() {
        return Err(AppError::BadRequest(
            "conclua o cadastro da loja em /onboarding (incluindo Access Token do Mercado Pago) antes de editar preferências"
                .to_string(),
        ));
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
        if pp.as_str() != "mercado_pago" {
            return Err(AppError::BadRequest(
                "pagamentos da loja usam apenas Mercado Pago".to_string(),
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
         cart_fab_animate = COALESCE($23, cart_fab_animate), \
         apenas_retirada = COALESCE($24, apenas_retirada), \
         pagamento_na_retirada = COALESCE($25, pagamento_na_retirada), \
         entrega_somente_pix = COALESCE($26, entrega_somente_pix), \
         pagamento_manual = COALESCE($27, pagamento_manual), \
         landing_hero_image_url = CASE \
           WHEN $28::text IS NULL THEN landing_hero_image_url \
           WHEN NULLIF($28, '') IS NULL THEN NULL \
           ELSE $28 END, \
         onboarding_status = CASE \
           WHEN onboarding_status = 'aguardando_onboarding' THEN 'provisionado' \
           ELSE onboarding_status END, \
         updated_at = now() \
         WHERE id = $29",
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
    .bind(body.apenas_retirada)
    .bind(body.pagamento_na_retirada)
    .bind(body.entrega_somente_pix)
    .bind(body.pagamento_manual)
    .bind(body.landing_hero_image_url.as_ref().map(|s| s.trim().to_string()))
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    // Desmarcou WhatsApp depois de ter habilitado → derruba a instância no motor.
    if body.whatsapp_habilitado == Some(false) && was_whatsapp_on {
        if let Err(e) = teardown_store_whatsapp(&state, &slug).await {
            tracing::warn!("teardown-whatsapp for slug {slug} failed (flag already saved): {e:?}");
        }
    }

    // Sync pickup_address (loja/vitrine/Assistente IA) when endereço ou
    // número foram tocados — lê o valor JÁ COALESCEado (endereco/numero
    // podem ter vindo só um dos dois nesta edição).
    if body.endereco.is_some() || body.endereco_numero.is_some() {
        let addr_row: Option<(Option<String>, Option<String>)> =
            sqlx::query_as("SELECT endereco, endereco_numero FROM subscribers WHERE id = $1")
                .bind(&claims.sub)
                .fetch_optional(&state.pool)
                .await?;
        if let Some((endereco, numero)) = addr_row {
            let endereco = endereco.unwrap_or_default();
            if !endereco.trim().is_empty() {
                let pickup = match numero.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    Some(n) => format!("{}, {}", endereco.trim(), n),
                    None => endereco.trim().to_string(),
                };
                if let Err(e) = sync_store_pickup_address(&state, &slug, &pickup).await {
                    tracing::warn!("sync-pickup-address for slug {slug} failed (endereco already saved): {e:?}");
                }
            }
        }
    }

    // Sync payment credentials when any payment field was touched.
    if body.forma_pagamento.is_some()
        || body.plataforma_pagamento.is_some()
        || body.plataforma_credenciais.is_some()
    {
        let row: Option<(String, Option<String>, Option<serde_json::Value>)> = sqlx::query_as(
            "SELECT forma_pagamento, plataforma_pagamento, plataforma_credenciais \
             FROM subscribers WHERE id = $1",
        )
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?;
        if let Some((fp, pp, creds)) = row {
            if let Err(e) =
                sync_store_payment_credentials(&state, &slug, &fp, pp.as_deref(), creds.as_ref())
                    .await
            {
                tracing::warn!("sync-payment-credentials after edit failed: {e:?}");
            }
        }
    }

    Ok(Json(serde_json::json!({ "updated": true })))
}

pub(crate) async fn sync_store_payment_credentials(
    state: &AppState,
    slug: &str,
    forma_pagamento: &str,
    plataforma_pagamento: Option<&str>,
    plataforma_credenciais: Option<&serde_json::Value>,
) -> Result<(), AppError> {
    if state.ecommerce_internal_url.is_empty() || state.ecommerce_internal_key.is_empty() {
        return Ok(());
    }
    let url = format!(
        "{}/internal/sync-payment-credentials",
        state.ecommerce_internal_url.trim_end_matches('/')
    );
    let resp = state
        .http
        .post(&url)
        .header("x-internal-key", state.ecommerce_internal_key.as_str())
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "tenant_slug": slug,
            "forma_pagamento": forma_pagamento,
            "plataforma_pagamento": plataforma_pagamento,
            "plataforma_credenciais": plataforma_credenciais,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("sync-payment-credentials unreachable: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "sync-payment-credentials failed: {status} {text}"
        )));
    }
    Ok(())
}

/// Espelho de `sync_store_payment_credentials` — chamado quando o lojista
/// edita endereço/número em /meu-plano/layout, pra manter
/// `ecommerce.tenants.pickup_address` (vitrine + tool de localização do
/// Assistente IA) em dia com o que está salvo aqui.
pub(crate) async fn sync_store_pickup_address(
    state: &AppState,
    slug: &str,
    pickup_address: &str,
) -> Result<(), AppError> {
    if state.ecommerce_internal_url.is_empty() || state.ecommerce_internal_key.is_empty() {
        return Ok(());
    }
    let url = format!(
        "{}/internal/sync-pickup-address",
        state.ecommerce_internal_url.trim_end_matches('/')
    );
    let resp = state
        .http
        .post(&url)
        .header("x-internal-key", state.ecommerce_internal_key.as_str())
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "tenant_slug": slug,
            "pickup_address": pickup_address,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("sync-pickup-address unreachable: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("sync-pickup-address failed: {status} {text}")));
    }
    Ok(())
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

/// Push the lojista's platform Argon2 hash to ecommerce admin for a tenant.
/// Creates the admin row if missing (same email). Used by Trocar senha and
/// any future password path so `/loja/admin/login` always matches platform.
pub async fn sync_ecommerce_admin_password(
    state: &AppState,
    slug: &str,
    admin_email: &str,
    admin_password_hash: &str,
    admin_name: Option<&str>,
) -> Result<(), AppError> {
    if state.ecommerce_internal_url.is_empty() || state.ecommerce_internal_key.is_empty() {
        return Err(AppError::Internal(
            "ECOMMERCE_INTERNAL_URL/ECOMMERCE_INTERNAL_KEY not configured — não dá pra sincronizar a senha da loja".to_string(),
        ));
    }
    let url = format!(
        "{}/internal/sync-admin-password",
        state.ecommerce_internal_url.trim_end_matches('/')
    );
    let mut body = serde_json::json!({
        "tenant_slug": slug,
        "admin_email": admin_email,
        "admin_password_hash": admin_password_hash,
    });
    if let Some(name) = admin_name.map(str::trim).filter(|s| !s.is_empty()) {
        body["admin_name"] = serde_json::json!(name);
    }
    let resp = state
        .http
        .post(&url)
        .header("x-internal-key", state.ecommerce_internal_key.as_str())
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("sync-admin-password unreachable: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("sync-admin-password failed: {status} {text}");
        return Err(AppError::Internal(format!(
            "não foi possível sincronizar a senha do painel da loja (status {status})"
        )));
    }
    Ok(())
}

/// Sync ecommerce tenant + subscription status without deleting store data.
/// Maps Resolutoo subscriber status → ecommerce tenant status:
/// - `ativo` → `ativo`
/// - `pausado` / `pendente` / `inadimplente` / `suspenso` → `suspenso`
/// - `cancelado` / `sem_assinatura` → `cancelado`
/// Never deletes store data.
/// Optional `plan_code` updates the ecommerce subscription plan (upgrade path).
pub async fn sync_ecommerce_tenant_status(
    state: &AppState,
    slug: &str,
    subscriber_status: &str,
) -> Result<(), AppError> {
    sync_ecommerce_tenant_status_with_plan(state, slug, subscriber_status, None).await
}

pub async fn sync_ecommerce_tenant_status_with_plan(
    state: &AppState,
    slug: &str,
    subscriber_status: &str,
    plan_code: Option<&str>,
) -> Result<(), AppError> {
    if state.ecommerce_internal_url.is_empty() || state.ecommerce_internal_key.is_empty() {
        tracing::warn!(
            "sync ecommerce tenant status skipped (ECOMMERCE_INTERNAL_URL/KEY unset) slug={slug} status={subscriber_status}"
        );
        return Ok(());
    }
    let tenant_status = match subscriber_status {
        "ativo" => "ativo",
        "pausado" | "pendente" | "inadimplente" | "suspenso" => "suspenso",
        "cancelado" | "sem_assinatura" => "cancelado",
        _ => {
            tracing::warn!(
                "sync ecommerce tenant status: unknown subscriber status {subscriber_status:?} for {slug}"
            );
            return Ok(());
        }
    };
    let url = format!(
        "{}/internal/set-tenant-status",
        state.ecommerce_internal_url.trim_end_matches('/')
    );
    let mut body = serde_json::json!({
        "tenant_slug": slug,
        "status": tenant_status,
    });
    if let Some(plan) = plan_code.map(str::trim).filter(|s| !s.is_empty()) {
        body["plan_code"] = serde_json::json!(plan);
    }
    let resp = state
        .http
        .post(&url)
        .header("x-internal-key", state.ecommerce_internal_key.as_str())
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("set-tenant-status unreachable: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        // Soft: provision may not exist yet; cancel still succeeds locally.
        if status.as_u16() == 404 {
            tracing::warn!("set-tenant-status: tenant slug {slug} not found yet");
            return Ok(());
        }
        return Err(AppError::Internal(format!(
            "set-tenant-status failed: {status} {text}"
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
    /// True só quando a conexão veio do fluxo OAuth novo — uma conexão do
    /// modelo antigo (Access Token colado manualmente, antes desta feature)
    /// tem `forma_pagamento = 'plataforma'` mas isso aqui fica false, pra
    /// o painel do lojista (AdminLayout.tsx) saber que precisa reconectar
    /// de verdade antes de liberar o painel.
    pub plataforma_oauth: bool,
    pub layout_style: String,
    pub cor_principal: Option<String>,
    /// Checkout deve exigir consentimento mais18 além da compra normal.
    pub vende_mais_18: bool,
    /// Vitrine: só retirada no local (sem entrega).
    pub apenas_retirada: bool,
    /// Pagamento de pedidos de retirada só no ato da retirada.
    pub pagamento_na_retirada: bool,
    /// Entrega só com Pix já pago no checkout.
    pub entrega_somente_pix: bool,
    /// Preferência: confirmação manual (sem QR Pix online).
    pub pagamento_manual: bool,
    pub endereco: Option<String>,
    pub endereco_numero: Option<String>,
    pub instagram: Option<String>,
    pub facebook: Option<String>,
    pub logo_url: Option<String>,
    pub landing_headline: Option<String>,
    pub landing_sub: Option<String>,
    pub landing_badge: Option<String>,
    pub landing_hero_image_url: Option<String>,
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
    plataforma_oauth: bool,
    layout_style: String,
    cor_principal: Option<String>,
    vende_mais_18: bool,
    apenas_retirada: bool,
    pagamento_na_retirada: bool,
    entrega_somente_pix: bool,
    pagamento_manual: bool,
    endereco: Option<String>,
    endereco_numero: Option<String>,
    instagram: Option<String>,
    facebook: Option<String>,
    logo_url: Option<String>,
    landing_headline: Option<String>,
    landing_sub: Option<String>,
    landing_badge: Option<String>,
    landing_hero_image_url: Option<String>,
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
         COALESCE(plataforma_credenciais->>'source' = 'oauth', false) as plataforma_oauth, \
         COALESCE(layout_style, 'ufersin') as layout_style, cor_principal, \
         COALESCE(vende_mais_18, false) as vende_mais_18, \
         COALESCE(apenas_retirada, false) as apenas_retirada, \
         COALESCE(pagamento_na_retirada, false) as pagamento_na_retirada, \
         COALESCE(entrega_somente_pix, false) as entrega_somente_pix, \
         COALESCE(pagamento_manual, false) as pagamento_manual, \
         endereco, endereco_numero, instagram, facebook, logo_url, \
         landing_headline, landing_sub, landing_badge, landing_hero_image_url, \
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
        plataforma_oauth: row.plataforma_oauth,
        layout_style: match row.layout_style.as_str() {
            "burgerbite" | "burgerhouse" | "ufersin" => row.layout_style,
            _ => "ufersin".to_string(),
        },
        cor_principal: row.cor_principal,
        vende_mais_18: row.vende_mais_18,
        apenas_retirada: row.apenas_retirada,
        pagamento_na_retirada: row.pagamento_na_retirada,
        entrega_somente_pix: row.entrega_somente_pix,
        pagamento_manual: row.pagamento_manual,
        endereco: row.endereco,
        endereco_numero: row.endereco_numero,
        instagram: row.instagram,
        facebook: row.facebook,
        logo_url: row.logo_url,
        landing_headline: row.landing_headline,
        landing_sub: row.landing_sub,
        landing_badge: row.landing_badge,
        landing_hero_image_url: row.landing_hero_image_url,
        cart_fab_style: match row.cart_fab_style.as_str() {
            "cart_icon" => "cart_icon".to_string(),
            _ => "sacola".to_string(),
        },
        cart_fab_animate: row.cart_fab_animate,
    }))
}
