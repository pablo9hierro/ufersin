//! Conexão da conta Mercado Pago do lojista via OAuth (Authorization Code
//! Flow) — nunca pede Access Token/Client Secret manual. Troca lugar do
//! campo de colar token em Onboarding.tsx/MeuPlano.tsx (Financeiro).
//!
//! Docs: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation

use axum::extract::{Query, State};
use axum::response::Redirect;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::AuthSubscriber;
use crate::error::AppError;
use crate::state::AppState;

/// PKCE (RFC 7636) — a aplicação Mercado Pago do lojista pode exigir isso
/// no painel; sem mandar `code_challenge`/`code_verifier`, a autorização
/// falha (tela genérica de erro da própria Mercado Pago). `code_verifier`:
/// duas UUIDv4 sem hífen (64 chars, alfanumérico — dentro do charset e do
/// tamanho 43–128 exigidos pela RFC). `code_challenge` = base64url(sem
/// padding) do SHA-256 do verifier, method "S256".
fn generate_pkce_pair() -> (String, String) {
    let verifier = format!(
        "{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

const AUTHORIZE_URL: &str = "https://auth.mercadopago.com.br/authorization";
const TOKEN_URL: &str = "https://api.mercadopago.com/oauth/token";
/// `state` expira rápido — só precisa sobreviver ao tempo de o lojista
/// autorizar na tela da Mercado Pago, nunca fica pendurado.
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

/// Autenticado — gera o `state` (CSRF) vinculado ao assinante logado e
/// devolve a URL de autorização da Mercado Pago pro navegador redirecionar.
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
    sqlx::query(
        "INSERT INTO mercadopago_oauth_states (state, subscriber_id, code_verifier) VALUES ($1, $2, $3)",
    )
    .bind(&oauth_state)
    .bind(&claims.sub)
    .bind(&code_verifier)
    .execute(&state.pool)
    .await?;

    let authorize_url = format!(
        "{AUTHORIZE_URL}?client_id={}&response_type=code&platform_id=mp&redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(cfg.client_id.as_deref().unwrap_or_default()),
        urlencoding::encode(cfg.redirect_uri.as_deref().unwrap_or_default()),
        urlencoding::encode(&oauth_state),
        urlencoding::encode(&code_challenge),
    );

    Ok(axum::Json(OAuthStartOutput { authorize_url }))
}

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

fn frontend_redirect(cfg: &MercadoPagoOAuthConfig, status: &str) -> Redirect {
    let base = cfg.frontend_url.as_deref().unwrap_or("http://localhost:5174").trim_end_matches('/');
    Redirect::to(&format!("{base}/mercadopago/callback?status={status}"))
}

/// Público — a Mercado Pago redireciona o navegador do lojista pra cá depois
/// de autorizar (ou cancelar). Nunca confia em nada do corpo além do `code`;
/// troca por token direto na API da Mercado Pago.
pub async fn oauth_callback(State(state): State<AppState>, Query(q): Query<OAuthCallbackQuery>) -> Redirect {
    let cfg = &state.mercadopago_oauth;

    if let Some(mp_error) = q.error {
        tracing::warn!("mercadopago oauth callback: mercado pago retornou error={mp_error}");
        return frontend_redirect(cfg, "cancelled");
    }
    let (has_code, has_state) = (q.code.is_some(), q.state.is_some());
    let (Some(code), Some(oauth_state)) = (q.code, q.state) else {
        tracing::warn!("mercadopago oauth callback: code/state ausentes na query (code={has_code}, state={has_state})");
        return frontend_redirect(cfg, "error");
    };

    let row: Option<(String, String)> = sqlx::query_as(
        "DELETE FROM mercadopago_oauth_states \
         WHERE state = $1 AND created_at > now() - ($2 || ' minutes')::interval \
         RETURNING subscriber_id, code_verifier",
    )
    .bind(&oauth_state)
    .bind(STATE_TTL_MINUTES.to_string())
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    let Some((subscriber_id, code_verifier)) = row else {
        tracing::warn!("mercadopago oauth callback: state inválido ou expirado");
        return frontend_redirect(cfg, "error");
    };

    let (Some(client_id), Some(client_secret), Some(redirect_uri)) =
        (cfg.client_id.clone(), cfg.client_secret.clone(), cfg.redirect_uri.clone())
    else {
        return frontend_redirect(cfg, "error");
    };

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
            return frontend_redirect(cfg, "error");
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("mercadopago oauth token exchange rejected: {status} {body}");
        return frontend_redirect(cfg, "error");
    }

    let token: TokenResponse = match resp.json().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("mercadopago oauth token exchange: resposta inesperada: {e}");
            return frontend_redirect(cfg, "error");
        }
    };

    let expires_at = token
        .expires_in
        .map(|s| (chrono::Utc::now() + chrono::Duration::seconds(s)).to_rfc3339());
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

    let sync_row: Option<(String,)> = sqlx::query_as(
        "UPDATE subscribers SET \
           forma_pagamento = 'plataforma', plataforma_pagamento = 'mercado_pago', \
           plataforma_credenciais = $1, updated_at = now() \
         WHERE id = $2 \
         RETURNING slug",
    )
    .bind(&plataforma_credenciais)
    .bind(&subscriber_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    if let Some((slug,)) = sync_row {
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

    frontend_redirect(cfg, "success")
}

/// Autenticado — desconecta a conta Mercado Pago do lojista (limpa
/// credenciais + volta `forma_pagamento` pra 'manual', mesmo estado de
/// quem nunca conectou). Sincroniza com o ecommerce/backend igual ao
/// connect, pra loja parar de aceitar Pix/cartão via plataforma na hora.
pub async fn oauth_disconnect(
    State(state): State<AppState>,
    AuthSubscriber(claims): AuthSubscriber,
) -> Result<axum::Json<serde_json::Value>, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "UPDATE subscribers SET \
           forma_pagamento = 'manual', plataforma_pagamento = NULL, \
           plataforma_credenciais = NULL, updated_at = now() \
         WHERE id = $1 \
         RETURNING slug",
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((slug,)) = row {
        if !slug.trim().is_empty() {
            if let Err(e) = crate::routes::onboarding::sync_store_payment_credentials(
                &state, &slug, "manual", None, None,
            )
            .await
            {
                tracing::warn!("sync-payment-credentials after oauth disconnect failed: {e:?}");
            }
        }
    }

    Ok(axum::Json(serde_json::json!({ "disconnected": true })))
}
