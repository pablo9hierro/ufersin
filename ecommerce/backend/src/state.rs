use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: Arc<String>,
    pub http: reqwest::Client,
    /// Evolution API SERVER — one shared deployment for every tenant (spec:
    /// "as instâncias poderão estar no mesmo servidor"). Which INSTANCE on
    /// that server to use is per-tenant now (tenants.whatsapp_instance /
    /// "motoboy-<id>"), not global — see tenant::Tenant.
    pub evolution_api_url: Arc<String>,
    pub evolution_api_key: Arc<String>,
    pub abacatepay_key: Arc<Option<String>>,
    /// Chave da Google Routes API — GLOBAL e compartilhada por todos os
    /// tenants de propósito (nunca uma chave por loja). None = cai pro
    /// OSRM (rota) e pro heurístico de distância em linha reta em SQL
    /// (otimização de lote).
    pub google_routes_key: Arc<Option<String>>,
    /// This backend's own public URL (e.g. Railway domain), registered as
    /// the Evolution API webhook target so incoming WhatsApp messages
    /// (location shares) reach `/api/webhooks/evolution`.
    pub backend_public_url: Arc<String>,
    /// URL pública do frontend (Vercel), usada só pra montar o link de
    /// acompanhamento (/consultar?order=...) mandado no WhatsApp quando o
    /// motoboy sai pra entrega.
    pub frontend_public_url: Arc<String>,
    /// Supabase project URL + service_role key, used server-side only to
    /// upload product images to Supabase Storage (bypasses RLS — never
    /// send this key to the browser).
    pub supabase_url: Arc<String>,
    pub supabase_service_key: Arc<String>,
}
