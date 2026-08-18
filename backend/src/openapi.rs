// Documentação OpenAPI/Swagger dos serviços da plataforma Resolutoo (ufersin-api).
// Construída manualmente (sem macro por handler) porque o objetivo é documentar
// a API existente pra referência/testes, não recriar toda a tipagem de request/
// response — quem quiser detalhe de payload, ver os handlers em src/routes/*.rs.

use utoipa::openapi::path::{HttpMethod, Operation, OperationBuilder, Parameter, ParameterIn};
use utoipa::openapi::request_body::RequestBodyBuilder;
use utoipa::openapi::schema::{ObjectBuilder, SchemaType};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::openapi::{
    Components, Content, InfoBuilder, OpenApi, OpenApiBuilder, PathItem, PathsBuilder, RefOr,
    Required, Response, ResponseBuilder, Schema, SecurityRequirement, Server, Tag,
};

fn json_body(desc: &str) -> utoipa::openapi::request_body::RequestBody {
    RequestBodyBuilder::new()
        .description(Some(desc.to_string()))
        .content(
            "application/json",
            Content::new(Some(RefOr::T(Schema::Object(
                ObjectBuilder::new()
                    .schema_type(SchemaType::Type(utoipa::openapi::Type::Object))
                    .build(),
            )))),
        )
        .build()
}

fn ok_response(desc: &str) -> Response {
    ResponseBuilder::new().description(desc).build()
}

fn path_param(name: &str) -> Parameter {
    Parameter::builder()
        .name(name)
        .parameter_in(ParameterIn::Path)
        .description(Some(name.to_string()))
        .required(Required::True)
        .build()
}

fn op(summary: &str, tag: &str, auth: bool, body: bool) -> Operation {
    let mut b = OperationBuilder::new()
        .summary(Some(summary.to_string()))
        .tag(tag)
        .response("200", ok_response("OK"))
        .response("400", ok_response("Requisição inválida"))
        .response("401", ok_response("Não autenticado"));
    if body {
        b = b.request_body(Some(json_body(summary)));
    }
    if auth {
        b = b.security(SecurityRequirement::new("bearer_auth", Vec::<String>::new()));
    }
    b.build()
}

/// Rotas com o mesmo path atendendo múltiplos métodos (ex.: GET+POST no webhook)
/// precisam ser mescladas manualmente, já que `Paths::path` sobrescreve o item inteiro.
fn merge(paths: &mut utoipa::openapi::path::Paths, path: &str, method: HttpMethod, operation: Operation) {
    let new_item = PathItem::new(method, operation);
    if let Some(existing) = paths.paths.get_mut(path) {
        existing.merge_operations(new_item);
    } else {
        paths.paths.insert(path.to_string(), new_item);
    }
}

