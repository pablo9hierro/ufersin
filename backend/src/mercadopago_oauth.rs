//! Conexão via OAuth (Authorization Code Flow + PKCE) com Mercado Pago —
//! nunca pede Access Token/Client Secret manual. Dois fluxos totalmente
//! separados, que só compartilham a MESMA aplicação Mercado Pago
//! (client_id/secret/redirect_uri) e o MESMO endpoint de callback (pra não
//! precisar cadastrar um segundo redirect URI no painel da Mercado Pago):
//!
//! - **Lojista** (`oauth_start`/`oauth_disconnect`, `AuthSubscriber`): conecta
//!   a conta Mercado Pago DO LOJISTA — recebe as VENDAS da loja dele. Grava
//!   em `subscribers.plataforma_credenciais`. Usada pelo ecommerce/backend
//!   (Pix/cartão da loja), nunca pela cobrança de assinatura.
//! - **Plataforma** (`oauth_start_platform`/`oauth_disconnect_platform`,
//!   `AuthSuperadmin`): conecta a conta Mercado Pago DA PRÓPRIA RESOLUTOO —
//!   recebe as ASSINATURAS que os lojistas pagam pro plano. Grava em
//!   `platform_payment_credentials` (linha única) e atualiza
//!   `state.mp_token` em memória na hora (sem precisar reiniciar o backend)
//!   — é o token usado por `mercadopago.rs::create_subscription` e afins.
//!
//! `oauth_callback` é compartilhado: descobre qual dos dois fluxos é
//! olhando em qual tabela de estado (`mercadopago_oauth_states` vs
//! `platform_mercadopago_oauth_states`) o `state` (CSRF) foi encontrado.
//!
//! Docs: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation

use axum::extract::{Query, State};
use axum::response::Redirect;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::{AuthSubscriber, AuthSuperadmin};
use crate::error::AppError;
use crate::state::AppState;

