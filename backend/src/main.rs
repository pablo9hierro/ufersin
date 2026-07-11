mod error;
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
        .expect("DATABASE_URL must be set (Postgres connection string do projeto Supabase dedicado do ufersin)");

    let mp_token = std::env::var("MP_ACCESS_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if mp_token.is_none() {
        tracing::warn!(
            "MP_ACCESS_TOKEN não configurado — rodando em modo MOCK (sem cobrança de verdade). \
             Precisa de uma conta Mercado Pago com o produto de Assinaturas aprovado pra sair do mock."
        );
    }

    let valor_padrao: f64 = std::env::var("PLANO_VALOR_MENSAL")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(99.0);

    let back_url = env_trimmed("BACK_URL");
    if back_url.is_empty() {
        tracing::warn!("BACK_URL não configurado — o lojista não vai ter pra onde voltar depois do checkout do Mercado Pago");
    }

    // Projeto Supabase dedicado só pro ufersin (diferente do projeto
    // compartilhado sunset/vrtech/juete) — sem outro site dividindo esse
    // banco, não precisa de schema próprio: usa o "public" padrão direto.
    let connect_options = PgConnectOptions::from_str(&database_url)?;
    let pool = PgPoolOptions::new().max_connections(5).connect_with(connect_options).await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState {
        pool,
        http: reqwest::Client::new(),
        mp_token: Arc::new(mp_token),
        valor_padrao,
        back_url: Arc::new(back_url),
    };

    let cors_origins: Vec<HeaderValue> = std::env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173".to_string())
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
        .route("/api/assinaturas", post(routes::criar_assinatura))
        .route("/api/assinaturas/{id}/status", get(routes::status_assinatura))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("ufersin_backend listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
