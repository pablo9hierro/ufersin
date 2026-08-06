use sqlx::PgPool;
use std::sync::Arc;

use crate::jwks::JwksVerifier;
use crate::mercadopago_oauth::MercadoPagoOAuthConfig;
use crate::pandadoc::PandadocConfig;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub http: reqwest::Client,
    /// Verifica localmente os tokens que o Supabase Auth emite pro lojista
    /// contra o JWKS público do projeto (chave assimétrica, ver jwks.rs) —
    /// nunca emite token nenhum daqui (ver auth.rs::AuthSubscriber).
    pub supabase_jwks: Arc<JwksVerifier>,
    /// None = modo mock (sem cobrança de verdade, só pra testar o fluxo
    /// sem uma conta Mercado Pago com o produto de assinaturas aprovado).
    pub mp_token: Arc<Option<String>>,
    /// None = camada AbacatePay em modo mock — ver gateway.rs/
    /// abacatepay_gateway.rs. Usado como fallback quando `MP_ACCESS_TOKEN`
    /// não está setado; com MP configurado, novas assinaturas Resolutoo
    /// vão pelo Mercado Pago (ver gateway::resolve_gateway_kind).
    pub abacatepay_token: Arc<Option<String>>,
    /// Preço padrão da assinatura mensal (R$), usado quando o formulário
    /// não especifica outro plano.
    pub valor_padrao: f64,
    /// Pra onde o Mercado Pago manda o lojista de volta depois de autorizar
    /// (ou desistir d)a assinatura no checkout hospedado deles.
    pub back_url: Arc<String>,
    /// Base URL + chave compartilhada do motor de e-commerce
    /// (ecommerce/backend) — usado só pra chamar POST
    /// /internal/provision-tenant no fim do onboarding. Nunca exposto ao
    /// navegador; é uma chamada backend-a-backend.
    pub ecommerce_internal_url: Arc<String>,
    pub ecommerce_internal_key: Arc<String>,
    /// PandaDoc (sandbox/prod). Sem API key = stub de contratos.
    pub pandadoc: PandadocConfig,
    /// Base URL do projeto Supabase (storage + JWKS).
    pub supabase_url: String,
    /// Service role — só server-side (upload de logo).
    pub supabase_service_key: String,
    /// `sandbox` | `production` | `` (auto via tokens). Ver PAYMENT_MODE.
    pub payment_mode: String,
    /// Public base URL of this API (no trailing slash), e.g.
    /// `https://ufersin-api-production.up.railway.app`. Used as Mercado Pago
    /// `notification_url` so Pix/card approvals activate without the browser
    /// staying open. From `PUBLIC_API_URL` or `https://{RAILWAY_PUBLIC_DOMAIN}`.
    pub public_api_url: Arc<String>,
    /// Conexão OAuth da conta Mercado Pago do lojista (ver mercadopago_oauth.rs)
    /// — substitui colar Access Token manual em Onboarding/Meu Plano.
    pub mercadopago_oauth: MercadoPagoOAuthConfig,
}
