//! Cliente PandaDoc — **somente** contrato do lojista (`platform_subscription`).
//! Checkout do cliente = checkbox local (nunca gasta cota PandaDoc).
//!
//! Estratégia atual: Free + Sandbox pra desenvolver.
//! Docs: https://developers.pandadoc.com/docs/getting-started
//! Embedded signing: https://developers.pandadoc.com/docs/embedded-signing
//! Webhooks: https://developers.pandadoc.com/docs/webhook-verification

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub struct PandadocConfig {
    pub api_key: Option<String>,
    /// Reserved for real HTTP calls when the platform template exists.
    #[allow(dead_code)]
    pub api_base: String,
    pub sandbox: bool,
    /// Único template PandaDoc em uso: contrato Resolutoo × lojista.
    pub platform_template_id: Option<String>,
    /// Shared key do webhook (Dev Center). Env: `PANDADOC_WEBHOOK_SHARED_KEY`
    /// ou alias `PANDADOC_WEBHOOK_SECRET`. Assinatura HMAC-SHA256 no query `signature`.
    pub webhook_shared_key: Option<String>,
}

impl PandadocConfig {
    pub fn from_env() -> Self {
        let api_key = std::env::var("PANDADOC_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let webhook_shared_key = env_opt("PANDADOC_WEBHOOK_SHARED_KEY")
            .or_else(|| env_opt("PANDADOC_WEBHOOK_SECRET"));
        Self {
            api_key,
            api_base: std::env::var("PANDADOC_API_BASE")
                .unwrap_or_else(|_| "https://api.pandadoc.com".to_string()),
            sandbox: std::env::var("PANDADOC_SANDBOX")
                .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
                .unwrap_or(true),
            platform_template_id: env_opt("PANDADOC_PLATFORM_TEMPLATE_ID"),
            webhook_shared_key,
        }
    }

    pub fn enabled(&self) -> bool {
        self.api_key.is_some()
    }

    /// Pronto pra tentar e-sign do lojista (chave + template).
    pub fn platform_signing_configured(&self) -> bool {
        self.enabled() && self.platform_template_id.is_some()
    }
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Verifica HMAC-SHA256 (hex) do body bruto com a shared key (PandaDoc).
/// Comparação em tempo constante.
pub fn verify_webhook_signature(shared_key: &str, body: &[u8], signature_hex: &str) -> bool {
    let Ok(mut mac) = HmacSha256::new_from_slice(shared_key.as_bytes()) else {
        return false;
    };
    mac.update(body);
    let expected = mac.finalize().into_bytes();
    let Ok(received) = hex::decode(signature_hex.trim()) else {
        return false;
    };
    if expected.len() != received.len() {
        return false;
    }
    bool::from(expected.as_slice().ct_eq(received.as_slice()))
}

/// Mapeia status PandaDoc (`document.completed`, etc.) → status interno de `contract_documents`.
pub fn map_document_status(pandadoc_status: &str) -> Option<&'static str> {
    match pandadoc_status.trim() {
        "document.draft" | "document.uploaded" => Some("draft"),
        "document.sent" => Some("sent"),
        "document.viewed" => Some("viewed"),
        "document.completed" => Some("completed"),
        "document.voided" => Some("voided"),
        "document.declined" => Some("declined"),
        _ => None,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub kind: String,
    pub signer_email: String,
    pub signer_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateSessionResponse {
    pub ready: bool,
    pub mode: &'static str,
    pub message: String,
    pub pandadoc_document_id: Option<String>,
    pub session_id: Option<String>,
    pub share_link: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub enabled: bool,
    pub sandbox: bool,
    pub platform_template_configured: bool,
    pub platform_signing_ready: bool,
    /// Checkout nunca usa PandaDoc nesta fase.
    pub checkout_uses_pandadoc: bool,
    pub message: String,
}

pub fn status(cfg: &PandadocConfig) -> StatusResponse {
    let platform_template_configured = cfg.platform_template_id.is_some();
    let platform_signing_ready = cfg.platform_signing_configured();
    let message = if !cfg.enabled() {
        "PandaDoc Free/Sandbox: defina PANDADOC_API_KEY (e PANDADOC_PLATFORM_TEMPLATE_ID) pra e-sign do lojista em /assinar. Checkout continua só com checkbox.".to_string()
    } else if !platform_template_configured {
        "API key ok — falta PANDADOC_PLATFORM_TEMPLATE_ID (template do contrato do lojista). Checkout sem PandaDoc.".to_string()
    } else {
        "PandaDoc configurado pro contrato do lojista (sandbox/free). Checkout: checkbox only.".to_string()
    };
    StatusResponse {
        enabled: cfg.enabled(),
        sandbox: cfg.sandbox,
        platform_template_configured,
        platform_signing_ready,
        checkout_uses_pandadoc: false,
        message,
    }
}

/// Só `platform_subscription`. Checkout kinds são rejeitados de propósito.
pub async fn create_signing_session(
    cfg: &PandadocConfig,
    _http: &reqwest::Client,
    req: &CreateSessionRequest,
) -> CreateSessionResponse {
    if req.kind != "platform_subscription" {
        return CreateSessionResponse {
            ready: false,
            mode: "checkout_checkbox_only",
            message: "Checkout do cliente não usa PandaDoc — só checkbox (compra normal / mais18). E-sign PandaDoc é exclusivo do contrato do lojista em /assinar.".to_string(),
            pandadoc_document_id: None,
            session_id: None,
            share_link: None,
        };
    }

    if !cfg.enabled() {
        return CreateSessionResponse {
            ready: false,
            mode: if cfg.sandbox {
                "sandbox_stub"
            } else {
                "production_stub"
            },
            message: "PandaDoc não configurado. Em /assinar use o checkbox local até preencher PANDADOC_API_KEY + PANDADOC_PLATFORM_TEMPLATE_ID (Free/Sandbox).".to_string(),
            pandadoc_document_id: None,
            session_id: None,
            share_link: None,
        };
    }

    if cfg.platform_template_id.is_none() {
        return CreateSessionResponse {
            ready: false,
            mode: if cfg.sandbox { "sandbox" } else { "production" },
            message: "Falta PANDADOC_PLATFORM_TEMPLATE_ID. Crie o template do contrato do lojista no PandaDoc Free/Sandbox e cole o ID.".to_string(),
            pandadoc_document_id: None,
            session_id: None,
            share_link: None,
        };
    }

    // Próximo passo (quando cláusulas existirem): POST /documents (from template) →
    // send silent → POST /documents/{id}/session → devolver session_id pro embed.
    let _ = (&req.signer_email, &req.signer_name, &cfg.platform_template_id);
    CreateSessionResponse {
        ready: false,
        mode: if cfg.sandbox { "sandbox" } else { "production" },
        message: "Template configurado; create-document/session ainda aguarda cláusulas no PandaDoc. Checkbox em /assinar continua válido.".to_string(),
        pandadoc_document_id: None,
        session_id: None,
        share_link: None,
    }
}
