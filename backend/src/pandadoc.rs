//! Cliente PandaDoc — **somente** contrato do lojista (`platform_subscription`).
//! Checkout do cliente = checkbox local (nunca gasta cota PandaDoc).
//!
//! Estratégia atual: Free + Sandbox pra desenvolver.
//! Docs: https://developers.pandadoc.com/docs/getting-started
//! Embedded signing: https://developers.pandadoc.com/docs/embedded-signing

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct PandadocConfig {
    pub api_key: Option<String>,
    /// Reserved for real HTTP calls when the platform template exists.
    #[allow(dead_code)]
    pub api_base: String,
    pub sandbox: bool,
    /// Único template PandaDoc em uso: contrato Resolutoo × lojista.
    pub platform_template_id: Option<String>,
}

impl PandadocConfig {
    pub fn from_env() -> Self {
        let api_key = std::env::var("PANDADOC_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Self {
            api_key,
            api_base: std::env::var("PANDADOC_API_BASE")
                .unwrap_or_else(|_| "https://api.pandadoc.com".to_string()),
            sandbox: std::env::var("PANDADOC_SANDBOX")
                .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
                .unwrap_or(true),
            platform_template_id: env_opt("PANDADOC_PLATFORM_TEMPLATE_ID"),
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
