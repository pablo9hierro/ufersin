use sqlx::PgPool;
use std::sync::Arc;

use crate::demo_assistant::llm::DemoAiConfig;
use crate::demo_assistant::rate_limit::RateLimitConfig;
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
    /// Token da conta Mercado Pago DA PLATAFORMA (recebe as assinaturas dos
    /// lojistas — nunca a conta de um lojista). None = modo mock (sem
    /// cobrança de verdade). RwLock porque conectar/desconectar via OAuth
    /// (superadmin, ver mercadopago_oauth.rs) atualiza isso em memória na
    /// hora, sem precisar reiniciar o backend — carregado no boot a partir
    /// de `platform_payment_credentials` (ou de `MP_ACCESS_TOKEN` como
    /// fallback legado, ver main.rs).
    pub mp_token: Arc<tokio::sync::RwLock<Option<String>>>,
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
    /// Fallback OpenAI → OpenRouter da demo pública de IA (landing). Vazio
    /// = feature desliga com erro amigável, sem derrubar o resto do backend.
    pub demo_ai: DemoAiConfig,
    pub demo_rate_limit: RateLimitConfig,
}

impl AppState {
    /// Leitura não-bloqueante de `mp_token`, pra uso em funções síncronas
    /// (`sandbox_mode`, `resolve_gateway_kind`). Só existe escrita durante
    /// connect/disconnect via OAuth (ação rara de admin) — na prática o
    /// lock nunca está ocupado, então `try_read` sempre acha valor.
    pub fn mp_token_sync(&self) -> Option<String> {
        self.mp_token.try_read().ok().and_then(|g| g.clone())
    }
}
