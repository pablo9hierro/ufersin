use axum::extract::{Multipart, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{hash_password, AuthSubscriber};
use crate::coupons;
use crate::error::AppError;
use crate::gateway::{self, BillingCycle};
use crate::plans;
use crate::state::AppState;
use crate::storage;

#[derive(Debug, sqlx::FromRow)]
struct SubscriberRow {
    id: String,
    loja_nome: String,
    responsavel_nome: String,
    whatsapp: String,
    email: String,
    plan_code: Option<String>,
    valor_mensal: Option<f64>,
    billing_cycle: String,
    status: String,
    gateway: Option<String>,
    slug: Option<String>,
    onboarding_status: String,
    tenant_id: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    categoria: Option<String>,
    endereco: Option<String>,
    logo_url: Option<String>,
    cor_principal: Option<String>,
    documento: Option<String>,
    tipo_documento: Option<String>,
    vender_externamente: bool,
    whatsapp_habilitado: bool,
    forma_pagamento: String,
    plataforma_pagamento: Option<String>,
    /// True when `plataforma_credenciais` has a non-empty token — never the secret itself.
    has_plataforma_credenciais: bool,
    /// Raw token for masking only — never serialized on `MeResponse`.
    plataforma_credenciais_token: Option<String>,
    layout_style: String,
    instagram: Option<String>,
    facebook: Option<String>,
    endereco_numero: Option<String>,
    vende_mais_18: bool,
    apenas_retirada: bool,
    coleta_gratis: bool,
    entrega_reparado_gratis: bool,
    pagamento_na_retirada: bool,
    entrega_somente_pix: bool,
    pagamento_manual: bool,
    coupon_code: Option<String>,
    landing_headline: Option<String>,
    landing_sub: Option<String>,
    landing_badge: Option<String>,
    landing_hero_image_url: Option<String>,
    cart_fab_style: String,
    cart_fab_animate: bool,
    vertical: String,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: String,
    pub loja_nome: String,
    pub responsavel_nome: String,
    pub whatsapp: String,
    pub email: String,
    /// `null` = conta criada mas ainda sem plano escolhido (ver
    /// ARQUITETURA.md §6) — o front mostra a tela de escolher plano nesse
    /// caso, em vez da seção de gerenciar plano.
    pub plano: Option<String>,
    pub valor_mensal: Option<f64>,
    pub billing_cycle: String,
    pub status: String,
    pub gateway: Option<String>,
    pub metodo_pagamento: Option<String>,
    pub slug: Option<String>,
    pub dominio: Option<String>,
    pub onboarding_status: String,
    pub tenant_id: Option<String>,
    pub assinante_desde: chrono::DateTime<chrono::Utc>,
    pub categoria: Option<String>,
    pub endereco: Option<String>,
    pub logo_url: Option<String>,
    pub cor_principal: Option<String>,
    pub documento: Option<String>,
    pub tipo_documento: Option<String>,
    pub vender_externamente: bool,
    pub whatsapp_habilitado: bool,
    pub forma_pagamento: String,
    pub plataforma_pagamento: Option<String>,
    /// True when payment platform credentials are registered (never the secret).
    pub has_plataforma_credenciais: bool,
    /// Masked Access Token for UI placeholder (e.g. `APP_USR-••••••••abcdef`). Never the full secret.
    pub plataforma_credenciais_mask: Option<String>,
    pub layout_style: String,
    pub instagram: Option<String>,
    pub facebook: Option<String>,
    pub endereco_numero: Option<String>,
    pub vende_mais_18: bool,
    pub apenas_retirada: bool,
    /// Ramo eletrônica: coleta do aparelho a reparar é cortesia.
    pub coleta_gratis: bool,
    /// Ramo eletrônica: entrega do aparelho reparado é cortesia.
    pub entrega_reparado_gratis: bool,
    pub pagamento_na_retirada: bool,
    pub entrega_somente_pix: bool,
    /// Preferência /meu-plano: força confirmação manual (sem QR Pix online).
    pub pagamento_manual: bool,
    pub coupon_code: Option<String>,
    /// Próxima cobrança / histórico de faturas dependem de consultar o
    /// gateway (Mercado Pago não expõe isso na mesma chamada de status) ou
    /// de um worker que registre cada cobrança recebida por webhook — não
    /// implementado ainda, por isso fica null em vez de um valor
    /// inventado. Ver ecommerce/README-TENANCY.md-style nota: melhor não
    /// mostrar um dado do que fingir um.
    pub proxima_cobranca: Option<String>,
    pub landing_headline: Option<String>,
    pub landing_sub: Option<String>,
    pub landing_badge: Option<String>,
    /// Essential: imagem retangular do hero (Management/Premium usam promo banners).
    pub landing_hero_image_url: Option<String>,
    pub cart_fab_style: String,
    pub cart_fab_animate: bool,
    /// True se cancelar agora gera estorno automático (≤7 dias desde assinante_desde).
    pub refund_eligible_on_cancel: bool,
    /// "ecommerce" | "eletronicos" — decide se "Ver minha loja" no painel
    /// aponta pro motor genérico ou pro módulo vrtech.
    pub vertical: String,
}

pub async fn me(State(state): State<AppState>, AuthSubscriber(claims): AuthSubscriber) -> Result<Json<MeResponse>, AppError> {
    let row: Option<SubscriberRow> = sqlx::query_as(
        "SELECT id, loja_nome, responsavel_nome, whatsapp, email, plan_code, valor_mensal,
                COALESCE(billing_cycle, 'mensal') as billing_cycle,
                status, gateway, slug, onboarding_status, tenant_id, created_at,
                categoria, endereco, logo_url, cor_principal, documento, tipo_documento,
                vender_externamente, whatsapp_habilitado, forma_pagamento, plataforma_pagamento,
                COALESCE(
                  NULLIF(trim(plataforma_credenciais->>'token'), ''),
                  NULL
                ) IS NOT NULL as has_plataforma_credenciais,
                NULLIF(trim(plataforma_credenciais->>'token'), '') as plataforma_credenciais_token,
                COALESCE(layout_style, 'ufersin') as layout_style, instagram, facebook, endereco_numero,
                COALESCE(vende_mais_18, false) as vende_mais_18,
                COALESCE(apenas_retirada, false) as apenas_retirada,
                COALESCE(coleta_gratis, false) as coleta_gratis,
                COALESCE(entrega_reparado_gratis, false) as entrega_reparado_gratis,
                COALESCE(pagamento_na_retirada, false) as pagamento_na_retirada,
                COALESCE(entrega_somente_pix, false) as entrega_somente_pix,
                COALESCE(pagamento_manual, false) as pagamento_manual, coupon_code,
                landing_headline, landing_sub, landing_badge, landing_hero_image_url,
                COALESCE(cart_fab_style, 'sacola') as cart_fab_style,
                COALESCE(cart_fab_animate, false) as cart_fab_animate,
                COALESCE(vertical, 'ecommerce') as vertical
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    let row = row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;

    // Recover stuck pendente/aguardando_pagamento when Pix/card already approved on MP
    // (user closed Assinar before poll / webhook lag).
    let (status, onboarding_status) = if matches!(
        row.status.as_str(),
        "pendente" | "sem_assinatura"
    ) || row.onboarding_status == "aguardando_pagamento"
    {
        match crate::routes::assinatura::sync_pending_subscription_payment(&state, &row.id).await {
            Ok(Some((st, onb))) => (st, onb),
            Ok(None) => (row.status.clone(), row.onboarding_status.clone()),
            Err(e) => {
                tracing::warn!("/api/me pending payment sync failed: {e:?}");
                (row.status.clone(), row.onboarding_status.clone())
            }
        }
    } else {
        (row.status.clone(), row.onboarding_status.clone())
    };

    let metodo_pagamento = row.gateway.as_deref().map(|_| "Cartão de crédito".to_string());
    let dominio = row.slug.as_ref().map(|s| format!("resolutoo.com/loja/?tenant={s}"));
    let refund_eligible_on_cancel = within_cancel_refund_window(row.created_at);

    Ok(Json(MeResponse {
        id: row.id,
        loja_nome: row.loja_nome,
        responsavel_nome: row.responsavel_nome,
        whatsapp: row.whatsapp,
        email: row.email,
        plano: row.plan_code,
        valor_mensal: row.valor_mensal,
        billing_cycle: row.billing_cycle,
        status,
        gateway: row.gateway,
        metodo_pagamento,
        slug: row.slug,
        dominio,
        onboarding_status,
        tenant_id: row.tenant_id,
        assinante_desde: row.created_at,
        categoria: row.categoria,
        endereco: row.endereco,
        logo_url: row.logo_url,
        cor_principal: row.cor_principal,
        documento: row.documento,
        tipo_documento: row.tipo_documento,
        vender_externamente: row.vender_externamente,
        whatsapp_habilitado: row.whatsapp_habilitado,
        forma_pagamento: row.forma_pagamento,
        plataforma_pagamento: row.plataforma_pagamento,
        has_plataforma_credenciais: row.has_plataforma_credenciais,
        plataforma_credenciais_mask: row
            .plataforma_credenciais_token
            .as_deref()
            .map(mask_mp_access_token)
            .filter(|s| !s.is_empty()),
        layout_style: row.layout_style,
        instagram: row.instagram,
        facebook: row.facebook,
        endereco_numero: row.endereco_numero,
        vende_mais_18: row.vende_mais_18,
        apenas_retirada: row.apenas_retirada,
        coleta_gratis: !row.apenas_retirada && row.coleta_gratis,
        entrega_reparado_gratis: !row.apenas_retirada && row.entrega_reparado_gratis,
        pagamento_na_retirada: row.pagamento_na_retirada,
        entrega_somente_pix: row.entrega_somente_pix,
        pagamento_manual: row.pagamento_manual,
        coupon_code: row.coupon_code,
        proxima_cobranca: None,
        landing_headline: row.landing_headline,
        landing_sub: row.landing_sub,
        landing_badge: row.landing_badge,
        landing_hero_image_url: row.landing_hero_image_url,
        cart_fab_style: row.cart_fab_style,
        cart_fab_animate: row.cart_fab_animate,
        refund_eligible_on_cancel,
        vertical: row.vertical,
    }))
}

fn within_cancel_refund_window(assinante_desde: chrono::DateTime<chrono::Utc>) -> bool {
    let age = chrono::Utc::now().signed_duration_since(assinante_desde);
    age.num_days() < 7
}

/// Safe UI hint for stored Mercado Pago Access Token (prefix + last 6). Never the full secret.
fn mask_mp_access_token(token: &str) -> String {
    let t = token.trim();
    if t.is_empty() {
        return String::new();
    }
    let last_n = 6usize.min(t.len());
    let last = &t[t.len() - last_n..];
    if t.starts_with("APP_USR-") {
        return format!("APP_USR-••••••••{last}");
    }
    if t.starts_with("TEST-") {
        return format!("TEST-••••••••{last}");
    }
    if t.len() > 12 {
        format!("{}••••••••{last}", &t[..8])
    } else {
        format!("••••••••{last}")
    }
}

/// Multipart upload ("file") → Supabase Storage → atualiza `logo_url`.
pub async fn upload_logo(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("upload inválido: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        if !content_type.starts_with("image/") {
            return Err(AppError::BadRequest("envie uma imagem (png, jpg, webp…)".to_string()));
        }
        let ext = storage::extension_for(&content_type);
        let filename = format!("logos/{}/{}.{}", claims.sub, Uuid::new_v4(), ext);
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("upload inválido: {e}")))?;
        if bytes.len() > 5 * 1024 * 1024 {
            return Err(AppError::BadRequest("logo deve ter no máximo 5 MB".to_string()));
        }

        let url = storage::upload_logo(&state, &filename, &content_type, bytes.to_vec()).await?;
        sqlx::query("UPDATE subscribers SET logo_url = $1, updated_at = now() WHERE id = $2")
            .bind(&url)
            .bind(&claims.sub)
            .execute(&state.pool)
            .await?;
        return Ok(Json(serde_json::json!({ "url": url })));
    }
    Err(AppError::BadRequest("campo file ausente no upload".to_string()))
}

