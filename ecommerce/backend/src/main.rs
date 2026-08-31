mod appointment_reminders;
mod auth;
mod cancel;
mod error;
mod features;
mod formulation;
mod geocode;
mod google_routes;
mod mercadopago;
mod mercadopago_link;
mod models;
mod openapi;
mod order_expiration;
mod orders_common;
mod rate_limit;
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
use utoipa_swagger_ui::SwaggerUi;
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
    // backend creates/reads lives in its own "loja" schema instead —
    // `after_connect` sets search_path on every pooled connection so every
    // unqualified table name in our SQL resolves there, with no need to
    // schema-qualify each query by hand. "sunset" is listed too as a
    // transition fallback (the schema's old name) so this same binary keeps
    // working whether it's deployed before or after the live rename — safe
    // to drop once the rename is confirmed stable.
    let connect_options = PgConnectOptions::from_str(&database_url)?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("SET search_path TO loja, sunset, public")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect_with(connect_options)
        .await?;

    // Prod may have an older checksum for 0001_init.sql after an accidental
    // in-place edit (entregas status belongs in 0011). Prefer booting with
    // public catalog routes over crash-looping on VersionMismatch.
    match sqlx::migrate!("./migrations").run(&pool).await {
        Ok(()) => {}
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("previously applied but has been modified") {
                tracing::error!(
                    "sqlx migration checksum mismatch (continuing): {msg}"
                );
            } else {
                return Err(e.into());
            }
        }
    }

    seed::seed_if_empty(&pool).await?;
    seed::seed_demo_tenant(&pool).await?;

    // Sem timeout, uma chamada travada (Mercado Pago, Evolution API, Google
    // Routes) prendia a requisição pra sempre — inclusive segurando uma
    // transação Postgres aberta o tempo todo nos handlers que chamam a MP
    // dentro de `tx` (create_card_link/create_card_payment). Client único
    // reaproveitado em todo o `state.http`.
    // OSRM público (router.project-osrm.org, fallback de calcular_rota sem
    // GOOGLE_ROUTES_API_KEY) devolve 403 pra requisição sem User-Agent —
    // reqwest não manda um por padrão. Sem isso, TODO cálculo de frete via
    // OSRM falha silenciosamente com "osrm route failed" (BUG-014).
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Resolutoo/1.0 (+https://resolutoo.com)")
        .build()
        .expect("failed to build reqwest client");

    let mercadopago_webhook_secret = std::env::var("MERCADOPAGO_WEBHOOK_SECRET")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if mercadopago_webhook_secret.is_none() {
        tracing::warn!(
            "MERCADOPAGO_WEBHOOK_SECRET não configurado — webhook do Mercado Pago vai aceitar sem \
             validar assinatura (ainda assim sempre rebusca o pagamento na API antes de gravar)"
        );
    }

    let state = AppState {
        pool,
        jwt_secret: Arc::new(jwt_secret),
        http,
        evolution_api_url: Arc::new(evolution_api_url),
        evolution_api_key: Arc::new(evolution_api_key),
        google_routes_key: Arc::new(google_routes_key),
        backend_public_url: Arc::new(backend_public_url),
        frontend_public_url: Arc::new(frontend_public_url),
        supabase_url: Arc::new(supabase_url),
        supabase_service_key: Arc::new(supabase_service_key),
        internal_api_key: Arc::new(internal_api_key),
        whatsapp_connect_cache: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        mercadopago_webhook_secret: Arc::new(mercadopago_webhook_secret),
        login_limiter: Arc::new(rate_limit::LoginAttemptLimiter::default()),
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
        .route("/api/auth/vendedor/login", post(routes::auth::vendedor_login))
        .route("/api/auth/cozinha/login", post(routes::auth::cozinha_login))
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
            "/api/public/catalog/{slug}/store-status",
            get(routes::public::get_public_store_status),
        )
        .route(
            "/api/public/tenant-vertical/{slug}",
            get(routes::public::get_public_tenant_vertical),
        )
        .route(
            "/api/public/catalog/{slug}/mp-public-key",
            get(routes::public::get_public_mp_key),
        )
        .route(
            "/api/public/catalog/{slug}/orders-by-phone/{phone}",
            get(routes::public::list_public_orders_by_phone),
        )
        .route(
            "/api/public/catalog/{slug}/assistant-order",
            post(routes::public::create_assistant_order),
        )
        .route(
            "/api/public/catalog/{slug}/estimate-delivery",
            post(routes::public::estimate_delivery),
        )
        .route(
            "/api/public/catalog/{slug}/appointments",
            post(routes::public::create_appointment),
        )
        .route(
            "/api/public/catalog/{slug}/appointments/by-phone/{phone}",
            get(routes::public::list_appointments_by_phone),
        )
        .route(
            "/api/public/catalog/{slug}/appointments/{id}",
            put(routes::public::update_appointment),
        )
        .route(
            "/api/public/catalog/{slug}/appointments/{id}/cancel",
            post(routes::public::cancel_appointment),
        )
        .route(
            "/api/public/catalog/{slug}/sitemap.xml",
            get(routes::public::get_public_sitemap),
        )
        .route(
            "/api/public/catalog/{slug}/services",
            get(routes::public::list_public_services),
        )
        .route(
            "/api/public/catalog/{slug}/services/{id}",
            get(routes::public::get_public_service),
        )
        .route(
            "/api/public/catalog/{slug}/sitemap-servicos.xml",
            get(routes::public::get_public_services_sitemap),
        )
        .route(
            "/api/public/eletronicos/{slug}/service-requests",
            post(routes::eletronicos::create_service_request_public),
        )
        .route(
            "/api/public/eletronicos/{slug}/consultar-otp",
            post(routes::eletronicos::consultar_otp_check),
        )
        .route(
            "/api/public/eletronicos/{slug}/consultar-verify",
            post(routes::eletronicos::consultar_otp_verify),
        )
        .route(
            "/api/public/eletronicos/{slug}/consultar-cancel",
            post(routes::eletronicos::consultar_cancel),
        )
        .route(
            "/api/public/eletronicos/{slug}/upload",
            post(routes::eletronicos::upload_public_media),
        )
        .route(
            "/api/public/eletronicos/{slug}/catalog",
            get(routes::eletronicos::get_public_catalog),
        )
        .route(
            "/api/public/eletronicos/{slug}/driver-location",
            get(routes::eletronicos::get_driver_location_public),
        )
        .route(
            "/api/admin/eletronicos/upload",
            post(routes::eletronicos::upload_admin_media),
        )
        .route(
            "/api/admin/eletronicos/service-orders/{id}/pdf",
            post(routes::eletronicos::set_service_order_pdf),
        )
        .route(
            "/api/admin/eletronicos/service-orders-closed",
            get(routes::eletronicos::list_closed_service_orders),
        )
        .route(
            "/api/admin/eletronicos/shipping-settings",
            get(routes::eletronicos::get_shipping_settings).put(routes::eletronicos::update_shipping_settings),
        )
        .route(
            "/api/admin/eletronicos/mercadopago-status",
            get(routes::eletronicos::get_mercadopago_status),
        )
        .route(
            "/api/admin/eletronicos/driver-location",
            get(routes::eletronicos::get_driver_location_admin).put(routes::eletronicos::update_driver_location),
        )
        .route(
            "/api/admin/eletronicos/service-requests/{id}/credential",
            get(routes::eletronicos::get_credential).put(routes::eletronicos::set_credential),
        )
        .route(
            "/api/admin/eletronicos/service-requests/{id}/diagnostic",
            get(routes::eletronicos::get_diagnostic).put(routes::eletronicos::save_diagnostic),
        )
        .route(
            "/api/admin/eletronicos/appointments/{id}/complete",
            post(routes::eletronicos::complete_appointment),
        )
        .route("/api/admin/eletronicos/agenda/day", get(routes::eletronicos::get_agenda_day))
        .route(
            "/api/admin/eletronicos/agenda/blocks",
            get(routes::eletronicos::list_agenda_blocks).post(routes::eletronicos::create_agenda_block),
        )
        .route(
            "/api/admin/eletronicos/agenda/blocks/{id}",
            axum::routing::delete(routes::eletronicos::delete_agenda_block),
        )
        .route(
            "/api/admin/eletronicos/catalog-categories",
            get(routes::eletronicos::list_admin_categories).post(routes::eletronicos::create_admin_category),
        )
        .route(
            "/api/admin/eletronicos/catalog-categories/{id}",
            put(routes::eletronicos::update_admin_category).delete(routes::eletronicos::delete_admin_category),
        )
        .route(
            "/api/admin/eletronicos/catalog-items",
            get(routes::eletronicos::list_admin_catalog_items).post(routes::eletronicos::create_admin_catalog_item),
        )
        .route(
            "/api/admin/eletronicos/catalog-items/{id}",
            put(routes::eletronicos::update_admin_catalog_item).delete(routes::eletronicos::delete_admin_catalog_item),
        )
        .route(
            "/api/admin/eletronicos/catalog-items/{id}/links",
            put(routes::eletronicos::save_service_item_links),
        )
        .route(
            "/api/admin/eletronicos/products-links/{id}",
            put(routes::eletronicos::save_product_links),
        )
        .route(
            "/api/admin/eletronicos/products-devices",
            get(routes::eletronicos::list_product_devices),
        )
        .route(
            "/api/admin/eletronicos/products-brands",
            get(routes::eletronicos::list_product_brands),
        )
        .route(
            "/api/admin/eletronicos/products-models",
            get(routes::eletronicos::list_product_models),
        )
        .route(
            "/api/admin/eletronicos/device-types",
            get(routes::eletronicos::list_device_types).post(routes::eletronicos::create_device_type),
        )
        .route(
            "/api/admin/eletronicos/device-types/{id}",
            put(routes::eletronicos::update_device_type).delete(routes::eletronicos::delete_device_type),
        )
        .route(
            "/api/admin/eletronicos/catalog-models",
            get(routes::eletronicos::list_catalog_models).post(routes::eletronicos::create_catalog_model),
        )
        .route(
            "/api/admin/eletronicos/catalog-models/{id}",
            put(routes::eletronicos::update_catalog_model).delete(routes::eletronicos::delete_catalog_model),
        )
        .route(
            "/api/admin/eletronicos/catalog-items-links",
            get(routes::eletronicos::list_item_devices),
        )
        .route(
            "/api/admin/eletronicos/catalog-items-brands",
            get(routes::eletronicos::list_item_brands),
        )
        .route(
            "/api/admin/eletronicos/catalog-items-models",
            get(routes::eletronicos::list_item_models),
        )
        .route(
            "/api/admin/eletronicos/catalog-items-parts",
            get(routes::eletronicos::list_item_parts),
        )
        .route(
            "/api/admin/eletronicos/catalog-items-extra-costs",
            get(routes::eletronicos::list_item_extra_costs),
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
            "/api/orders/{id}/card-link",
            post(routes::public::create_card_link),
        )
        .route(
            "/api/orders/{id}/card-payment",
            post(routes::public::create_card_payment),
        )
        .route(
            "/api/orders/{id}/simulate-pix-paid",
            post(routes::public::simulate_pix_paid),
        )
        .route(
            "/api/orders/{id}/cancel",
            post(routes::public::cancel_order),
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
        .route(
            "/api/pdv/notify-card-charge",
            post(routes::public::notify_pdv_card_charge),
        )
        .route("/api/pdv/products", get(routes::pdv::list_products))
        .route("/api/pdv/services", get(routes::pdv::list_services))
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
            "/api/admin/products/{id}/stock-entry",
            post(routes::admin::product_stock_entry),
        )
        .route(
            "/api/admin/products/erp-formulation",
            post(routes::admin::create_formulated_product),
        )
        .route(
            "/api/admin/products/{id}/erp-formulation",
            put(routes::admin::update_formulated_product),
        )
        .route(
            "/api/admin/ingredients",
            get(routes::admin::list_ingredients).post(routes::admin::create_ingredient),
        )
        .route(
            "/api/admin/ingredients/{id}",
            put(routes::admin::update_ingredient).delete(routes::admin::delete_ingredient),
        )
        .route(
            "/api/admin/ingredients/{id}/stock-entry",
            post(routes::admin::ingredient_stock_entry),
        )
        .route(
            "/api/admin/services",
            get(routes::admin::list_services).post(routes::admin::create_service),
        )
        .route(
            "/api/admin/services/{id}",
            put(routes::admin::update_service).delete(routes::admin::delete_service),
        )
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
        .route(
            "/api/admin/vendedores",
            get(routes::admin::list_vendedores).post(routes::admin::create_vendedor),
        )
        .route(
            "/api/admin/vendedores/{id}",
            put(routes::admin::update_vendedor).delete(routes::admin::delete_vendedor),
        )
        .route(
            "/api/admin/cozinha-users",
            get(routes::admin::list_cozinha_users).post(routes::admin::create_cozinha_user),
        )
        .route(
            "/api/admin/cozinha-users/{id}",
            put(routes::admin::update_cozinha_user).delete(routes::admin::delete_cozinha_user),
        )
        .route("/api/admin/orders", get(routes::admin::list_orders))
        .route(
            "/api/admin/orders/{id}/status",
            patch(routes::admin::update_order_status),
        )
        .route(
            "/api/admin/orders/{id}/cancel",
            post(routes::admin::cancel_order),
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
        .route(
            "/api/admin/assistant-ia/simulate-message",
            post(routes::admin::simulate_assistant_ia_message),
        )
        .route("/api/admin/assistant-ia/conversations", get(routes::admin::assistant_ia_conversations))
        .route(
            "/api/admin/assistant-ia/conversations/{id}/messages",
            get(routes::admin::assistant_ia_conversation_messages),
        )
        .route(
            "/api/admin/assistant-ia/conversations/{id}/assistant-enabled",
            put(routes::admin::assistant_ia_set_conversation_enabled),
        )
        .route(
            "/api/admin/assistant-ia/conversations/{id}",
            axum::routing::delete(routes::admin::assistant_ia_delete_conversation),
        )
        .route("/api/admin/store-status", get(routes::admin::get_store_status))
        .route("/api/admin/store-hours", axum::routing::put(routes::admin::set_store_hours))
        .route(
            "/api/admin/store-manual-status",
            axum::routing::put(routes::admin::set_store_manual_status),
        )
        .route(
            "/api/admin/shipping-settings",
            get(routes::admin::get_shipping_settings)
                .put(routes::admin::update_shipping_settings),
        )
        .route("/api/admin/message-templates", get(routes::admin::list_message_templates))
        .route(
            "/api/admin/message-templates/{key}",
            put(routes::admin::upsert_message_template),
        )
        .route("/api/admin/appointments", get(routes::admin::list_appointments))
        .route(
            "/api/admin/appointments/{id}/cancel",
            post(routes::admin::admin_cancel_appointment),
        )
        .route("/api/admin/onboarding-gate", get(routes::admin::get_onboarding_gate))
        // Vertical eletronicos (assistência técnica) -- fase 4.1 da
        // migração vrtech, ver docs/bugs/registry.yaml. CRUD + status de
        // service_requests; demais entidades (OS, agenda, PDV, templates,
        // assistente) entram em fases seguintes.
        .route(
            "/api/admin/eletronicos/service-requests",
            get(routes::eletronicos::list_service_requests).post(routes::eletronicos::create_service_request),
        )
        .route(
            "/api/admin/eletronicos/service-requests/{id}",
            get(routes::eletronicos::get_service_request),
        )
        .route(
            "/api/admin/eletronicos/service-requests/{id}/status",
            post(routes::eletronicos::update_service_request_status),
        )
        // Fase 4.2: ordem de servico (checklist/garantia/conclusao)
        .route(
            "/api/admin/eletronicos/service-requests/{request_id}/service-order",
            get(routes::eletronicos::get_or_create_service_order),
        )
        .route(
            "/api/admin/eletronicos/service-orders/{id}/checklist",
            post(routes::eletronicos::update_checklist),
        )
        .route(
            "/api/admin/eletronicos/service-requests/{id}/quote-value",
            patch(routes::eletronicos::update_quote_value),
        )
        .route(
            "/api/admin/eletronicos/service-orders/{id}/updates",
            get(routes::eletronicos::list_service_order_updates)
                .post(routes::eletronicos::add_service_order_update),
        )
        .route(
            "/api/admin/eletronicos/service-orders/{id}/complete",
            post(routes::eletronicos::complete_service_order),
        )
        .route(
            "/api/admin/eletronicos/service-orders/{id}/reopen",
            post(routes::eletronicos::reopen_service_order),
        )
        // Fase 4.3: agenda/appointments
        .route(
            "/api/admin/eletronicos/agenda/settings",
            get(routes::eletronicos::get_agenda_settings).put(routes::eletronicos::update_agenda_settings),
        )
        .route(
            "/api/admin/eletronicos/agenda/business-hours",
            get(routes::eletronicos::list_business_hours).put(routes::eletronicos::update_business_hours),
        )
        .route(
            "/api/admin/eletronicos/appointments",
            get(routes::eletronicos::list_appointments).post(routes::eletronicos::create_appointment),
        )
        .route(
            "/api/admin/eletronicos/appointments/{id}/cancel",
            post(routes::eletronicos::cancel_appointment),
        )
        .route(
            "/api/admin/eletronicos/appointments/{id}/reschedule",
            patch(routes::eletronicos::reschedule_appointment),
        )
        .route(
            "/api/admin/eletronicos/appointments/{id}/events",
            get(routes::eletronicos::list_appointment_events),
        )
        // Fase 4.4: estoque + PDV (Pix reaproveita /api/admin/pdv/pix, generico)
        .route(
            "/api/admin/eletronicos/stock-items",
            get(routes::eletronicos::list_stock_items).post(routes::eletronicos::create_stock_item),
        )
        .route(
            "/api/admin/eletronicos/stock-items/{id}/entry",
            post(routes::eletronicos::stock_entry),
        )
        .route(
            "/api/admin/eletronicos/stock-items/{id}/exit",
            post(routes::eletronicos::stock_exit),
        )
        .route(
            "/api/admin/eletronicos/stock-items/{id}",
            put(routes::eletronicos::update_stock_item).delete(routes::eletronicos::delete_stock_item),
        )
        .route(
            "/api/admin/eletronicos/stock-movements",
            get(routes::eletronicos::list_stock_movements),
        )
        .route(
            "/api/admin/eletronicos/stock-activity-log",
            get(routes::eletronicos::list_stock_activity_log),
        )
        .route(
            "/api/admin/eletronicos/error-log",
            get(routes::eletronicos::list_error_log).post(routes::eletronicos::report_client_error),
        )
        .route(
            "/api/admin/eletronicos/error-log/{id}/resolve",
            post(routes::eletronicos::resolve_error_log),
        )
        .route(
            "/api/admin/eletronicos/pdv/sales",
            post(routes::eletronicos::create_pdv_sale),
        )
        .route(
            "/api/admin/eletronicos/pdv/sales/{id}",
            get(routes::eletronicos::get_pdv_sale).delete(routes::eletronicos::cancel_pdv_sale),
        )
        .route(
            "/api/admin/eletronicos/pdv/sales/{id}/items",
            post(routes::eletronicos::add_sale_item),
        )
        .route(
            "/api/admin/eletronicos/pdv/sales/{id}/payments",
            post(routes::eletronicos::add_payment),
        )
        .route(
            "/api/admin/eletronicos/pdv/sales/{sale_id}/payments/{payment_id}/confirm",
            post(routes::eletronicos::confirm_payment),
        )
        .route(
            "/api/admin/eletronicos/templates",
            get(routes::eletronicos::list_whatsapp_templates),
        )
        .route(
            "/api/admin/eletronicos/templates/{key}",
            axum::routing::put(routes::eletronicos::update_whatsapp_template_content),
        )
        .route(
            "/api/admin/eletronicos/templates/{key}/toggle",
            axum::routing::patch(routes::eletronicos::toggle_whatsapp_template),
        )
        .route("/api/admin/pdv/pix", post(routes::admin::create_pdv_pix))
        .route(
            "/api/admin/pdv/pix/{payment_id}/status",
            get(routes::admin::get_pdv_pix_status),
        )
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
        .route(
            "/api/motoboy/orders/{id}/pix",
            post(routes::motoboy::create_motoboy_pix),
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
        .route("/api/webhooks/mercadopago", post(routes::webhooks::mercadopago_webhook))
        // Backend-a-backend só (plataforma Rodoletas -> este motor),
        // protegido por INTERNAL_API_KEY em vez de JWT de usuário — ver
        // routes/internal.rs.
        .route("/internal/health", get(routes::internal::health))
        .route("/internal/provision-tenant", post(routes::internal::provision_tenant))
        .route("/internal/teardown-whatsapp", post(routes::internal::teardown_whatsapp))
        .route(
            "/internal/sync-payment-credentials",
            post(routes::internal::sync_payment_credentials),
        )
        .route(
            "/internal/set-tenant-status",
            post(routes::internal::set_tenant_status),
        )
        .route(
            "/internal/sync-admin-password",
            post(routes::internal::sync_admin_password),
        )
        .route(
            "/internal/sync-pickup-address",
            post(routes::internal::sync_pickup_address),
        )
        .route(
            "/internal/sync-feature-flags",
            post(routes::internal::sync_feature_flags),
        )
        .route(
            "/internal/mint-admin-token",
            post(routes::internal::mint_admin_token),
        )
        .route(
            "/internal/pdv-order-sync",
            post(routes::internal::pdv_order_sync),
        )
        .route(
            "/internal/catalog-sync",
            post(routes::internal::catalog_sync),
        )
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Axum's próprio default é 2MB — baixo demais pra banner de campanha
        // (foto de marketing em boa resolução passa disso fácil, mesmo que a
        // foto de produto raramente passasse). 10MB cobre com folga.
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .with_state(state.clone());

    // Swagger em /api/docs — mesmo padrão (e mesma escotilha SWAGGER_DISABLED)
    // do ufersin-api. Documenta só a superfície da API: rota com cadeado
    // continua exigindo o mesmo Bearer JWT de admin/motoboy, e rota pública
    // continua resolvendo tenant pelo slug — publicar o contrato não afrouxa
    // autorização nenhuma.
    let swagger_off = std::env::var("SWAGGER_DISABLED")
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let app = if swagger_off {
        tracing::info!("SWAGGER_DISABLED — /api/docs não montado");
        app
    } else {
        app.merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", openapi::build()))
    };

    // Bind to 0.0.0.0 so this also works inside a container (Railway etc, which
    // injects PORT); locally it's still reachable at http://localhost:<port>.
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{port}");
    // Worker de disparo por atraso em agendamento (um tick por minuto,
    // cross-tenant) — ver appointment_reminders.rs.
    appointment_reminders::spawn(state.clone());
    // Worker de expiração de pagamento (Pix/link gerado e não pago em 30min
    // é cancelado sozinho) — ver order_expiration.rs.
    order_expiration::spawn(state);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("sonset_backend listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
// force-deploy 2026-08-01T17:21:26.3886384-03:00
// force rebuild 1786268253
// force rebuild 1787248127