pub fn build() -> OpenApi {
    use HttpMethod::*;

    let mut paths = PathsBuilder::new().build();

    let routes: Vec<(&str, HttpMethod, &str, &str, bool, bool)> = vec![
        // (path, method, summary, tag, precisa_auth, tem_body)
        ("/health", Get, "Health check", "Sistema", false, false),
        ("/api/auth/bootstrap", Post, "Bootstrap de autenticação (primeiro acesso)", "Auth", false, true),
        ("/api/assinaturas", Post, "Criar assinatura de plano", "Assinaturas", false, true),
        ("/api/assinaturas/{id}/status", Get, "Status de uma assinatura", "Assinaturas", false, false),
        ("/api/assinaturas/simular-pagamento", Post, "Simular pagamento de assinatura (sandbox)", "Assinaturas", false, true),
        ("/api/assinaturas/pagar-cartao", Post, "Pagar assinatura no cartão", "Assinaturas", false, true),
        ("/api/assinaturas/cancelar-pendente", Post, "Cancelar assinatura pendente", "Assinaturas", false, true),
        ("/api/me", Get, "Dados do assinante logado", "Minha Conta", true, false),
        ("/api/me/plano", Post, "Trocar de plano", "Minha Conta", true, true),
        ("/api/me/senha", Post, "Alterar senha", "Minha Conta", true, true),
        ("/api/me/cancelar", Post, "Cancelar assinatura da própria loja", "Minha Conta", true, true),
        ("/api/me/upload-logo", Post, "Upload de logo da loja (multipart)", "Minha Conta", true, true),
        ("/api/onboarding", Post, "Provisionar nova loja (onboarding completo)", "Onboarding", false, true),
        ("/api/onboarding", Put, "Editar dados de onboarding de loja existente", "Onboarding", true, true),
        ("/api/mercadopago/oauth/start", Post, "Iniciar OAuth Mercado Pago do lojista", "Mercado Pago", true, true),
        ("/api/mercadopago/oauth/callback", Get, "Callback OAuth Mercado Pago (lojista)", "Mercado Pago", false, false),
        ("/api/mercadopago/oauth/disconnect", Post, "Desconectar Mercado Pago do lojista", "Mercado Pago", true, true),
        ("/api/superadmin/mercadopago/oauth/start", Post, "Iniciar OAuth Mercado Pago da plataforma", "Superadmin", true, true),
        ("/api/superadmin/mercadopago/oauth/disconnect", Post, "Desconectar Mercado Pago da plataforma", "Superadmin", true, true),
        ("/api/public/tenant-config/{slug}", Get, "Config pública de um tenant por slug", "Público", false, false),
        ("/api/public/contratos/catalog", Get, "Catálogo público de contratos/documentos", "Contratos", false, false),
        ("/api/public/contratos/accept-checkout", Post, "Aceitar contrato durante checkout", "Contratos", false, true),
        ("/api/contratos/me", Get, "Documentos/contratos do assinante logado", "Contratos", true, false),
        ("/api/contratos/accept", Post, "Aceitar contrato (assinante logado)", "Contratos", true, true),
        ("/api/public/contratos/pandadoc/status", Get, "Status de assinatura PandaDoc", "Contratos", false, false),
        ("/api/contratos/pandadoc/session", Post, "Criar sessão de assinatura PandaDoc", "Contratos", true, true),
        ("/api/webhooks/mercadopago", Get, "Webhook Mercado Pago (verificação)", "Webhooks", false, false),
        ("/api/webhooks/mercadopago", Post, "Webhook Mercado Pago (evento)", "Webhooks", false, true),
        ("/api/webhooks/pandadoc", Post, "Webhook PandaDoc", "Webhooks", false, true),
        ("/api/public/plans", Get, "Lista pública de planos", "Público", false, false),
        ("/api/public/content", Get, "Conteúdo público (landing/textos)", "Público", false, false),
        ("/api/public/coupons/preview", Post, "Pré-visualizar cupom de desconto", "Público", false, true),
        ("/api/superadmin/whoami", Get, "Identidade do superadmin logado", "Superadmin", true, false),
        ("/api/superadmin/overview", Get, "Visão geral da plataforma (métricas)", "Superadmin", true, false),
        ("/api/superadmin/mercadopago/status", Get, "Status do Mercado Pago da plataforma", "Superadmin", true, false),
        ("/api/superadmin/stores", Get, "Listar todas as lojas", "Superadmin", true, false),
        ("/api/superadmin/stores/{id}/coupon", Post, "Aplicar cupom a uma loja", "Superadmin", true, true),
        ("/api/superadmin/plans", Get, "Listar planos (admin)", "Superadmin", true, false),
        ("/api/superadmin/plans", Post, "Criar plano", "Superadmin", true, true),
        ("/api/superadmin/plans/{code}", Put, "Atualizar plano", "Superadmin", true, true),
        ("/api/superadmin/content", Put, "Atualizar conteúdo público", "Superadmin", true, true),
        ("/api/superadmin/costs", Get, "Listar custos operacionais", "Superadmin", true, false),
        ("/api/superadmin/costs", Post, "Criar custo operacional", "Superadmin", true, true),
        ("/api/superadmin/coupons", Get, "Listar cupons", "Superadmin", true, false),
        ("/api/superadmin/coupons", Post, "Criar cupom", "Superadmin", true, true),
        ("/api/superadmin/coupons/{id}", Put, "Atualizar cupom", "Superadmin", true, true),
        ("/api/superadmin/coupons/{id}", Delete, "Excluir cupom", "Superadmin", true, false),
        ("/api/me/assistant-ia/config", Get, "Configuração da Assistente IA da loja", "Assistente IA", true, false),
        ("/api/me/assistant-ia/config", Put, "Salvar configuração da Assistente IA", "Assistente IA", true, true),
        ("/api/me/assistant-ia/rag/documents", Get, "Listar exemplos de atendimento (RAG)", "Assistente IA", true, false),
        ("/api/me/assistant-ia/rag/documents", Post, "Enviar exemplo de atendimento (RAG, multipart)", "Assistente IA", true, true),
        ("/api/me/assistant-ia/rag/documents/{id}", Delete, "Excluir exemplo de atendimento (RAG)", "Assistente IA", true, false),
        ("/api/superadmin/ai-engines", Get, "Ranking de motores de IA da plataforma", "Superadmin", true, false),
        ("/api/superadmin/ai-engines", Post, "Adicionar motor de IA ao ranking", "Superadmin", true, true),
        ("/api/superadmin/ai-engines/order", Put, "Reordenar ranking de motores de IA", "Superadmin", true, true),
        ("/api/superadmin/ai-engines/{id}", Put, "Atualizar motor de IA", "Superadmin", true, true),
        ("/api/superadmin/ai-engines/{id}", Delete, "Remover motor de IA do ranking", "Superadmin", true, false),
    ];

    for (path, method, summary, tag, auth, body) in routes {
        let mut operation = op(summary, tag, auth, body);
        for seg in path.split('/') {
            if let Some(name) = seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                operation
                    .parameters
                    .get_or_insert_with(Vec::new)
                    .push(path_param(name));
            }
        }
        merge(&mut paths, path, method, operation);
    }

    let mut components = Components::new();
    components.security_schemes.insert(
        "bearer_auth".to_string(),
        SecurityScheme::Http(
            HttpBuilder::new()
                .scheme(HttpAuthScheme::Bearer)
                .bearer_format("JWT")
                .build(),
        ),
    );

    OpenApiBuilder::new()
        .info(
            InfoBuilder::new()
                .title("Resolutoo — API da Plataforma (ufersin-api)")
                .version(env!("CARGO_PKG_VERSION"))
                .description(Some(
                    "API central do Resolutoo (resolutoo.com): assinaturas, onboarding de lojas, \
                     Mercado Pago (lojista e plataforma), contratos/PandaDoc, superadmin e conteúdo \
                     público. Autenticação via Bearer JWT (Supabase Auth) nas rotas marcadas com cadeado.",
                ))
                .build(),
        )
        .servers(Some(vec![
            Server::new("https://ufersin-api-production.up.railway.app"),
            Server::new("http://localhost:8081"),
        ]))
        .paths(paths)
        .tags(Some(vec![
            Tag::new("Auth"),
            Tag::new("Assinaturas"),
            Tag::new("Minha Conta"),
            Tag::new("Onboarding"),
            Tag::new("Mercado Pago"),
            Tag::new("Contratos"),
            Tag::new("Webhooks"),
            Tag::new("Público"),
            Tag::new("Assistente IA"),
            Tag::new("Superadmin"),
            Tag::new("Sistema"),
        ]))
        .components(Some(components))
        .build()
}