#[derive(Debug, Deserialize)]
pub struct MudarSenhaInput {
    /// Nova senha em texto — hasheada aqui (Argon2) e empurrada pro admin
    /// da loja. Nunca logada. A sessão Supabase Auth já foi atualizada no
    /// front; este endpoint só mantém handoff + painel `/loja/admin` em sync.
    pub senha: String,
}

#[derive(Debug, Serialize)]
pub struct MudarSenhaOutput {
    pub synced: bool,
    /// True when the subscriber has no slug yet (loja ainda não provisionada).
    pub pending_loja: bool,
}

/// Trocar senha (Meu plano / redefinir): atualiza `subscribers.password_hash`
/// e sincroniza o admin do ecommerce. Se a loja já existe e o sync falhar,
/// devolve erro — o front NÃO deve dizer sucesso se o painel da loja não
/// abrir com a nova senha.
pub async fn mudar_senha(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<MudarSenhaInput>,
) -> Result<Json<MudarSenhaOutput>, AppError> {
    let senha = body.senha.trim();
    if senha.len() < 8 {
        return Err(AppError::BadRequest(
            "a senha precisa ter pelo menos 8 caracteres".to_string(),
        ));
    }

    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT email, responsavel_nome, slug FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (email, responsavel_nome, slug) =
        row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;

    let password_hash = hash_password(senha)?;
    sqlx::query("UPDATE subscribers SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(&password_hash)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    let Some(slug) = slug.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) else {
        // Ainda sem loja — hash fica pronto pro provision no onboarding.
        return Ok(Json(MudarSenhaOutput {
            synced: false,
            pending_loja: true,
        }));
    };

    crate::routes::onboarding::sync_ecommerce_admin_password(
        &state,
        &slug,
        email.trim(),
        &password_hash,
        Some(responsavel_nome.trim()),
    )
    .await?;

    Ok(Json(MudarSenhaOutput {
        synced: true,
        pending_loja: false,
    }))
}