/// PKCE (RFC 7636) — a aplicação Mercado Pago pode exigir isso no painel;
/// sem mandar `code_challenge`/`code_verifier`, a autorização falha (tela
/// genérica de erro da própria Mercado Pago). `code_verifier`: duas UUIDv4
/// sem hífen (64 chars, alfanumérico — dentro do charset e do tamanho
/// 43–128 exigidos pela RFC). `code_challenge` = base64url(sem padding) do
/// SHA-256 do verifier, method "S256".
fn generate_pkce_pair() -> (String, String) {
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

const AUTHORIZE_URL: &str = "https://auth.mercadopago.com.br/authorization";
const TOKEN_URL: &str = "https://api.mercadopago.com/oauth/token";
/// `state` expira rápido — só precisa sobreviver ao tempo de autorizar na
/// tela da Mercado Pago, nunca fica pendurado.
const STATE_TTL_MINUTES: i64 = 15;

#[derive(Debug, Clone)]
pub struct MercadoPagoOAuthConfig {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: Option<String>,
    /// Pra onde devolver o navegador depois do callback (origem do
    /// ufersin/frontend, sem path — ver `FRONTEND_URL`).
    pub frontend_url: Option<String>,
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl MercadoPagoOAuthConfig {
    pub fn from_env() -> Self {
        Self {
            client_id: env_opt("MERCADOPAGO_OAUTH_CLIENT_ID"),
            client_secret: env_opt("MERCADOPAGO_OAUTH_CLIENT_SECRET"),
            redirect_uri: env_opt("MERCADOPAGO_OAUTH_REDIRECT_URI"),
            frontend_url: env_opt("FRONTEND_URL"),
        }
    }

    pub fn enabled(&self) -> bool {
        self.client_id.is_some() && self.client_secret.is_some() && self.redirect_uri.is_some()
    }
}

#[derive(Debug, serde::Serialize)]
pub struct OAuthStartOutput {
    authorize_url: String,
}

fn build_authorize_url(cfg: &MercadoPagoOAuthConfig, oauth_state: &str, code_challenge: &str) -> String {
    format!(
        "{AUTHORIZE_URL}?client_id={}&response_type=code&platform_id=mp&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(cfg.client_id.as_deref().unwrap_or_default()),
        urlencoding::encode(cfg.redirect_uri.as_deref().unwrap_or_default()),
        urlencoding::encode(oauth_state),
        urlencoding::encode(code_challenge),
    )
}

// ---------------------------------------------------------------------
// Fluxo LOJISTA — conta que recebe as vendas da loja dele.
// ---------------------------------------------------------------------

/// Autenticado (lojista) — gera o `state` (CSRF) vinculado ao assinante
/// logado e devolve a URL de autorização da Mercado Pago.
pub async fn oauth_start(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<axum::Json<OAuthStartOutput>, AppError> {
    let cfg = &state.mercadopago_oauth;
    if !cfg.enabled() {
        return Err(AppError::Internal(
            "MERCADOPAGO_OAUTH_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI não configurados no servidor".to_string(),
        ));
    }

    // Sem isso, um `state` órfão de uma tentativa anterior (abandonada) ficaria
    // pendurado pra sempre — limpa qualquer coisa velha do mesmo assinante.
    sqlx::query("DELETE FROM mercadopago_oauth_states WHERE subscriber_id = $1")
        .bind(&claims.sub)
        .execute(&state.pool)
        .await?;

    let oauth_state = Uuid::new_v4().to_string();
    let (code_verifier, code_challenge) = generate_pkce_pair();
    sqlx::query("INSERT INTO mercadopago_oauth_states (state, subscriber_id, code_verifier) VALUES ($1, $2, $3)")
        .bind(&oauth_state)
        .bind(&claims.sub)
        .bind(&code_verifier)
        .execute(&state.pool)
        .await?;

    Ok(axum::Json(OAuthStartOutput {
        authorize_url: build_authorize_url(cfg, &oauth_state, &code_challenge),
    }))
}

/// Autenticado (lojista) — desconecta a conta Mercado Pago DO LOJISTA
/// (limpa credenciais + volta `forma_pagamento` pra 'manual'). Sincroniza
/// com o ecommerce/backend igual ao connect, pra loja parar de aceitar
/// Pix/cartão via plataforma na hora.
pub async fn oauth_disconnect(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<axum::Json<serde_json::Value>, AppError> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "UPDATE subscribers SET \
           forma_pagamento = 'manual', plataforma_pagamento = NULL, \
           plataforma_credenciais = NULL, updated_at = now() \
         WHERE id = $1 \
         RETURNING slug",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((Some(slug),)) = row {
        if !slug.trim().is_empty() {
            if let Err(e) =
                crate::routes::onboarding::sync_store_payment_credentials(&state, &slug, "manual", None, None).await
            {
                tracing::warn!("sync-payment-credentials after oauth disconnect failed: {e:?}");
            }
        }
    }

    Ok(axum::Json(serde_json::json!({ "disconnected": true })))
}

// ---------------------------------------------------------------------
// Fluxo PLATAFORMA — conta da própria Resolutoo, recebe as assinaturas.
// ---------------------------------------------------------------------

/// Autenticado (superadmin) — mesma ideia do fluxo do lojista, mas pra
/// conta da própria Resolutoo (recebe as assinaturas dos lojistas).
pub async fn oauth_start_platform(
    State(state): State<AppState>,
    AuthSuperadmin(_claims): AuthSuperadmin,
) -> Result<axum::Json<OAuthStartOutput>, AppError> {
    let cfg = &state.mercadopago_oauth;
    if !cfg.enabled() {
        return Err(AppError::Internal(
            "MERCADOPAGO_OAUTH_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI não configurados no servidor".to_string(),
        ));
    }

    // Só existe uma conta de plataforma — limpa qualquer tentativa velha.
    sqlx::query("DELETE FROM platform_mercadopago_oauth_states").execute(&state.pool).await?;

    let oauth_state = Uuid::new_v4().to_string();
    let (code_verifier, code_challenge) = generate_pkce_pair();
    sqlx::query("INSERT INTO platform_mercadopago_oauth_states (state, code_verifier) VALUES ($1, $2)")
        .bind(&oauth_state)
        .bind(&code_verifier)
        .execute(&state.pool)
        .await?;

    Ok(axum::Json(OAuthStartOutput {
        authorize_url: build_authorize_url(cfg, &oauth_state, &code_challenge),
    }))
}

/// Autenticado (superadmin) — desconecta a conta Mercado Pago DA
/// PLATAFORMA. Zera o token em memória imediatamente: novas cobranças de
/// assinatura passam a cair em modo mock até reconectar (nunca ficam
/// "penduradas" usando um token velho já desconectado).
pub async fn oauth_disconnect_platform(
    State(state): State<AppState>,
    AuthSuperadmin(_claims): AuthSuperadmin,
) -> Result<axum::Json<serde_json::Value>, AppError> {
    sqlx::query(
        "UPDATE platform_payment_credentials SET credenciais = NULL, updated_at = now() WHERE id = 'default'",
    )
    .execute(&state.pool)
    .await?;
    *state.mp_token.write().await = None;

    Ok(axum::Json(serde_json::json!({ "disconnected": true })))
}

// ---------------------------------------------------------------------
// Callback compartilhado — a Mercado Pago só conhece UM redirect_uri.
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    public_key: Option<String>,
    user_id: Option<serde_json::Value>,
    expires_in: Option<i64>,
    live_mode: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct MpUserIdentification {
    number: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpUserResponse {
    identification: Option<MpUserIdentification>,
}

/// Busca CPF/CNPJ direto da conta Mercado Pago conectada — nunca pedimos
/// esse dado por input manual quando a MP já entrega (ver `identification`
/// em `GET /users/:user_id`, confirmado contra a API real: mesmo objeto
/// `{number, type}` usado nos endpoints de pagador). Best-effort: qualquer
/// falha aqui não derruba a conexão OAuth, só deixa o documento como estava.
/// Só faz sentido pro fluxo do LOJISTA (documento da loja); a plataforma
/// não usa isso.
async fn fetch_mp_identification(http: &reqwest::Client, access_token: &str, user_id: &str) -> Option<(String, String)> {
    let resp = http
        .get(format!("https://api.mercadopago.com/users/{user_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: MpUserResponse = resp.json().await.ok()?;
    let ident = body.identification?;
    let number: String = ident.number?.chars().filter(|c| c.is_ascii_digit()).collect();
    let tipo = match ident.kind?.to_uppercase().as_str() {
        "CPF" => "cpf",
        "CNPJ" => "cnpj",
        _ => return None,
    };
    if number.is_empty() {
        return None;
    }
    Some((number, tipo.to_string()))
}

fn frontend_redirect(cfg: &MercadoPagoOAuthConfig, status: &str, flow: &str) -> Redirect {
    let base = cfg.frontend_url.as_deref().unwrap_or("http://localhost:5174").trim_end_matches('/');
    Redirect::to(&format!("{base}/mercadopago/callback?status={status}&flow={flow}"))
}

/// Troca o `code` por token direto na API da Mercado Pago. Compartilhado
/// pelos dois fluxos — a chamada é idêntica, só o que se faz com o token
/// resultante muda.
async fn exchange_oauth_token(
    state: &AppState,
    cfg: &MercadoPagoOAuthConfig,
    code: &str,
    code_verifier: &str,
) -> Option<TokenResponse> {
    let (client_id, client_secret, redirect_uri) =
        (cfg.client_id.clone()?, cfg.client_secret.clone()?, cfg.redirect_uri.clone()?);

    let resp = match state
        .http
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("mercadopago oauth token exchange failed: {e}");
            return None;
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("mercadopago oauth token exchange rejected: {status} {body}");
        return None;
    }

    match resp.json().await {
        Ok(t) => Some(t),
        Err(e) => {
            tracing::error!("mercadopago oauth token exchange: resposta inesperada: {e}");
            None
        }
    }
}

/// Público — a Mercado Pago redireciona o navegador pra cá depois de
/// autorizar (ou cancelar), tanto pro fluxo do lojista quanto da
/// plataforma. Nunca confia em nada do corpo além do `code`; troca por
/// token direto na API da Mercado Pago. Descobre qual fluxo é pela tabela
/// de estado onde o `state` (CSRF) foi encontrado.
pub async fn oauth_callback(State(state): State<AppState>, Query(q): Query<OAuthCallbackQuery>) -> Redirect {
    let cfg = &state.mercadopago_oauth;

    if let Some(mp_error) = q.error {
        tracing::warn!("mercadopago oauth callback: mercado pago retornou error={mp_error}");
        return frontend_redirect(cfg, "cancelled", "subscriber");
    }
    let (has_code, has_state) = (q.code.is_some(), q.state.is_some());
    let (Some(code), Some(oauth_state)) = (q.code, q.state) else {
        tracing::warn!("mercadopago oauth callback: code/state ausentes na query (code={has_code}, state={has_state})");
        return frontend_redirect(cfg, "error", "subscriber");
    };

    // Tenta o fluxo do LOJISTA primeiro.
    let subscriber_row: Option<(String, String)> = sqlx::query_as(
        "DELETE FROM mercadopago_oauth_states \
         WHERE state = $1 AND created_at > now() - ($2 || ' minutes')::interval \
         RETURNING subscriber_id, code_verifier",
    )
    .bind(&oauth_state)
    .bind(STATE_TTL_MINUTES.to_string())
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    if let Some((subscriber_id, code_verifier)) = subscriber_row {
        let Some(token) = exchange_oauth_token(&state, cfg, &code, &code_verifier).await else {
            return frontend_redirect(cfg, "error", "subscriber");
        };

        let expires_at = token.expires_in.map(|s| (chrono::Utc::now() + chrono::Duration::seconds(s)).to_rfc3339());
        let plataforma_credenciais = serde_json::json!({
            "token": token.access_token,
            "refresh_token": token.refresh_token,
            "public_key": token.public_key,
            "user_id": token.user_id,
            "expires_at": expires_at,
            "connected_at": chrono::Utc::now().to_rfc3339(),
            "connection_status": if token.live_mode.unwrap_or(true) { "production" } else { "sandbox" },
            "source": "oauth",
        });

        let user_id_str = token.user_id.as_ref().and_then(|v| match v {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Number(n) => Some(n.to_string()),
            _ => None,
        });
        let identification = match &user_id_str {
            Some(uid) => fetch_mp_identification(&state.http, &token.access_token, uid).await,
            None => None,
        };
        let (mp_documento, mp_tipo_documento) = match identification {
            Some((num, tipo)) => (Some(num), Some(tipo)),
            None => (None, None),
        };

        let sync_row: Option<(Option<String>,)> = sqlx::query_as(
            "UPDATE subscribers SET \
               forma_pagamento = 'plataforma', plataforma_pagamento = 'mercado_pago', \
               plataforma_credenciais = $1, \
               documento = COALESCE($3, documento), tipo_documento = COALESCE($4, tipo_documento), \
               updated_at = now() \
             WHERE id = $2 \
             RETURNING slug",
        )
        .bind(&plataforma_credenciais)
        .bind(&subscriber_id)
        .bind(&mp_documento)
        .bind(&mp_tipo_documento)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);

        if let Some((Some(slug),)) = sync_row {
            if !slug.trim().is_empty() {
                if let Err(e) = crate::routes::onboarding::sync_store_payment_credentials(
                    &state,
                    &slug,
                    "plataforma",
                    Some("mercado_pago"),
                    Some(&plataforma_credenciais),
                )
                .await
                {
                    tracing::warn!("sync-payment-credentials after oauth connect failed: {e:?}");
                }
            }
        }

        return frontend_redirect(cfg, "success", "subscriber");
    }

    // Não era o fluxo do lojista — tenta o fluxo da PLATAFORMA.
    let platform_row: Option<(String,)> = sqlx::query_as(
        "DELETE FROM platform_mercadopago_oauth_states \
         WHERE state = $1 AND created_at > now() - ($2 || ' minutes')::interval \
         RETURNING code_verifier",
    )
    .bind(&oauth_state)
    .bind(STATE_TTL_MINUTES.to_string())
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    let Some((code_verifier,)) = platform_row else {
        tracing::warn!("mercadopago oauth callback: state inválido ou expirado (nenhum dos dois fluxos)");
        return frontend_redirect(cfg, "error", "subscriber");
    };

    let Some(token) = exchange_oauth_token(&state, cfg, &code, &code_verifier).await else {
        return frontend_redirect(cfg, "error", "platform");
    };

    let expires_at = token.expires_in.map(|s| (chrono::Utc::now() + chrono::Duration::seconds(s)).to_rfc3339());
    let credenciais = serde_json::json!({
        "token": token.access_token,
        "refresh_token": token.refresh_token,
        "public_key": token.public_key,
        "user_id": token.user_id,
        "expires_at": expires_at,
        "connected_at": chrono::Utc::now().to_rfc3339(),
        "connection_status": if token.live_mode.unwrap_or(true) { "production" } else { "sandbox" },
        "source": "oauth",
    });

    if let Err(e) = sqlx::query(
        "INSERT INTO platform_payment_credentials (id, provider, credenciais, updated_at) \
         VALUES ('default', 'mercado_pago', $1, now()) \
         ON CONFLICT (id) DO UPDATE SET credenciais = EXCLUDED.credenciais, updated_at = now()",
    )
    .bind(&credenciais)
    .execute(&state.pool)
    .await
    {
        tracing::error!("failed to persist platform mercadopago credentials: {e:?}");
        return frontend_redirect(cfg, "error", "platform");
    }

    // Efeito na hora — sem isso, a cobrança de assinatura só pegaria o
    // token novo depois de reiniciar o backend.
    *state.mp_token.write().await = Some(token.access_token);

    frontend_redirect(cfg, "success", "platform")
}
