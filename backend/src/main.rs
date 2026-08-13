mod auth;
mod coupons;
mod error;
mod gateway;
mod jwks;
mod mercadopago;
mod mercadopago_oauth;
mod openapi;
mod pandadoc;
mod plans;
mod routes;
mod state;
mod storage;

use std::str::FromStr;
use std::sync::Arc;

use axum::http::HeaderValue;
use axum::routing::{get, post, put};
use axum::Router;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use utoipa_swagger_ui::SwaggerUi;

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

    // Fallback legado — token colado direto no .env. Preferência real é a
    // conta OAuth da plataforma (`platform_payment_credentials`, ver abaixo,
    // carregada depois da migração criar a tabela).
    let mp_token_env = std::env::var("MP_ACCESS_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty());

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

    // Assinantes Resolutoo vivem em schema `resolutoo` (pooler role resolutoo_svc).
    // `public.subscribers` é legado sem layout_style — sem search_path o GET
    // público omite o campo e a vitrine sempre cai em ufersin.
    // Deploy bump: on-site Pix/card Assinar (no MP hosted redirect).
    let connect_options = PgConnectOptions::from_str(&database_url)?.options([("search_path", "resolutoo,public")]);
    let pool = PgPoolOptions::new().max_connections(5).connect_with(connect_options).await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    // Conta Mercado Pago DA PLATAFORMA (recebe assinaturas) — se já foi
    // conectada via OAuth (superadmin), prefere ela sobre MP_ACCESS_TOKEN.
    let db_mp_token: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT credenciais->>'token' FROM platform_payment_credentials WHERE id = 'default'",
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .flatten();
    let mp_token = db_mp_token.or(mp_token_env);
    if mp_token.is_none() {
        tracing::warn!(
            "Nenhuma conta Mercado Pago da plataforma conectada (nem OAuth nem MP_ACCESS_TOKEN) — \
             cobrança de assinatura rodando em modo MOCK (sem cobrança de verdade)."
        );
    }

    let http = reqwest::Client::new();
    let supabase_jwks = jwks::JwksVerifier::new(&supabase_url, http.clone());

    let pandadoc = pandadoc::PandadocConfig::from_env();
    tracing::info!("{}", pandadoc::status(&pandadoc).message);

    let mercadopago_oauth = mercadopago_oauth::MercadoPagoOAuthConfig::from_env();
    if !mercadopago_oauth.enabled() {
        tracing::warn!(
            "MERCADOPAGO_OAUTH_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI não configurados — \
             'Conectar Mercado Pago' vai falhar até isso ser setado"
        );
    }

    let supabase_service_key = env_trimmed("SUPABASE_SERVICE_ROLE_KEY");
    if supabase_service_key.is_empty() {
        tracing::warn!("SUPABASE_SERVICE_ROLE_KEY not set — upload de logo em /api/me/upload-logo vai falhar");
    }

    let payment_mode = env_trimmed("PAYMENT_MODE").to_ascii_lowercase();
    if payment_mode.is_empty() {
        tracing::info!(
            "PAYMENT_MODE not set — sandbox inferido de MP TEST-… / Abacate abc_dev_ / mock"
        );
    } else {
        tracing::info!("PAYMENT_MODE={payment_mode}");
    }

    let public_api_url = {
        let explicit = env_trimmed("PUBLIC_API_URL").trim_end_matches('/').to_string();
        if !explicit.is_empty() {
            explicit
        } else {
            let domain = env_trimmed("RAILWAY_PUBLIC_DOMAIN");
            if domain.is_empty() {
                String::new()
            } else {
                format!("https://{}", domain.trim_end_matches('/'))
            }
        }
    };
    if public_api_url.is_empty() {
        tracing::warn!(
            "PUBLIC_API_URL / RAILWAY_PUBLIC_DOMAIN unset — Pix/card payments won't set \
             Mercado Pago notification_url (activation will rely on browser poll + /api/me)"
        );
    } else {
        tracing::info!(
            "MP webhook notification_url base={public_api_url}/api/webhooks/mercadopago"
        );
    }

    let state = AppState {
        pool,
        http,
        supabase_jwks: Arc::new(supabase_jwks),
        mp_token: Arc::new(tokio::sync::RwLock::new(mp_token)),
        valor_padrao,
        back_url: Arc::new(back_url),
        ecommerce_internal_url: Arc::new(ecommerce_internal_url),
        ecommerce_internal_key: Arc::new(ecommerce_internal_key),
        pandadoc,
        supabase_url: supabase_url.clone(),
        supabase_service_key,
        payment_mode,
        public_api_url: Arc::new(public_api_url),
        mercadopago_oauth,
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
        .route(
            "/api/assinaturas/pagar-cartao",
            post(routes::assinatura::pagar_cartao),
        )
        .route(
            "/api/assinaturas/cancelar-pendente",
            post(routes::assinatura::cancelar_pendente),
        )
        .route("/api/me", get(routes::me::me))
        .route("/api/me/plano", post(routes::me::mudar_plano))
        .route("/api/me/senha", post(routes::me::mudar_senha))
        .route("/api/me/cancelar", post(routes::me::cancelar))
        .route("/api/me/upload-logo", post(routes::me::upload_logo))
        .route(
            "/api/onboarding",
            post(routes::onboarding::onboarding).put(routes::onboarding::editar_onboarding),
        )
        .route("/api/mercadopago/oauth/start", post(mercadopago_oauth::oauth_start))
        .route("/api/mercadopago/oauth/callback", get(mercadopago_oauth::oauth_callback))
        .route("/api/mercadopago/oauth/disconnect", post(mercadopago_oauth::oauth_disconnect))
        .route("/api/superadmin/mercadopago/oauth/start", post(mercadopago_oauth::oauth_start_platform))
        .route("/api/superadmin/mercadopago/oauth/disconnect", post(mercadopago_oauth::oauth_disconnect_platform))
        .route("/api/public/tenant-config/{slug}", get(routes::onboarding::tenant_config))
        .route("/api/public/contratos/catalog", get(routes::contratos::catalog))
        .route(
            "/api/public/contratos/accept-checkout",
            post(routes::contratos::accept_checkout),
        )
        .route("/api/contratos/me", get(routes::contratos::me_documents))
        .route("/api/contratos/accept", post(routes::contratos::accept))
        .route(
            "/api/public/contratos/pandadoc/status",
            get(routes::contratos::pandadoc_status),
        )
        .route(
            "/api/contratos/pandadoc/session",
            post(routes::contratos::pandadoc_session),
        )
        .route(
            "/api/webhooks/mercadopago",
            get(routes::webhooks::mercadopago_webhook).post(routes::webhooks::mercadopago_webhook),
        )
        .route("/api/webhooks/pandadoc", post(routes::webhooks::pandadoc_webhook))
        .route("/api/public/plans", get(routes::plans::list_public))
        .route("/api/public/content", get(routes::plans::list_content))
        .route("/api/public/coupons/preview", post(routes::plans::coupon_preview))
        .route("/api/superadmin/whoami", get(routes::superadmin::whoami))
        .route("/api/superadmin/overview", get(routes::superadmin::overview))
        .route("/api/superadmin/mercadopago/status", get(routes::superadmin::mercadopago_status))
        .route("/api/superadmin/stores", get(routes::superadmin::list_stores))
        .route(
            "/api/superadmin/stores/{id}/coupon",
            post(routes::superadmin::apply_coupon_to_store),
        )
        .route(
            "/api/superadmin/plans",
            get(routes::superadmin::list_plans_admin).post(routes::superadmin::create_plan),
        )
        .route("/api/superadmin/plans/{code}", put(routes::superadmin::update_plan))
        .route("/api/superadmin/content", put(routes::superadmin::upsert_content))
        .route("/api/superadmin/costs", get(routes::superadmin::list_costs).post(routes::superadmin::create_cost))
        .route(
            "/api/superadmin/coupons",
            get(routes::superadmin::list_coupons).post(routes::superadmin::create_coupon),
        )
        .route(
            "/api/superadmin/coupons/{id}",
            put(routes::superadmin::update_coupon).delete(routes::superadmin::delete_coupon),
        )
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Swagger só em ambiente local — RAILWAY_ENVIRONMENT só existe quando
    // rodando na Railway (produção). Evita expor a doc publicamente até
    // decisão explícita de subir pra produção.
    let app = if std::env::var("RAILWAY_ENVIRONMENT").is_err() {
        app.merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", openapi::build()))
    } else {
        app
    };
    let app = app.with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("ufersin_backend (Rodoletas) listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