#[derive(Debug, Deserialize)]
pub struct MudarPlanoInput {
    pub novo_plano: String,
}

/// Upgrade/downgrade — preço do banco + regras de cupom + sync no gateway.
pub async fn mudar_plano(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<MudarPlanoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let list_monthly = plans::monthly_price(&state.pool, &body.novo_plano).await?;

    let row: Option<(Option<String>, Option<String>, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT plan_code, gateway, mp_preapproval_id, COALESCE(billing_cycle, 'mensal'), coupon_kind \
         FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let Some((Some(plano_atual), gateway_kind, external_id, billing_cycle, coupon_kind)) = row else {
        return Err(AppError::BadRequest("assine um plano antes de trocar".to_string()));
    };

    if plano_atual == body.novo_plano {
        return Ok(Json(serde_json::json!({ "plano": body.novo_plano })));
    }

    // timed: downgrade perde desconto pra sempre; lifetime: upgrade remove.
    if plans::is_downgrade(&plano_atual, &body.novo_plano) && coupon_kind.as_deref() == Some("timed") {
        coupons::revoke_subscriber_coupon(&state.pool, &claims.sub, "downgrade").await?;
    }
    if plans::is_upgrade(&plano_atual, &body.novo_plano)
        && coupon_kind.as_deref() == Some("lifetime_current_plan")
    {
        coupons::revoke_subscriber_coupon(&state.pool, &claims.sub, "upgrade").await?;
    }

    let monthly =
        coupons::effective_monthly(&state.pool, &claims.sub, &body.novo_plano, list_monthly).await?;
    let cycle = BillingCycle::parse(&billing_cycle).unwrap_or(BillingCycle::Mensal);
    let charge = gateway::charge_amount(monthly, cycle);

    if let (Some(gw), Some(ext)) = (gateway_kind.as_deref(), external_id.as_deref()) {
        gateway::update_amount(&state, gw, ext, charge).await?;
    }

    sqlx::query(
        "UPDATE subscribers SET plan_code = $1, valor_mensal = $2, updated_at = now() WHERE id = $3",
    )
    .bind(&body.novo_plano)
    .bind(monthly)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "plano": body.novo_plano,
        "valor_mensal": monthly,
        "valor_cobrado_ciclo": charge,
    })))
}

