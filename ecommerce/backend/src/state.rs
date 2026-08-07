use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

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
    /// Chave compartilhada que autoriza a plataforma Rodoletas (ufersin/
    /// backend) a chamar POST /internal/provision-tenant — nunca chega ao
    /// navegador, é uma chamada backend-a-backend só.
    pub internal_api_key: Arc<String>,
    /// Cache curto (por instance name) da última resposta de
    /// `whatsapp::connect` — várias abas/dispositivos abertos na tela
    /// "Reconecte o WhatsApp" (cada um com seu próprio poll de 4s/25s, ver
    /// WhatsAppConnection.tsx) podiam somar chamadas concorrentes a
    /// `POST /instance/create` + `GET /instance/connect` na MESMA instância
    /// rápido demais pro Evolution API aguentar — confirmado em produção
    /// causando um loop de reinicialização de canal várias vezes por
    /// segundo (ChannelStartupService sem parar), até depois de deletar a
    /// instância manualmente. Isso colapsa qualquer rajada de chamadas pra
    /// no máximo 1 chamada real por instância a cada WHATSAPP_CONNECT_COOLDOWN.
    pub whatsapp_connect_cache: Arc<Mutex<HashMap<String, (Instant, serde_json::Value)>>>,
    /// Secret da aplicação Mercado Pago (painel → Webhooks → "Assinatura
    /// secreta") — valida `x-signature` no webhook. Uma única aplicação MP
    /// pra toda a Resolutoo, não é por tenant. None = webhook aceita sem
    /// validar assinatura (ainda assim sempre rebusca o pagamento na API da
    /// MP antes de gravar qualquer coisa — nunca confia só no corpo).
    pub mercadopago_webhook_secret: Arc<Option<String>>,
}
