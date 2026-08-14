//! Documentação OpenAPI/Swagger completa da plataforma Resolutoo (ufersin-api):
//! assinatura de plano, onboarding de lojista, OAuth do Mercado Pago (lojista e
//! plataforma), webhooks de pagamento, contratos/PandaDoc, conteúdo público e
//! painel do superadmin.
//!
//! Construída pelo builder do utoipa (não por macro em cada handler) pra
//! documentar a API existente sem anotar handler por handler.

use utoipa::openapi::path::{HttpMethod, Operation, OperationBuilder, Parameter, ParameterIn};
use utoipa::openapi::request_body::RequestBodyBuilder;
use utoipa::openapi::schema::{ObjectBuilder, SchemaType};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::openapi::{
    Components, Content, InfoBuilder, OpenApi, OpenApiBuilder, PathItem, PathsBuilder, RefOr,
    Required, Response, ResponseBuilder, Schema, SecurityRequirement, Server, Tag,
};

/// Quem pode chamar a rota.
#[derive(Clone, Copy, PartialEq)]
enum Auth {
    /// Aberta — landing, checkout de assinatura, callbacks.
    Public,
    /// JWT do Supabase Auth do assinante (lojista).
    Subscriber,
    /// JWT do Supabase Auth, restrito aos e-mails de superadmin.
    Superadmin,
    /// Autenticada pela assinatura do provedor (HMAC), não por token nosso.
    Signature,
}

fn any_object() -> RefOr<Schema> {
    RefOr::T(Schema::Object(
        ObjectBuilder::new()
            .schema_type(SchemaType::Type(utoipa::openapi::Type::Object))
            .build(),
    ))
}

fn json_body(desc: &str) -> utoipa::openapi::request_body::RequestBody {
    RequestBodyBuilder::new()
        .description(Some(desc.to_string()))
        .content("application/json", Content::new(Some(any_object())))
        .build()
}

fn multipart_body(desc: &str) -> utoipa::openapi::request_body::RequestBody {
    RequestBodyBuilder::new()
        .description(Some(desc.to_string()))
        .content("multipart/form-data", Content::new(Some(any_object())))
        .build()
}

fn resp(desc: &str) -> Response {
    ResponseBuilder::new().description(desc).build()
}

fn param(name: &str, loc: ParameterIn, required: bool, desc: &str) -> Parameter {
    Parameter::builder()
        .name(name)
        .parameter_in(loc)
        .description(Some(desc.to_string()))
        .required(if required { Required::True } else { Required::False })
        .build()
}

fn describe_path_param(name: &str) -> &'static str {
    match name {
        "id" => "Identificador do recurso.",
        "slug" => "Slug público da loja (tenant).",
        "code" => "Código do plano (ex: `essential`).",
        _ => "Parâmetro de rota.",
    }
}

struct Route {
    path: &'static str,
    method: HttpMethod,
    summary: &'static str,
    description: &'static str,
    tag: &'static str,
    auth: Auth,
    body: Option<&'static str>,
    query: &'static [(&'static str, &'static str)],
}

fn build_operation(r: &Route) -> Operation {
    let mut b = OperationBuilder::new()
        .summary(Some(r.summary.to_string()))
        .description(Some(r.description.to_string()))
        .tag(r.tag)
        .response("200", resp("Sucesso."));

    match r.auth {
        Auth::Public => {
            b = b
                .response("400", resp("Requisição inválida."))
                .response("404", resp("Recurso não encontrado."));
        }
        Auth::Subscriber => {
            b = b
                .response("401", resp("Token do assinante ausente, inválido ou expirado."))
                .response("404", resp("Assinante não encontrado."))
                .security(SecurityRequirement::new("subscriber_jwt", Vec::<String>::new()));
        }
        Auth::Superadmin => {
            b = b
                .response("401", resp("Token ausente ou inválido."))
                .response("403", resp("O e-mail do token não está na lista de superadmins."))
                .security(SecurityRequirement::new("superadmin_jwt", Vec::<String>::new()));
        }
        Auth::Signature => {
            b = b.response("200", resp("Sempre 200: o provedor não deve reenviar por erro nosso."));
        }
    }

    if let Some(desc) = r.body {
        if let Some(d) = desc.strip_prefix("multipart:") {
            b = b.request_body(Some(multipart_body(d)));
        } else {
            b = b.request_body(Some(json_body(desc)));
        }
    }

    let mut op = b.build();
    for seg in r.path.split('/') {
        if let Some(name) = seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            op.parameters
                .get_or_insert_with(Vec::new)
                .push(param(name, ParameterIn::Path, true, describe_path_param(name)));
        }
    }
    for (name, desc) in r.query {
        op.parameters
            .get_or_insert_with(Vec::new)
            .push(param(name, ParameterIn::Query, false, desc));
    }
    op
}