#[derive(Debug, Deserialize)]
pub struct CancelarInput {
    /// Confirmação explícita (front envia true após digitar a frase).
    #[serde(default)]
    pub confirm: bool,
    /// Deve ser exatamente `quero cancelar` (case-sensitive).
    #[serde(default)]
    pub confirm_phrase: Option<String>,
    /// Motivos multi-select (códigos estáveis).
    #[serde(default)]
    pub reasons: Vec<String>,
    /// Texto opcional sob "encontrei outro sistema" (ex.: concorrente).
    #[serde(default)]
    pub competitor_note: Option<String>,
    /// Texto sob "Outro".
    #[serde(default)]
    pub other_note: Option<String>,
    /// Complemento livre opcional / motivo escrito.
    #[serde(default)]
    pub note: Option<String>,
}

const CANCEL_REASON_CODES: &[&str] = &["unexpected", "found_better", "other"];
const CANCEL_CONFIRM_PHRASE: &str = "quero cancelar";

pub async fn cancelar(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
    Json(body): Json<CancelarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.confirm_phrase.as_deref() != Some(CANCEL_CONFIRM_PHRASE) {
        return Err(AppError::BadRequest(
            "digite exatamente \"quero cancelar\" para confirmar".to_string(),
        ));
    }
    if !body.confirm {
        return Err(AppError::BadRequest(
            "confirmação de cancelamento obrigatória".to_string(),
        ));
    }
    if body.reasons.is_empty() {
        return Err(AppError::BadRequest("selecione pelo menos um motivo do cancelamento".to_string()));
    }
    for r in &body.reasons {
        if !CANCEL_REASON_CODES.contains(&r.as_str()) {
            return Err(AppError::BadRequest(format!("motivo inválido: {r}")));
        }
    }
    if body.reasons.iter().any(|r| r == "other") {
        let other = body.other_note.as_deref().unwrap_or("").trim();
        if other.is_empty() {
            return Err(AppError::BadRequest("descreva o motivo em \"Outro\"".to_string()));
        }
    }

    let row: Option<(
        Option<String>,
        Option<String>,
        chrono::DateTime<chrono::Utc>,
        String,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT gateway, mp_preapproval_id, created_at, status, slug FROM subscribers WHERE id = $1",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;
    let (gw, external_id, created_at, status, slug) =
        row.ok_or_else(|| AppError::NotFound("assinante não encontrado".to_string()))?;
    if status == "cancelado" {
        return Ok(Json(serde_json::json!({ "status": "cancelado", "refund_status": "not_applicable" })));
    }
    let Some(gw) = gw else {
        return Err(AppError::BadRequest("nenhuma assinatura pra cancelar".to_string()));
    };

    let refund_eligible = within_cancel_refund_window(created_at);
    let mut refund_status = if refund_eligible {
        "pending".to_string()
    } else {
        "not_applicable".to_string()
    };
    let mut refund_id: Option<String> = None;

    if refund_eligible {
        if let Some(external_id) = external_id.as_deref() {
            match gateway::refund_latest_subscription_payment(&state, &gw, external_id).await {
                Ok(Some(id)) => {
                    refund_status = "refunded".to_string();
                    refund_id = Some(id);
                }
                Ok(None) => {
                    // Sem cobrança localizável (mock / ainda não debitou) — cancela sem estorno.
                    refund_status = "not_applicable".to_string();
                }
                Err(e) => {
                    tracing::warn!("subscription refund failed (proceeding with cancel): {e:?}");
                    refund_status = "refund_failed".to_string();
                }
            }
        } else {
            refund_status = "not_applicable".to_string();
        }
    }

    if let Some(external_id) = external_id.as_deref() {
        gateway::cancel(&state, &gw, external_id).await;
    }

    let reasons_json = serde_json::json!({
        "reasons": body.reasons,
        "competitor_note": body.competitor_note.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        "other_note": body.other_note.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        "note": body.note.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    });
    let cancel_note = body.note.as_deref().map(str::trim).filter(|s| !s.is_empty());

    // Preserva plan_code / tenant_id / slug — só marca cancelado (loja offline até reassinar).
    sqlx::query(
        "UPDATE subscribers SET status = 'cancelado', updated_at = now(), \
         cancelled_at = now(), cancel_reasons = $2, cancel_note = $3, \
         cancel_refund_status = $4, cancel_refund_id = $5 \
         WHERE id = $1",
    )
    .bind(&claims.sub)
    .bind(&reasons_json)
    .bind(cancel_note)
    .bind(&refund_status)
    .bind(&refund_id)
    .execute(&state.pool)
    .await?;

    if let Some(slug) = slug.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(e) = crate::routes::onboarding::sync_ecommerce_tenant_status(&state, slug, "cancelado").await
        {
            tracing::warn!("sync ecommerce tenant offline after cancel failed: {e:?}");
        }
    }

    Ok(Json(serde_json::json!({
        "status": "cancelado",
        "refund_eligible": refund_eligible,
        "refund_status": refund_status,
        "refund_id": refund_id,
    })))
}
