mod abacatepay_gateway;
mod auth;
mod error;
mod gateway;
mod jwks;
mod mercadopago;
mod routes;
mod state;

use std::str::FromStr;
use std::sync::Arc;

use axum::http::HeaderValue;
use axum::routing::{get, post};
use axum::Router;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use state::AppState;

fn env_trimmed(name: &str) -> String {
    std::env::var(name).unwrap_or_default().trim().to_string()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set (Postgres connection string — local por enquanto, ver docker-compose.yml)");

    let supabase_url = env_trimmed("SUPABASE_URL");
    if supabase_url.is_empty() {
        panic!(
            "SUPABASE_URL must be set (e.g. https://<project-ref>.supabase.co) — used to fetch \
             the project's public JWKS (Settings -> API -> JWT Keys) and verify tokens issued by \
             Supabase Auth. Without it, every authenticated request fails with 401."
        );
    }

    let mp_token = std::env::var("MP_ACCESS_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if mp_token.is_none() {
        tracing::warn!(
            "MP_ACCESS_TOKEN não configurado — rodando em modo MOCK (sem cobrança de verdade). \
             Precisa de uma conta Mercado Pago com o produto de Assinaturas aprovado pra sair do mock."
        );
    }

    let abacatepay_token = std::env::var("ABACATEPAY_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if abacatepay_token.is_none() {
        tracing::info!("ABACATEPAY_API_KEY not set — gateway AbacatePay em modo MOCK");
    }

    let valor_padrao: f64 = std::env::var("PLANO_VALOR_MENSAL")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(99.0);

    let back_url = env_trimmed("BACK_URL");
    if back_url.is_empty() {
        tracing::warn!("BACK_URL não configurado — o lojista não vai ter pra onde voltar depois do checkout do Mercado Pago");
    }

    // Chamada backend-a-backend pro motor de e-commerce, no fim do
    // onboarding — ver routes/onboarding.rs.
    let ecommerce_internal_url = env_trimmed("ECOMMERCE_INTERNAL_URL");
    let ecommerce_internal_key = env_trimmed("ECOMMERCE_INTERNAL_KEY");
    if ecommerce_internal_url.is_empty() || ecommerce_internal_key.is_empty() {
        tracing::warn!(
            "ECOMMERCE_INTERNAL_URL/ECOMMERCE_INTERNAL_KEY not set — onboarding won't be able to provision a tenant"
        );
    }

    // Banco local por enquanto (ver docker-compose.yml) — projeto Supabase
    // dedicado do ufersin (retmfoorwjwzuevaqlsr) fica pra quando a
    // integração real com Supabase acontecer. Schema "public" padrão, sem
    // schema próprio (banco não é compartilhado com outro app).
    let connect_options = PgConnectOptions::from_str(&database_url)?;
    let pool = PgPoolOptions::new().max_connections(5).connect_with(connect_options).await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let http = reqwest::Client::new();
    let supabase_jwks = jwks::JwksVerifier::new(&supabase_url, http.clone());

    let state = AppState {
        pool,
        http,
        supabase_jwks: Arc::new(supabase_jwks),
        mp_token: Arc::new(mp_token),
        abacatepay_token: Arc::new(abacatepay_token),
        valor_padrao,
        back_url: Arc::new(back_url),
        ecommerce_internal_url: Arc::new(ecommerce_internal_url),
        ecommerce_internal_key: Arc::new(ecommerce_internal_key),
    };

    let cors_origins: Vec<HeaderValue> = std::env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5174".to_string())
        .split(',')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().parse::<HeaderValue>())
        .collect::<Result<_, _>>()?;
    tracing::info!("CORS allowed origins: {:?}", cors_origins);

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(cors_origins))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/auth/bootstrap", post(routes::auth::bootstrap))
        .route("/api/assinaturas", post(routes::assinatura::assinar_plano))
        .route("/api/assinaturas/{id}/status", get(routes::assinatura::status_assinatura))
        .route(
            "/api/assinaturas/simular-pagamento",
            post(routes::assinatura::simular_pagamento),
        )
        .route("/api/me", get(routes::me::me))
        .route("/api/me/plano", post(routes::me::mudar_plano))
        .route("/api/me/cancelar", post(routes::me::cancelar))
        .route(
            "/api/onboarding",
            post(routes::onboarding::onboarding).put(routes::onboarding::editar_onboarding),
        )
        .route("/api/public/tenant-config/{slug}", get(routes::onboarding::tenant_config))
        .route("/api/webhooks/abacatepay", post(routes::webhooks::abacatepay_webhook))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("ufersin_backend (Rodoletas) listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