fn merge(paths: &mut utoipa::openapi::path::Paths, path: &str, method: HttpMethod, op: Operation) {
    let item = PathItem::new(method, op);
    if let Some(existing) = paths.paths.get_mut(path) {
        existing.merge_operations(item);
    } else {
        paths.paths.insert(path.to_string(), item);
    }
}

fn routes() -> Vec<Route> {
    use Auth::*;
    use HttpMethod::*;

    vec![
        Route { path: "/health", method: Get, tag: "Sistema", auth: Public,
            summary: "Health check",
            description: "Verificação de saúde usada pelo healthcheck do deploy. Responde `ok` em texto puro.",
            body: None, query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/auth/bootstrap", method: Post, tag: "Autenticação", auth: Public,
            summary: "Primeiro acesso do assinante",
            description: "Cria/vincula o registro de assinante ao usuário do Supabase Auth logo após o cadastro. Idempotente — chamar de novo não duplica assinante.",
            body: Some("`{ email, nome }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/assinaturas", method: Post, tag: "Assinaturas", auth: Public,
            summary: "Assinar um plano",
            description: "Inicia a assinatura no plano escolhido. Cria a preapproval no Mercado Pago da **plataforma** (não do lojista) e devolve o que o checkout precisa para cobrar. A assinatura só fica `ativa` quando o pagamento é confirmado pelo webhook.",
            body: Some("`{ plan_code, email, nome, cupom? }`"), query: &[] },

        Route { path: "/api/assinaturas/{id}/status", method: Get, tag: "Assinaturas", auth: Public,
            summary: "Status da assinatura",
            description: "Consulta o estado atual da assinatura. A tela de checkout faz polling nisto enquanto espera a confirmação do pagamento.",
            body: None, query: &[] },

        Route { path: "/api/assinaturas/pagar-cartao", method: Post, tag: "Assinaturas", auth: Public,
            summary: "Pagar assinatura no cartão",
            description: "Cobra a assinatura com o token de cartão gerado no navegador pelo SDK do Mercado Pago. O número do cartão nunca passa por este backend — só o token.",
            body: Some("`{ assinatura_id, token, payment_method_id, installments, issuer_id, payer }`"), query: &[] },

        Route { path: "/api/assinaturas/simular-pagamento", method: Post, tag: "Assinaturas", auth: Public,
            summary: "Simular pagamento da assinatura (sandbox)",
            description: "Marca a assinatura como paga sem cobrança real, para testar o fluxo de provisionamento ponta a ponta. Recusa em assinatura com credencial de produção.",
            body: Some("`{ assinatura_id }`"), query: &[] },

        Route { path: "/api/assinaturas/cancelar-pendente", method: Post, tag: "Assinaturas", auth: Public,
            summary: "Cancelar assinatura pendente",
            description: "Descarta uma assinatura que ficou parada antes do pagamento, liberando o e-mail para uma nova tentativa.",
            body: Some("`{ assinatura_id }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/me", method: Get, tag: "Minha Conta", auth: Subscriber,
            summary: "Dados do assinante logado",
            description: "Retorna o assinante completo: plano, status da assinatura, estado do onboarding, `vertical` (ramo: `ecommerce` ou `eletronicos`) e a situação das credenciais de pagamento (`has_plataforma_credenciais`, `plataforma_credenciais_mask`). É a fonte que o painel usa para decidir o que liberar.",
            body: None, query: &[] },

        Route { path: "/api/me/plano", method: Post, tag: "Minha Conta", auth: Subscriber,
            summary: "Trocar de plano",
            description: "Faz upgrade/downgrade do plano e ajusta o valor da assinatura no Mercado Pago.",
            body: Some("`{ plan_code }`"), query: &[] },

        Route { path: "/api/me/senha", method: Post, tag: "Minha Conta", auth: Subscriber,
            summary: "Alterar senha",
            description: "Troca a senha no Supabase Auth e propaga o novo hash para o admin da loja no ecommerce-api, mantendo o login único entre plataforma e painel da loja.",
            body: Some("`{ nova_senha }`"), query: &[] },

        Route { path: "/api/me/cancelar", method: Post, tag: "Minha Conta", auth: Subscriber,
            summary: "Cancelar a própria assinatura",
            description: "Cancela a assinatura no Mercado Pago e suspende a loja no ecommerce-api (a vitrine sai do ar).",
            body: Some("`{ motivo? }`"), query: &[] },

        Route { path: "/api/me/upload-logo", method: Post, tag: "Minha Conta", auth: Subscriber,
            summary: "Enviar logo da loja",
            description: "Sobe a logo para o storage e devolve a URL pública usada na vitrine.",
            body: Some("multipart:Arquivo de imagem no campo `file`."), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/onboarding", method: Post, tag: "Onboarding", auth: Public,
            summary: "Provisionar a loja",
            description: "Fecha o onboarding e provisiona a loja de verdade: chama `/internal/provision-tenant` no ecommerce-api, criando Organization + Tenant + Subscription + admin. `vertical` define o ramo (`ecommerce` ou `eletronicos`) e determina qual módulo atende a loja — no ramo eletrônicos o `layout_style` não se aplica.",
            body: Some("`{ nome_empresa, endereco, vertical, layout_style, whatsapp, horarios, ... }`"), query: &[] },

        Route { path: "/api/onboarding", method: Put, tag: "Onboarding", auth: Subscriber,
            summary: "Editar dados da loja",
            description: "Atualiza os dados de onboarding de uma loja já provisionada e sincroniza o que for relevante com o ecommerce-api (ex: endereço de retirada, base do cálculo de frete).",
            body: Some("`{ nome_empresa, endereco, whatsapp, horarios, ... }`"), query: &[] },

        Route { path: "/api/public/tenant-config/{slug}", method: Get, tag: "Público", auth: Public,
            summary: "Configuração pública da loja",
            description: "Tema, logo e identidade visual da loja por slug. A vitrine lê isto antes de renderizar, sem exigir login.",
            body: None, query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/mercadopago/oauth/start", method: Post, tag: "Mercado Pago (lojista)", auth: Subscriber,
            summary: "Iniciar conexão da conta Mercado Pago",
            description: "Passo 1 do OAuth. Gera um `state` de uso único (limpando qualquer tentativa anterior abandonada do mesmo assinante) mais o par PKCE (`code_challenge` S256) e devolve a URL de autorização do Mercado Pago para redirecionar o lojista. Exige `MERCADOPAGO_OAUTH_CLIENT_ID`/`CLIENT_SECRET`/`REDIRECT_URI` configurados no servidor.",
            body: None, query: &[] },

        Route { path: "/api/mercadopago/oauth/callback", method: Get, tag: "Mercado Pago (lojista)", auth: Public,
            summary: "Callback do OAuth (Mercado Pago → nós)",
            description: "Passo 2 do OAuth, chamado pelo **Mercado Pago**, não pelo painel. Valida o `state`, troca o `code` pelo access token com o `code_verifier` do PKCE e grava as credenciais do lojista; em seguida repassa ao ecommerce-api via `/internal/sync-payment-credentials`, o que habilita Pix e cartão na loja. Responde com **redirect** de volta ao painel (sucesso ou erro), nunca JSON. O Mercado Pago conhece apenas UMA `redirect_uri`, então este mesmo endpoint atende lojista e plataforma, distinguidos pelo `state`.",
            body: None, query: &[("code", "Código de autorização do Mercado Pago."), ("state", "Estado de uso único emitido no start."), ("error", "Presente quando o lojista recusa a autorização.")] },

        Route { path: "/api/mercadopago/oauth/disconnect", method: Post, tag: "Mercado Pago (lojista)", auth: Subscriber,
            summary: "Desconectar a conta Mercado Pago",
            description: "Apaga as credenciais do lojista e avisa o ecommerce-api. A partir daí a loja volta a não aceitar pagamento online.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/mercadopago/oauth/start", method: Post, tag: "Superadmin", auth: Superadmin,
            summary: "Conectar Mercado Pago da plataforma",
            description: "Mesmo fluxo OAuth, mas para a conta que recebe as **assinaturas do Resolutoo** (não as vendas das lojas).",
            body: None, query: &[] },

        Route { path: "/api/superadmin/mercadopago/oauth/disconnect", method: Post, tag: "Superadmin", auth: Superadmin,
            summary: "Desconectar Mercado Pago da plataforma",
            description: "Remove as credenciais da conta que cobra as assinaturas. Sem ela, novas assinaturas não podem ser cobradas.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/mercadopago/status", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Status do Mercado Pago da plataforma",
            description: "Diz se a conta que cobra as assinaturas está conectada e qual é o usuário Mercado Pago vinculado.",
            body: None, query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/webhooks/mercadopago", method: Post, tag: "Webhooks", auth: Signature,
            summary: "Webhook de pagamento da assinatura",
            description: "**É por aqui que uma assinatura vira `ativa`.** Recebe a notificação do Mercado Pago, valida a assinatura `x-signature` (HMAC-SHA256 sobre `id:{data_id};request-id:{x-request-id};ts:{ts};`), consulta o pagamento/preapproval e atualiza a assinatura. Quando o primeiro pagamento é aprovado, dispara o provisionamento da loja. Processamento idempotente — a mesma notificação repetida não provisiona duas vezes. Responde `200` mesmo em erro interno, para o Mercado Pago não reenviar indefinidamente (a falha vai para o log).",
            body: Some("`{ type, data: { id } }` — payload do Mercado Pago."), query: &[("type", "Tipo do evento."), ("data.id", "ID do pagamento/preapproval.")] },

        Route { path: "/api/webhooks/mercadopago", method: Get, tag: "Webhooks", auth: Signature,
            summary: "Verificação do webhook (Mercado Pago)",
            description: "O Mercado Pago faz um GET no endpoint ao cadastrar a URL de notificação. Aceito para a validação passar.",
            body: None, query: &[] },

        Route { path: "/api/webhooks/pandadoc", method: Post, tag: "Webhooks", auth: Signature,
            summary: "Webhook de assinatura de contrato (PandaDoc)",
            description: "Recebe os eventos de ciclo de vida do documento (enviado, visualizado, assinado) e atualiza o status do contrato do assinante. Contrato assinado é pré-requisito para a loja operar.",
            body: Some("Payload de evento do PandaDoc."), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/public/contratos/catalog", method: Get, tag: "Contratos", auth: Public,
            summary: "Catálogo de contratos",
            description: "Documentos que o assinante precisa aceitar (termos de uso, contrato de prestação), com versão vigente.",
            body: None, query: &[] },

        Route { path: "/api/public/contratos/accept-checkout", method: Post, tag: "Contratos", auth: Public,
            summary: "Aceitar contrato no checkout",
            description: "Registra o aceite feito durante a contratação, antes de existir sessão — guarda versão do documento, data/hora e identificação para valer como prova.",
            body: Some("`{ email, documento_id, versao }`"), query: &[] },

        Route { path: "/api/contratos/me", method: Get, tag: "Contratos", auth: Subscriber,
            summary: "Meus contratos",
            description: "Documentos do assinante logado e o status de aceite/assinatura de cada um.",
            body: None, query: &[] },

        Route { path: "/api/contratos/accept", method: Post, tag: "Contratos", auth: Subscriber,
            summary: "Aceitar contrato (logado)",
            description: "Registra o aceite de um documento pelo assinante autenticado.",
            body: Some("`{ documento_id, versao }`"), query: &[] },

        Route { path: "/api/contratos/pandadoc/session", method: Post, tag: "Contratos", auth: Subscriber,
            summary: "Abrir sessão de assinatura PandaDoc",
            description: "Cria a sessão de assinatura eletrônica e devolve a URL do documento para o assinante assinar dentro do painel.",
            body: Some("`{ documento_id }`"), query: &[] },

        Route { path: "/api/public/contratos/pandadoc/status", method: Get, tag: "Contratos", auth: Public,
            summary: "Status do documento no PandaDoc",
            description: "Consulta o estado da assinatura eletrônica. A tela faz polling nisto enquanto o assinante conclui a assinatura.",
            body: None, query: &[("documento_id", "ID do documento a consultar.")] },

        // ------------------------------------------------------------------
        Route { path: "/api/public/plans", method: Get, tag: "Público", auth: Public,
            summary: "Planos disponíveis",
            description: "Planos publicados com preço e recursos inclusos. É o que a landing e o checkout exibem.",
            body: None, query: &[] },

        Route { path: "/api/public/content", method: Get, tag: "Público", auth: Public,
            summary: "Conteúdo do site",
            description: "Textos e imagens editáveis da landing, gerenciados pelo superadmin sem precisar de deploy.",
            body: None, query: &[] },

        Route { path: "/api/public/coupons/preview", method: Post, tag: "Público", auth: Public,
            summary: "Pré-visualizar cupom",
            description: "Valida o cupom e devolve o valor com desconto **sem** consumir o cupom. Usado no checkout enquanto o cliente digita.",
            body: Some("`{ codigo, plan_code }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/superadmin/whoami", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Confirmar acesso de superadmin",
            description: "Diz se o token pertence a um superadmin. O painel usa para decidir se mostra a área administrativa.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/overview", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Visão geral da plataforma",
            description: "Métricas consolidadas: lojas ativas, receita recorrente, assinaturas por status e custos operacionais.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/stores", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Listar lojas",
            description: "Todas as lojas da plataforma com plano, status da assinatura, ramo e situação do onboarding.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/stores/{id}/coupon", method: Post, tag: "Superadmin", auth: Superadmin,
            summary: "Aplicar cupom a uma loja",
            description: "Concede desconto a uma loja específica e ajusta o valor cobrado na assinatura.",
            body: Some("`{ coupon_id }`"), query: &[] },

        Route { path: "/api/superadmin/plans", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Listar planos (admin)",
            description: "Todos os planos, inclusive os despublicados, com preço e limites.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/plans", method: Post, tag: "Superadmin", auth: Superadmin,
            summary: "Criar plano",
            description: "Cria um plano novo com preço, recursos e limites.",
            body: Some("`{ code, nome, valor, recursos, publicado }`"), query: &[] },

        Route { path: "/api/superadmin/plans/{code}", method: Put, tag: "Superadmin", auth: Superadmin,
            summary: "Atualizar plano",
            description: "Edita preço, recursos ou visibilidade do plano.",
            body: Some("`{ nome, valor, recursos, publicado }`"), query: &[] },

        Route { path: "/api/superadmin/content", method: Put, tag: "Superadmin", auth: Superadmin,
            summary: "Editar conteúdo do site",
            description: "Salva os textos/imagens da landing servidos por `/api/public/content`.",
            body: Some("`{ chave, valor }`"), query: &[] },

        Route { path: "/api/superadmin/costs", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Listar custos operacionais",
            description: "Custos lançados (infra, ferramentas) usados no cálculo de margem da plataforma.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/costs", method: Post, tag: "Superadmin", auth: Superadmin,
            summary: "Lançar custo operacional",
            description: "Registra um custo recorrente ou pontual da plataforma.",
            body: Some("`{ descricao, valor, recorrente, data }`"), query: &[] },

        Route { path: "/api/superadmin/coupons", method: Get, tag: "Superadmin", auth: Superadmin,
            summary: "Listar cupons",
            description: "Cupons cadastrados, com regra de desconto, validade e quantas vezes já foram usados.",
            body: None, query: &[] },

        Route { path: "/api/superadmin/coupons", method: Post, tag: "Superadmin", auth: Superadmin,
            summary: "Criar cupom",
            description: "Cria um cupom de desconto (percentual ou fixo), com validade e limite de uso.",
            body: Some("`{ codigo, tipo, valor, validade, limite_uso }`"), query: &[] },

        Route { path: "/api/superadmin/coupons/{id}", method: Put, tag: "Superadmin", auth: Superadmin,
            summary: "Atualizar cupom",
            description: "Edita regra, validade ou limite de uso do cupom.",
            body: Some("`{ tipo, valor, validade, limite_uso }`"), query: &[] },

        Route { path: "/api/superadmin/coupons/{id}", method: Delete, tag: "Superadmin", auth: Superadmin,
            summary: "Excluir cupom",
            description: "Remove o cupom. Não afeta descontos já aplicados a assinaturas existentes.",
            body: None, query: &[] },
    ]
}

pub fn build() -> OpenApi {
    let mut paths = PathsBuilder::new().build();
    for r in routes() {
        merge(&mut paths, r.path, r.method.clone(), build_operation(&r));
    }

    let mut components = Components::new();
    components.security_schemes.insert(
        "subscriber_jwt".to_string(),
        SecurityScheme::Http(
            HttpBuilder::new()
                .scheme(HttpAuthScheme::Bearer)
                .bearer_format("JWT")
                .description(Some(
                    "JWT do Supabase Auth do assinante (lojista), validado por JWKS.",
                ))
                .build(),
        ),
    );
    components.security_schemes.insert(
        "superadmin_jwt".to_string(),
        SecurityScheme::Http(
            HttpBuilder::new()
                .scheme(HttpAuthScheme::Bearer)
                .bearer_format("JWT")
                .description(Some(
                    "Mesmo JWT do Supabase Auth, aceito apenas quando o e-mail está na lista de superadmins do servidor.",
                ))
                .build(),
        ),
    );

    OpenApiBuilder::new()
        .info(
            InfoBuilder::new()
                .title("Resolutoo — API da Plataforma (ufersin-api)")
                .version(env!("CARGO_PKG_VERSION"))
                .description(Some(
                    "API central do Resolutoo (resolutoo.com): assinatura de plano, onboarding e \
                     provisionamento de lojas, OAuth do Mercado Pago (do lojista e da plataforma), \
                     webhooks de pagamento, contratos/PandaDoc, conteúdo público e painel do superadmin.\n\n\
                     **Duas contas Mercado Pago, propósitos distintos:** a da *plataforma* cobra as \
                     assinaturas do Resolutoo; a do *lojista*, conectada por OAuth, recebe as vendas \
                     da loja dele. As credenciais do lojista são repassadas ao ecommerce-api via \
                     `/internal/sync-payment-credentials` — é isso que liga Pix e cartão na vitrine.\n\n\
                     **Dinheiro só muda de estado por webhook:** assinatura vira `ativa` e loja é \
                     provisionada a partir da notificação assinada do Mercado Pago, nunca por \
                     informação vinda do navegador.\n\n\
                     **Autenticação:** ver o cadeado em cada rota — público, JWT de assinante \
                     (Supabase Auth) ou JWT de superadmin. Webhooks se autenticam pela assinatura \
                     HMAC do próprio provedor.\n\n\
                     O motor que atende as lojas é um serviço separado (**ecommerce-api**), com \
                     Swagger próprio.",
                ))
                .build(),
        )
        .servers(Some(vec![
            Server::new("https://ufersin-api-production.up.railway.app"),
            Server::new("http://localhost:8081"),
        ]))
        .paths(paths)
        .tags(Some(vec![
            Tag::new("Autenticação"),
            Tag::new("Assinaturas"),
            Tag::new("Minha Conta"),
            Tag::new("Onboarding"),
            Tag::new("Mercado Pago (lojista)"),
            Tag::new("Webhooks"),
            Tag::new("Contratos"),
            Tag::new("Público"),
            Tag::new("Superadmin"),
            Tag::new("Sistema"),
        ]))
        .components(Some(components))
        .build()
}
