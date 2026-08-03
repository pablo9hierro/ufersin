mod abacatepay;
mod auth;
mod error;
mod features;
mod google_routes;
mod models;
mod orders_common;
mod routes;
mod seed;
mod state;
mod status_flow;
mod storage;
mod tenant;
mod whatsapp;

use std::str::FromStr;
use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::HeaderValue;
use axum::routing::{get, patch, post, put};
use axum::Router;
use rand::Rng;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use state::AppState;

/// Reads an env var and trims whitespace/newlines — Railway (and copy-paste
/// in general) makes it easy to end up with a trailing "\n" on a pasted
/// secret, which silently breaks anything that puts the value in an HTTP
/// header (reqwest fails with an opaque "builder error" and no indication
/// it was a stray newline).
fn env_trimmed(name: &str) -> String {
    std::env::var(name).unwrap_or_default().trim().to_string()
}

fn random_secret() -> String {
    let mut rng = rand::thread_rng();
    (0..48)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set (Postgres connection string, e.g. Supabase)");

    let jwt_secret = match std::env::var("JWT_SECRET") {
        Ok(s) if !s.is_empty() => s,
        _ => {
            tracing::warn!(
                "JWT_SECRET not set — generating a random secret for this run (tokens won't survive a restart)"
            );
            random_secret()
        }
    };

    // EVOLUTION_INSTANCE is no longer read here — which instance a request
    // uses is per-tenant now (tenants.whatsapp_instance / "motoboy-<id>",
    // see backend/src/tenant.rs), not a single global value. The server
    // URL + management key stay global (one shared Evolution API
    // deployment for every tenant's instances).
    let evolution_api_url = env_trimmed("EVOLUTION_API_URL");
    let evolution_api_key = env_trimmed("EVOLUTION_API_KEY");
    if evolution_api_url.is_empty() || evolution_api_key.is_empty() {
        tracing::warn!(
            "EVOLUTION_API_URL/EVOLUTION_API_KEY not fully set — WhatsApp messages will only be logged, not sent"
        );
    }

    let abacatepay_key = std::env::var("ABACATEPAY_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty());

    if abacatepay_key.is_none() {
        tracing::info!("ABACATEPAY_API_KEY not set — running Pix in MOCK mode");
    } else {
        tracing::info!("ABACATEPAY_API_KEY set — using real AbacatePay API");
    }

    let google_routes_key = std::env::var("GOOGLE_ROUTES_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty());

    if google_routes_key.is_none() {
        tracing::info!("GOOGLE_ROUTES_API_KEY not set — routing falls back to OSRM / straight-line heuristic");
    } else {
        tracing::info!("GOOGLE_ROUTES_API_KEY set — using real Google Routes API");
    }

    // STORE_PICKUP_ADDRESS is no longer read here either — it's per-tenant
    // now (tenants.pickup_address). SEED_STORE_PICKUP_ADDRESS /
    // SEED_EVOLUTION_INSTANCE (read directly in seed.rs) are their
    // one-time-seed equivalents, used only the first time this database is
    // populated.

    // Registered as the Evolution API webhook target (see whatsapp::set_webhook)
    // so incoming location messages reach /api/webhooks/evolution. Without it,
    // instances still connect/send fine — only the "receive customer location"
    // feature is disabled.
    let backend_public_url = env_trimmed("BACKEND_PUBLIC_URL");
    if backend_public_url.is_empty() {
        tracing::warn!(
            "BACKEND_PUBLIC_URL not set — Evolution API webhooks won't be configured, so incoming WhatsApp location messages won't be captured"
        );
    }

    // Usado só pra montar o link de acompanhamento (/consultar?order=...)
    // na mensagem de "saiu pra entrega". Sem isso, a mensagem sai sem o link.
    let frontend_public_url = env_trimmed("FRONTEND_PUBLIC_URL");
    if frontend_public_url.is_empty() {
        tracing::warn!(
            "FRONTEND_PUBLIC_URL not set — the 'saiu pra entrega' WhatsApp message won't include a tracking link"
        );
    }

    // Autoriza a plataforma Rodoletas a chamar POST /internal/provision-tenant
    // no fim do onboarding de um lojista novo — ver routes/internal.rs.
    let internal_api_key = env_trimmed("INTERNAL_API_KEY");
    if internal_api_key.is_empty() {
        tracing::warn!(
            "INTERNAL_API_KEY not set — /internal/provision-tenant will reject every request until it's configured"
        );
    }

    // Server-side only — used to upload product images to Supabase Storage
    // (bypasses RLS). Never expose SUPABASE_SERVICE_ROLE_KEY to the frontend.
    let supabase_url = env_trimmed("SUPABASE_URL");
    let supabase_service_key = env_trimmed("SUPABASE_SERVICE_ROLE_KEY");
    if supabase_url.is_empty() || supabase_service_key.is_empty() {
        tracing::warn!(
            "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — product image upload will be disabled"
        );
    }

    // This Supabase project is shared with other apps (e.g. VRTech), which use
    // the default "public" schema with similarly-named tables (products,
    // categories, orders...). To avoid colliding with those, everything this
    // backend creates/reads lives in its own "sunset" schema instead —
    // `after_connect` sets search_path on every pooled connection so every
    // unqualified table name in our SQL resolves there, with no need to
    // schema-qualify each query by hand.
    let connect_options = PgConnectOptions::from_str(&database_url)?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("SET search_path TO sunset, public")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect_with(connect_options)
        .await?;

    sqlx::query("CREATE SCHEMA IF NOT EXISTS sunset")
        .execute(&pool)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    seed::seed_if_empty(&pool).await?;
    seed::seed_demo_tenant(&pool).await?;

    let http = reqwest::Client::new();

    let state = AppState {
        pool,
        jwt_secret: Arc::new(jwt_secret),
        http,
        evolution_api_url: Arc::new(evolution_api_url),
        evolution_api_key: Arc::new(evolution_api_key),
        abacatepay_key: Arc::new(abacatepay_key),
        google_routes_key: Arc::new(google_routes_key),
        backend_public_url: Arc::new(backend_public_url),
        frontend_public_url: Arc::new(frontend_public_url),
        supabase_url: Arc::new(supabase_url),
        supabase_service_key: Arc::new(supabase_service_key),
        internal_api_key: Arc::new(internal_api_key),
    };

    // CORS_ORIGINS: comma-separated list of allowed frontend origins. Defaults
    // to local dev plus the production domain this project deploys to.
    let cors_origins: Vec<HeaderValue> = std::env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| {
            "http://localhost:5173,https://resolutoo.com,https://www.resolutoo.com".to_string()
        })
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
        // auth
        .route("/api/auth/admin/login", post(routes::auth::admin_login))
        .route("/api/auth/motoboy/login", post(routes::auth::motoboy_login))
        // Demo pública da plataforma Rodoletas (/demo lá) — só enxerga o
        // tenant fixo "loja-demo" seedado por seed::seed_demo_tenant,
        // nunca uma loja real. Ver routes/demo.rs.
        .route("/demo/tokens", get(routes::demo::demo_tokens))
        // public / customer-facing — catálogo multi-tenant por slug (mesma
        // tabela sunset.* do admin). Pix/WhatsApp continuam aqui (segredo).
        .route(
            "/api/public/catalog/{slug}/products",
            get(routes::public::list_public_products),
        )
        .route(
            "/api/public/catalog/{slug}/products/{id}",
            get(routes::public::get_public_product),
        )
        .route(
            "/api/public/catalog/{slug}/categories",
            get(routes::public::list_public_categories),
        )
        .route(
            "/api/public/catalog/{slug}/product-sales-counts",
            get(routes::public::public_product_sales_counts),
        )
        .route(
            "/api/orders/{id}/create-pix-payment",
            post(routes::public::create_pix_payment),
        )
        .route(
            "/api/orders/{id}/refresh-payment",
            post(routes::public::refresh_payment),
        )
        .route(
            "/api/orders/{id}/simulate-pix-paid",
            post(routes::public::simulate_pix_paid),
        )
        .route("/api/orders/notify-created", post(routes::public::notify_order_created))
        .route(
            "/api/orders/{id}/notify-payment-received",
            post(routes::public::notify_payment_received),
        )
        .route("/api/pdv/notify-sale", post(routes::public::notify_pdv_sale))
        .route(
            "/api/pdv/notify-pix-charge",
            post(routes::public::notify_pdv_pix_charge),
        )
        .route("/api/pdv/products", get(routes::pdv::list_products))
        .route("/api/pdv/sales", post(routes::pdv::create_sale))
        .route("/api/pdv/relatorio", get(routes::pdv::relatorio))
        // Cliente deslogado que esqueceu a senha — dispara o código de 3
        // dígitos por WhatsApp (Evolution API só é alcançável daqui).
        .route(
            "/api/customer/request-password-reset",
            post(routes::public::request_customer_password_reset),
        )
        // Rota real entre dois pontos (Google Routes com fallback OSRM) —
        // usado tanto pela navegação do motoboy quanto pelo acompanhamento
        // do cliente em /consultar, pra nenhum dos dois expor chave nenhuma
        // no navegador.
        .route("/api/route", post(routes::public::compute_route))
        // admin
        .route(
            "/api/admin/categories",
            get(routes::admin::list_categories).post(routes::admin::create_category),
        )
        .route(
            "/api/admin/categories/{id}",
            put(routes::admin::update_category).delete(routes::admin::delete_category),
        )
        .route(
            "/api/admin/products",
            get(routes::admin::list_products).post(routes::admin::create_product),
        )
        .route(
            "/api/admin/products/{id}",
            get(routes::admin::get_product)
                .put(routes::admin::update_product)
                .delete(routes::admin::delete_product),
        )
        .route("/api/admin/products/upload-image", post(routes::admin::upload_product_image))
        .route(
            "/api/admin/motoboys",
            get(routes::admin::list_motoboys).post(routes::admin::create_motoboy),
        )
        .route(
            "/api/admin/motoboys/{id}",
            get(routes::admin::get_motoboy)
                .put(routes::admin::update_motoboy)
                .delete(routes::admin::delete_motoboy),
        )
        .route("/api/admin/orders", get(routes::admin::list_orders))
        .route(
            "/api/admin/orders/{id}/status",
            patch(routes::admin::update_order_status),
        )
        .route("/api/admin/financeiro", get(routes::admin::financeiro))
        .route("/api/admin/financeiro/lucro", get(routes::admin::financeiro_lucro))
        .route("/api/admin/whatsapp/status", get(routes::admin::whatsapp_status))
        .route("/api/admin/whatsapp/connect", get(routes::admin::whatsapp_connect))
        .route("/api/admin/whatsapp/logout", post(routes::admin::whatsapp_logout))
        .route(
            "/api/admin/whatsapp/connection-events",
            get(routes::admin::list_whatsapp_connection_events),
        )
        .route("/api/admin/whatsapp/notify-order-ready", post(routes::admin::notify_order_ready))
        .route("/api/admin/whatsapp/notify-coupon-grant", post(routes::admin::notify_coupon_grant))
        .route("/api/admin/store-status", get(routes::admin::get_store_status))
        .route("/api/admin/store-hours", axum::routing::put(routes::admin::set_store_hours))
        .route(
            "/api/admin/store-manual-status",
            axum::routing::put(routes::admin::set_store_manual_status),
        )
        .route("/api/admin/onboarding-gate", get(routes::admin::get_onboarding_gate))
        // motoboy
        // Otimiza a ordem de entrega do lote via Google Routes (distância
        // real de rua) antes de chamar sunset.motoboy_start_run — quando
        // não tem GOOGLE_ROUTES_API_KEY configurada ainda, deixa a própria
        // RPC decidir sozinha com o heurístico de linha reta de sempre.
        .route("/api/motoboy/runs/start", post(routes::motoboy::start_run))
        .route("/api/motoboy/orders", get(routes::motoboy::list_orders))
        .route(
            "/api/motoboy/orders/request-location",
            post(routes::motoboy::request_location),
        )
        .route(
            "/api/motoboy/orders/{id}/status",
            patch(routes::motoboy::update_order_status),
        )
        .route("/api/motoboy/whatsapp/status", get(routes::motoboy::whatsapp_status))
        .route("/api/motoboy/whatsapp/connect", get(routes::motoboy::whatsapp_connect))
        .route("/api/motoboy/whatsapp/logout", post(routes::motoboy::whatsapp_logout))
        .route(
            "/api/motoboy/whatsapp/notify-location-request",
            post(routes::motoboy::notify_location_request),
        )
        .route(
            "/api/motoboy/whatsapp/notify-en-route",
            post(routes::motoboy::notify_en_route),
        )
        // Público de propósito: é a Evolution API chamando, não um usuário
        // logado. Fica fora do CORS layer não importar (não é um browser).
        .route("/api/webhooks/evolution", post(routes::webhooks::evolution_webhook))
        // Backend-a-backend só (plataforma Rodoletas -> este motor),
        // protegido por INTERNAL_API_KEY em vez de JWT de usuário — ver
        // routes/internal.rs.
        .route("/internal/health", get(routes::internal::health))
        .route("/internal/provision-tenant", post(routes::internal::provision_tenant))
        .route("/internal/teardown-whatsapp", post(routes::internal::teardown_whatsapp))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Axum's próprio default é 2MB — baixo demais pra banner de campanha
        // (foto de marketing em boa resolução passa disso fácil, mesmo que a
        // foto de produto raramente passasse). 10MB cobre com folga.
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .with_state(state);

    // Bind to 0.0.0.0 so this also works inside a container (Railway etc, which
    // injects PORT); locally it's still reachable at http://localhost:<port>.
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("sonset_backend listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
// force-deploy 2026-08-01T17:21:26.3886384-03:00
