//! Documentação OpenAPI/Swagger completa do ecommerce-api (o "motor" de loja
//! multi-tenant do Resolutoo): catálogo público, checkout, pagamentos
//! (Mercado Pago Pix/cartão), webhooks, PDV, painel do lojista, motoboy e as
//! rotas internas usadas pela plataforma.
//!
//! Construída pelo builder do utoipa (não por macro em cada handler) pra
//! documentar a API existente sem ter que anotar ~95 handlers um a um.

use utoipa::openapi::path::{HttpMethod, Operation, OperationBuilder, Parameter, ParameterIn};
use utoipa::openapi::request_body::RequestBodyBuilder;
use utoipa::openapi::schema::{ObjectBuilder, SchemaType};
use utoipa::openapi::security::{ApiKey, ApiKeyValue, HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::openapi::{
    Components, Content, InfoBuilder, OpenApi, OpenApiBuilder, PathItem, PathsBuilder, RefOr,
    Required, Response, ResponseBuilder, Schema, SecurityRequirement, Server, Tag,
};

/// Quem pode chamar a rota.
#[derive(Clone, Copy, PartialEq)]
pub enum Auth {
    /// Aberta — vitrine/checkout do cliente final.
    Public,
    /// JWT do admin da loja (`POST /api/auth/admin/login`).
    Admin,
    /// JWT do motoboy (`POST /api/auth/motoboy/login`).
    Motoboy,
    /// Chave compartilhada `x-internal-key` — backend-a-backend, nunca do navegador.
    Internal,
    /// Autenticada pela assinatura do próprio provedor (HMAC), não por token nosso.
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

fn path_param(name: &str, desc: &str) -> Parameter {
    Parameter::builder()
        .name(name)
        .parameter_in(ParameterIn::Path)
        .description(Some(desc.to_string()))
        .required(Required::True)
        .build()
}

fn query_param(name: &str, desc: &str) -> Parameter {
    Parameter::builder()
        .name(name)
        .parameter_in(ParameterIn::Query)
        .description(Some(desc.to_string()))
        .required(Required::False)
        .build()
}

/// Descrição legível de cada path param conhecido — evita "id: id" na doc.
fn describe_param(name: &str) -> &'static str {
    match name {
        "slug" => "Slug público do tenant (a loja), ex: `vrtech`.",
        "id" => "Identificador do recurso.",
        "phone" => "Telefone do cliente (apenas dígitos).",
        _ => "Parâmetro de rota.",
    }
}

pub struct Route {
    pub path: &'static str,
    pub method: HttpMethod,
    pub summary: &'static str,
    pub description: &'static str,
    pub tag: &'static str,
    pub auth: Auth,
    pub body: Option<&'static str>,
    pub query: &'static [(&'static str, &'static str)],
}

fn build_operation(r: &Route) -> Operation {
    let mut b = OperationBuilder::new()
        .summary(Some(r.summary.to_string()))
        .description(Some(r.description.to_string()))
        .tag(r.tag);

    // Respostas comuns por tipo de auth — refletem o que o AppError realmente devolve.
    b = b.response("200", resp("Sucesso."));
    match r.auth {
        Auth::Public => {
            b = b.response("400", resp("Requisição inválida."));
            b = b.response("404", resp("Recurso ou loja não encontrada."));
        }
        Auth::Admin => {
            b = b
                .response("401", resp("Token do lojista ausente, inválido ou expirado."))
                .response("403", resp("Recurso de outro tenant, ou plano sem essa funcionalidade."))
                .response("404", resp("Recurso não encontrado."))
                .security(SecurityRequirement::new("admin_jwt", Vec::<String>::new()));
        }
        Auth::Motoboy => {
            b = b
                .response("401", resp("Token do motoboy ausente ou inválido."))
                .response("403", resp("Pedido de outro tenant ou não atribuído a este motoboy."))
                .security(SecurityRequirement::new("motoboy_jwt", Vec::<String>::new()));
        }
        Auth::Internal => {
            b = b
                .response("401", resp("Header `x-internal-key` ausente ou incorreto."))
                .response("500", resp("`INTERNAL_API_KEY` não configurada neste backend."))
                .security(SecurityRequirement::new("internal_key", Vec::<String>::new()));
        }
        Auth::Signature => {
            b = b.response("200", resp("Sempre 200: o provedor não deve reenviar por erro nosso."));
        }
    }

    if let Some(desc) = r.body {
        if desc.starts_with("multipart:") {
            b = b.request_body(Some(multipart_body(desc.trim_start_matches("multipart:"))));
        } else {
            b = b.request_body(Some(json_body(desc)));
        }
    }

    let mut op = b.build();

    for seg in r.path.split('/') {
        if let Some(name) = seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            op.parameters
                .get_or_insert_with(Vec::new)
                .push(path_param(name, describe_param(name)));
        }
    }
    for (name, desc) in r.query {
        op.parameters
            .get_or_insert_with(Vec::new)
            .push(query_param(name, desc));
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

/// Todas as rotas do serviço, na mesma ordem em que aparecem no `main.rs`.
fn routes() -> Vec<Route> {
    use Auth::*;
    use HttpMethod::*;

    vec![
        // ------------------------------------------------------------------
        Route { path: "/api/auth/admin/login", method: Post, tag: "Autenticação", auth: Public,
            summary: "Login do lojista",
            description: "Troca e-mail + senha + `tenant_slug` por um JWT de admin da loja. A senha é verificada contra o hash Argon2 da tabela `admins`. O token retornado vai no header `Authorization: Bearer` das rotas `/api/admin/*`.",
            body: Some("`{ email, password, tenant_slug }`"), query: &[] },

        Route { path: "/api/auth/motoboy/login", method: Post, tag: "Autenticação", auth: Public,
            summary: "Login do motoboy",
            description: "Mesma mecânica do login do lojista, mas emite um JWT de motoboy, que só enxerga os pedidos atribuídos a ele dentro do próprio tenant.",
            body: Some("`{ email, password, tenant_slug }`"), query: &[] },

        Route { path: "/demo/tokens", method: Get, tag: "Autenticação", auth: Public,
            summary: "Tokens da loja de demonstração",
            description: "Emite tokens prontos para a demo pública, sem exigir credenciais. Só funciona para o tenant de demonstração — não expõe loja real.",
            body: None, query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/public/catalog/{slug}/products", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Listar produtos da vitrine",
            description: "Produtos ativos e visíveis da loja. É o que alimenta a vitrine — não exige login e não expõe custo nem margem.",
            body: None, query: &[("category_id", "Filtra por categoria."), ("q", "Busca por nome/descrição.")] },

        Route { path: "/api/public/catalog/{slug}/products/{id}", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Detalhe de um produto",
            description: "Produto individual da vitrine, com categoria e disponibilidade.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/categories", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Listar categorias",
            description: "Categorias ativas da loja, na ordem de exibição definida pelo lojista.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/product-sales-counts", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Contagem de vendas por produto",
            description: "Quantas vezes cada produto já foi vendido. Usado para ordenar por \"mais vendidos\" na vitrine.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/store-status", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Loja está aberta agora?",
            description: "Combina o horário de funcionamento configurado com o override manual do lojista. A vitrine usa isso para bloquear o checkout fora do expediente.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/mp-public-key", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Chave pública do Mercado Pago da loja",
            description: "Public key da conta Mercado Pago conectada pelo lojista. O checkout usa no SDK do navegador para tokenizar o cartão sem que o número passe pelo nosso backend. Só a chave **pública** é exposta — o access token nunca sai do servidor.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/orders-by-phone/{phone}", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Pedidos do cliente pelo telefone",
            description: "Permite ao cliente acompanhar os próprios pedidos sem criar conta — o telefone funciona como credencial.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/assistant-order", method: Post, tag: "Catálogo público", auth: Public,
            summary: "Criar pedido (checkout / assistente)",
            description: "Cria um pedido real a partir de itens de produto e/ou serviço. Usado tanto pelo checkout da vitrine quanto pela assistente de WhatsApp. Valida estoque e recalcula o total no servidor — preço enviado pelo cliente não é confiado.",
            body: Some("`{ customer_name, customer_whatsapp, items: [{ product_id | service_id, quantity }], shipping_price }`"), query: &[] },

        Route { path: "/api/public/catalog/{slug}/estimate-delivery", method: Post, tag: "Catálogo público", auth: Public,
            summary: "Calcular frete até um endereço",
            description: "Calcula distância e preço da entrega a partir das coordenadas do cliente, usando as `shipping_settings` da loja (coordenada da loja + preço por km, ou tabela por bairro).",
            body: Some("`{ lat, lng }`"), query: &[] },

        Route { path: "/api/public/catalog/{slug}/services", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Listar serviços",
            description: "Serviços ativos da loja. No ramo de eletrônicos, cada serviço traz também `model_name` e `repair_type`.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/services/{id}", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Detalhe de um serviço",
            description: "Serviço individual, com preço e descrição.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/sitemap.xml", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Sitemap de produtos (XML)",
            description: "Sitemap para indexação da vitrine. Responde `application/xml`, não JSON.",
            body: None, query: &[] },

        Route { path: "/api/public/catalog/{slug}/sitemap-servicos.xml", method: Get, tag: "Catálogo público", auth: Public,
            summary: "Sitemap de serviços (XML)",
            description: "Equivalente do sitemap para as páginas de serviço.",
            body: None, query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/orders/{id}/create-pix-payment", method: Post, tag: "Pagamentos", auth: Public,
            summary: "Gerar cobrança Pix",
            description: "Cria a cobrança Pix no Mercado Pago da loja e devolve QR code (base64) e copia-e-cola. Exige que o lojista tenha conectado o Mercado Pago; sem credencial, responde `400` explicando. O pedido só vira `pago` pelo webhook ou por consulta de status — nunca pela palavra do cliente.\n\nApós gerar a cobrança, dispara em background (não bloqueia a resposta) duas mensagens WhatsApp ao cliente, em sequência: mensagem 1 (resumo — no tenant `vrtech`, renderizada via Template Zap chamando `POST /api/internal/payment-notify` do app vrtech; nos demais tenants, um resumo padrão) e mensagem 2 com o copia-e-cola REAL, que nunca passa por template nenhum.",
            body: None, query: &[] },

        Route { path: "/api/orders/{id}/refresh-payment", method: Post, tag: "Pagamentos", auth: Public,
            summary: "Reconsultar status do pagamento",
            description: "Consulta o Mercado Pago sobre o pagamento do pedido e atualiza `payment_status`. É a rede de segurança para quando o webhook não chega (cliente pagou mas a tela não atualizou).",
            body: None, query: &[] },

        Route { path: "/api/orders/{id}/card-link", method: Post, tag: "Pagamentos", auth: Public,
            summary: "Gerar link de pagamento no cartão",
            description: "Cria uma preferência de checkout do Mercado Pago e devolve a URL para o cliente pagar no cartão fora da vitrine.",
            body: None, query: &[] },

        Route { path: "/api/orders/{id}/card-payment", method: Post, tag: "Pagamentos", auth: Public,
            summary: "Processar pagamento no cartão (token)",
            description: "Recebe o token gerado no navegador pelo SDK do Mercado Pago e executa a cobrança. Os dados do cartão nunca trafegam pelo nosso backend — só o token.",
            body: Some("`{ token, payment_method_id, installments, issuer_id, payer: { email, identification } }`"), query: &[] },

        Route { path: "/api/orders/{id}/simulate-pix-paid", method: Post, tag: "Pagamentos", auth: Public,
            summary: "Simular Pix pago (somente sandbox)",
            description: "Marca o pedido como pago sem cobrança real, para testar o fluxo pós-pagamento ponta a ponta. Recusa em tenants com credencial de produção — existe para desenvolvimento e demonstração.",
            body: None, query: &[] },

        Route { path: "/api/orders/{id}/cancel", method: Post, tag: "Pedidos", auth: Public,
            summary: "Cancelar pedido (cliente)",
            description: "Cancela o pedido e devolve ao estoque os itens já debitados.",
            body: None, query: &[] },

        Route { path: "/api/orders/notify-created", method: Post, tag: "Pedidos", auth: Public,
            summary: "Notificar pedido criado (WhatsApp)",
            description: "Dispara para o lojista o aviso de pedido novo pelo WhatsApp da loja.",
            body: Some("`{ order_id, tenant_slug }`"), query: &[] },

        Route { path: "/api/orders/{id}/notify-payment-received", method: Post, tag: "Pedidos", auth: Public,
            summary: "Notificar pagamento recebido (WhatsApp)",
            description: "Avisa lojista e cliente que o pagamento do pedido foi confirmado.",
            body: None, query: &[] },

        Route { path: "/api/customer/request-password-reset", method: Post, tag: "Pedidos", auth: Public,
            summary: "Pedir redefinição de senha do cliente",
            description: "Dispara o fluxo de recuperação de senha da conta de cliente da loja (lojas com login obrigatório, ex: venda +18).",
            body: Some("`{ email, tenant_slug }`"), query: &[] },

        Route { path: "/api/route", method: Post, tag: "Pedidos", auth: Public,
            summary: "Calcular rota de entrega",
            description: "Traça a rota entre dois pontos (loja → cliente, ou posição do motoboy → cliente) para exibir no mapa de acompanhamento.",
            body: Some("`{ origin: { lat, lng }, destination: { lat, lng } }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/pdv/products", method: Get, tag: "PDV", auth: Admin,
            summary: "Produtos para venda no balcão",
            description: "Catálogo enxuto para a tela de PDV, com preço e estoque atual.",
            body: None, query: &[] },

        Route { path: "/api/pdv/services", method: Get, tag: "PDV", auth: Admin,
            summary: "Serviços para venda no balcão",
            description: "Serviços disponíveis para incluir numa venda de PDV.",
            body: None, query: &[] },

        Route { path: "/api/pdv/sales", method: Post, tag: "PDV", auth: Admin,
            summary: "Registrar venda no balcão",
            description: "Cria a venda presencial, dá baixa no estoque e entra no financeiro. Aceita produtos e serviços na mesma venda.",
            body: Some("`{ items: [{ product_id | service_id, quantity }], payment_method, customer_name?, discount? }`"), query: &[] },

        Route { path: "/api/pdv/relatorio", method: Get, tag: "PDV", auth: Admin,
            summary: "Relatório de vendas do balcão",
            description: "Totais e itens vendidos no PDV no período informado.",
            body: None, query: &[("from", "Data inicial (AAAA-MM-DD)."), ("to", "Data final (AAAA-MM-DD).")] },

        Route { path: "/api/pdv/notify-sale", method: Post, tag: "PDV", auth: Public,
            summary: "Enviar comprovante da venda (WhatsApp)",
            description: "Manda ao cliente o comprovante da venda feita no balcão.",
            body: Some("`{ sale_id, customer_whatsapp }`"), query: &[] },

        Route { path: "/api/pdv/notify-pix-charge", method: Post, tag: "PDV", auth: Public,
            summary: "Enviar cobrança Pix do PDV (WhatsApp)",
            description: "Envia o copia-e-cola do Pix gerado no balcão direto no WhatsApp do cliente.",
            body: Some("`{ sale_id, customer_whatsapp }`"), query: &[] },

        Route { path: "/api/pdv/notify-card-charge", method: Post, tag: "PDV", auth: Public,
            summary: "Enviar link de cartão do PDV (WhatsApp)",
            description: "Envia ao cliente o link de pagamento no cartão referente à venda do balcão.",
            body: Some("`{ sale_id, customer_whatsapp }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/admin/categories", method: Get, tag: "Admin — Catálogo", auth: Admin,
            summary: "Listar categorias", description: "Todas as categorias do tenant, ativas e inativas.", body: None, query: &[] },
        Route { path: "/api/admin/categories", method: Post, tag: "Admin — Catálogo", auth: Admin,
            summary: "Criar categoria", description: "Cria uma categoria de produtos na loja.", body: Some("`{ name, sort_order?, active? }`"), query: &[] },
        Route { path: "/api/admin/categories/{id}", method: Put, tag: "Admin — Catálogo", auth: Admin,
            summary: "Atualizar categoria", description: "Renomeia, reordena ou ativa/desativa a categoria.", body: Some("`{ name, sort_order?, active? }`"), query: &[] },
        Route { path: "/api/admin/categories/{id}", method: Delete, tag: "Admin — Catálogo", auth: Admin,
            summary: "Excluir categoria", description: "Remove a categoria. Recusa se ainda houver produtos vinculados.", body: None, query: &[] },

        Route { path: "/api/admin/products", method: Get, tag: "Admin — Catálogo", auth: Admin,
            summary: "Listar produtos", description: "Produtos do tenant com custo, margem e estoque — visão interna, diferente do catálogo público.", body: None, query: &[] },
        Route { path: "/api/admin/products", method: Post, tag: "Admin — Catálogo", auth: Admin,
            summary: "Criar produto",
            description: "Cadastra um produto. No ramo de eletrônicos, aceita também `phone_brand` e `phone_model` (nulos nos demais ramos).",
            body: Some("`{ name, price, cost_price?, quantity, category_id, description?, image_url?, phone_brand?, phone_model? }`"), query: &[] },
        Route { path: "/api/admin/products/{id}", method: Get, tag: "Admin — Catálogo", auth: Admin,
            summary: "Detalhe do produto", description: "Produto individual com todos os campos internos.", body: None, query: &[] },
        Route { path: "/api/admin/products/{id}", method: Put, tag: "Admin — Catálogo", auth: Admin,
            summary: "Atualizar produto",
            description: "Edita o produto. Em produto de formulação (ERP), `quantity` e `cost_price` são ignorados aqui — são calculados a partir dos insumos.",
            body: Some("`{ name, price, cost_price?, quantity, category_id, ... }`"), query: &[] },
        Route { path: "/api/admin/products/{id}", method: Delete, tag: "Admin — Catálogo", auth: Admin,
            summary: "Excluir produto", description: "Remove o produto do catálogo.", body: None, query: &[] },
        Route { path: "/api/admin/products/upload-image", method: Post, tag: "Admin — Catálogo", auth: Admin,
            summary: "Upload de imagem de produto", description: "Envia a imagem para o storage e devolve a URL pública para usar em `image_url`.", body: Some("multipart:Arquivo de imagem no campo `file`."), query: &[] },
        Route { path: "/api/admin/products/{id}/stock-entry", method: Post, tag: "Admin — Catálogo", auth: Admin,
            summary: "Entrada de estoque do produto",
            description: "Soma quantidade ao estoque e registra a movimentação no histórico. Recusa em produto de formulação, cujo estoque vem dos insumos.",
            body: Some("`{ quantity }`"), query: &[] },

        Route { path: "/api/admin/products/erp-formulation", method: Post, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Criar produto formulado",
            description: "Cria um produto cujo estoque e custo são **calculados** a partir da ficha técnica (insumos e quantidades). O estoque disponível é ditado pelo insumo limitante e não pode ser editado à mão.",
            body: Some("`{ ...campos do produto, formulation: [{ ingredient_id, quantity, unit }] }`"), query: &[] },
        Route { path: "/api/admin/products/{id}/erp-formulation", method: Put, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Atualizar produto formulado",
            description: "Substitui a ficha técnica e recalcula estoque e custo do produto.",
            body: Some("`{ ...campos do produto, formulation: [{ ingredient_id, quantity, unit }] }`"), query: &[] },
        Route { path: "/api/admin/ingredients", method: Get, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Listar insumos", description: "Insumos da loja com unidade, estoque e custo unitário.", body: None, query: &[] },
        Route { path: "/api/admin/ingredients", method: Post, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Criar insumo", description: "Cadastra um insumo. A unidade (`g`, `kg`, `ml`, `l`, `un`) define as conversões possíveis na formulação.", body: Some("`{ name, unit, quantity, cost_price }`"), query: &[] },
        Route { path: "/api/admin/ingredients/{id}", method: Put, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Atualizar insumo", description: "Edita o insumo e recalcula os produtos formulados que dependem dele.", body: Some("`{ name, unit, quantity, cost_price }`"), query: &[] },
        Route { path: "/api/admin/ingredients/{id}", method: Delete, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Excluir insumo", description: "Remove o insumo. Recusa (`409`) se ele ainda for usado em alguma formulação.", body: None, query: &[] },
        Route { path: "/api/admin/ingredients/{id}/stock-entry", method: Post, tag: "Admin — Formulação (ERP)", auth: Admin,
            summary: "Entrada de estoque do insumo",
            description: "Soma ao estoque do insumo, registra a movimentação e recalcula automaticamente o estoque de todos os produtos formulados que o utilizam.",
            body: Some("`{ quantity }`"), query: &[] },

        Route { path: "/api/admin/services", method: Get, tag: "Admin — Catálogo", auth: Admin,
            summary: "Listar serviços", description: "Serviços do tenant com preço, custos extras e insumos vinculados.", body: None, query: &[] },
        Route { path: "/api/admin/services", method: Post, tag: "Admin — Catálogo", auth: Admin,
            summary: "Criar serviço",
            description: "Cadastra um serviço. No ramo de eletrônicos, aceita `model_name` e `repair_type` (nulos nos demais ramos).",
            body: Some("`{ name, price, description?, model_name?, repair_type?, ingredients?, extra_costs? }`"), query: &[] },
        Route { path: "/api/admin/services/{id}", method: Put, tag: "Admin — Catálogo", auth: Admin,
            summary: "Atualizar serviço", description: "Edita o serviço e seus custos vinculados.", body: Some("`{ name, price, ... }`"), query: &[] },
        Route { path: "/api/admin/services/{id}", method: Delete, tag: "Admin — Catálogo", auth: Admin,
            summary: "Excluir serviço", description: "Remove o serviço do catálogo.", body: None, query: &[] },

        Route { path: "/api/admin/motoboys", method: Get, tag: "Admin — Entregas", auth: Admin,
            summary: "Listar motoboys", description: "Entregadores cadastrados na loja.", body: None, query: &[] },
        Route { path: "/api/admin/motoboys", method: Post, tag: "Admin — Entregas", auth: Admin,
            summary: "Cadastrar motoboy", description: "Cria o entregador e as credenciais de acesso ao app de entrega.", body: Some("`{ name, email, password, phone }`"), query: &[] },
        Route { path: "/api/admin/motoboys/{id}", method: Get, tag: "Admin — Entregas", auth: Admin,
            summary: "Detalhe do motoboy", description: "Dados do entregador e entregas atribuídas.", body: None, query: &[] },
        Route { path: "/api/admin/motoboys/{id}", method: Put, tag: "Admin — Entregas", auth: Admin,
            summary: "Atualizar motoboy", description: "Edita dados ou redefine a senha do entregador.", body: Some("`{ name, email, password?, phone }`"), query: &[] },
        Route { path: "/api/admin/motoboys/{id}", method: Delete, tag: "Admin — Entregas", auth: Admin,
            summary: "Excluir motoboy", description: "Remove o entregador e revoga o acesso dele.", body: None, query: &[] },

        Route { path: "/api/admin/orders", method: Get, tag: "Admin — Pedidos", auth: Admin,
            summary: "Listar pedidos", description: "Pedidos do tenant com itens, status de pagamento e entrega.", body: None, query: &[("status", "Filtra por status do pedido.")] },
        Route { path: "/api/admin/orders/{id}/status", method: Patch, tag: "Admin — Pedidos", auth: Admin,
            summary: "Mudar status do pedido", description: "Avança o pedido no fluxo (em preparo, pronto, saiu para entrega, entregue).", body: Some("`{ status }`"), query: &[] },
        Route { path: "/api/admin/orders/{id}/cancel", method: Post, tag: "Admin — Pedidos", auth: Admin,
            summary: "Cancelar pedido (lojista)", description: "Cancela e devolve ao estoque os itens já debitados.", body: None, query: &[] },

        Route { path: "/api/admin/financeiro", method: Get, tag: "Admin — Financeiro", auth: Admin,
            summary: "Resumo financeiro", description: "Faturamento, contagem por status e produtos mais vendidos no período.", body: None, query: &[("from", "Data inicial."), ("to", "Data final.")] },
        Route { path: "/api/admin/financeiro/lucro", method: Get, tag: "Admin — Financeiro", auth: Admin,
            summary: "Lucro por período", description: "Receita menos custo dos produtos vendidos (usa `cost_price`, inclusive o calculado por formulação).", body: None, query: &[("from", "Data inicial."), ("to", "Data final.")] },

        Route { path: "/api/admin/whatsapp/status", method: Get, tag: "Admin — WhatsApp", auth: Admin,
            summary: "Status da conexão WhatsApp", description: "Estado atual da instância Evolution da loja (conectada, aguardando QR, desconectada).", body: None, query: &[] },
        Route { path: "/api/admin/whatsapp/connect", method: Get, tag: "Admin — WhatsApp", auth: Admin,
            summary: "Conectar WhatsApp (QR code)", description: "Recria a instância e devolve o QR code para o lojista parear o número.", body: None, query: &[] },
        Route { path: "/api/admin/whatsapp/logout", method: Post, tag: "Admin — WhatsApp", auth: Admin,
            summary: "Desconectar WhatsApp", description: "Encerra a sessão do número na instância da loja.", body: None, query: &[] },
        Route { path: "/api/admin/whatsapp/connection-events", method: Get, tag: "Admin — WhatsApp", auth: Admin,
            summary: "Histórico de conexão", description: "Eventos de conexão/desconexão — usado para diagnosticar queda de sessão.", body: None, query: &[] },
        Route { path: "/api/admin/whatsapp/notify-order-ready", method: Post, tag: "Admin — WhatsApp", auth: Admin,
            summary: "Avisar cliente: pedido pronto", description: "Envia ao cliente a mensagem de pedido pronto.", body: Some("`{ order_id }`"), query: &[] },
        Route { path: "/api/admin/whatsapp/notify-coupon-grant", method: Post, tag: "Admin — WhatsApp", auth: Admin,
            summary: "Avisar cliente: cupom concedido", description: "Envia ao cliente o aviso de cupom de desconto.", body: Some("`{ customer_whatsapp, coupon_code }`"), query: &[] },

        Route { path: "/api/admin/store-status", method: Get, tag: "Admin — Configuração", auth: Admin,
            summary: "Status e horários da loja", description: "Horário de funcionamento configurado e se há override manual ativo.", body: None, query: &[] },
        Route { path: "/api/admin/store-hours", method: Put, tag: "Admin — Configuração", auth: Admin,
            summary: "Definir horário de funcionamento", description: "Salva os horários por dia da semana que abrem e fecham a vitrine automaticamente.", body: Some("`{ hours: [{ weekday, open_time, close_time, closed }] }`"), query: &[] },
        Route { path: "/api/admin/store-manual-status", method: Put, tag: "Admin — Configuração", auth: Admin,
            summary: "Abrir/fechar a loja manualmente", description: "Override do horário automático — fecha a loja na hora (ex: falta de entregador) ou reabre fora do expediente.", body: Some("`{ manual_status }`"), query: &[] },
        Route { path: "/api/admin/shipping-settings", method: Get, tag: "Admin — Configuração", auth: Admin,
            summary: "Ler configuração de frete", description: "Coordenada da loja, preço por km, raio de entrega e tabela por bairro.", body: None, query: &[] },
        Route { path: "/api/admin/shipping-settings", method: Put, tag: "Admin — Configuração", auth: Admin,
            summary: "Salvar configuração de frete", description: "Define como o frete é calculado. É o que alimenta o `estimate-delivery` do checkout.", body: Some("`{ store_lat, store_lng, price_per_km, max_distance_km, neighborhood_rates? }`"), query: &[] },
        Route { path: "/api/admin/onboarding-gate", method: Get, tag: "Admin — Configuração", auth: Admin,
            summary: "O que falta configurar", description: "Lista as pendências que ainda travam a loja de operar (frete, pagamento, catálogo vazio). O painel usa para guiar o lojista no primeiro acesso.", body: None, query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/motoboy/runs/start", method: Post, tag: "Motoboy", auth: Motoboy,
            summary: "Iniciar corrida", description: "Marca o início da rota de entrega com os pedidos selecionados.", body: Some("`{ order_ids: [] }`"), query: &[] },
        Route { path: "/api/motoboy/orders", method: Get, tag: "Motoboy", auth: Motoboy,
            summary: "Minhas entregas", description: "Pedidos atribuídos a este motoboy, com endereço e coordenada do cliente.", body: None, query: &[] },
        Route { path: "/api/motoboy/orders/request-location", method: Post, tag: "Motoboy", auth: Motoboy,
            summary: "Pedir localização ao cliente", description: "Dispara no WhatsApp do cliente o pedido de compartilhar a localização exata.", body: Some("`{ order_id }`"), query: &[] },
        Route { path: "/api/motoboy/orders/{id}/status", method: Patch, tag: "Motoboy", auth: Motoboy,
            summary: "Atualizar status da entrega", description: "Marca saiu para entrega / entregue. Só aceita pedidos atribuídos a este motoboy.", body: Some("`{ status }`"), query: &[] },
        Route { path: "/api/motoboy/whatsapp/status", method: Get, tag: "Motoboy", auth: Motoboy,
            summary: "Status do WhatsApp do motoboy", description: "Estado da instância WhatsApp usada pelo entregador.", body: None, query: &[] },
        Route { path: "/api/motoboy/whatsapp/connect", method: Get, tag: "Motoboy", auth: Motoboy,
            summary: "Conectar WhatsApp do motoboy", description: "Gera o QR code para o entregador parear o próprio número.", body: None, query: &[] },
        Route { path: "/api/motoboy/whatsapp/logout", method: Post, tag: "Motoboy", auth: Motoboy,
            summary: "Desconectar WhatsApp do motoboy", description: "Encerra a sessão do número do entregador.", body: None, query: &[] },
        Route { path: "/api/motoboy/whatsapp/notify-location-request", method: Post, tag: "Motoboy", auth: Motoboy,
            summary: "Enviar pedido de localização", description: "Manda a mensagem pedindo a localização pelo WhatsApp do próprio motoboy.", body: Some("`{ order_id }`"), query: &[] },
        Route { path: "/api/motoboy/whatsapp/notify-en-route", method: Post, tag: "Motoboy", auth: Motoboy,
            summary: "Avisar que saiu para entrega", description: "Avisa o cliente, pelo WhatsApp do motoboy, que a entrega está a caminho.", body: Some("`{ order_id }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/webhooks/mercadopago", method: Post, tag: "Webhooks", auth: Signature,
            summary: "Webhook de pagamento (Mercado Pago)",
            description: "**É por aqui que um pedido vira `pago`.** Recebe a notificação `type=payment`, valida a assinatura `x-signature` (HMAC-SHA256 sobre `id:{data_id};request-id:{x-request-id};ts:{ts};`), consulta o pagamento na API do Mercado Pago com o token do lojista e atualiza o pedido. O processamento é idempotente — a mesma notificação chegando duas vezes não duplica baixa nem estoque. Responde `200` mesmo em erro interno, para o Mercado Pago não reenviar indefinidamente por falha nossa (a falha é registrada no log).",
            body: Some("`{ type: \"payment\", data: { id } }` — payload do Mercado Pago."), query: &[("type", "Tipo do evento, também enviado na query."), ("data.id", "ID do pagamento.")] },

        Route { path: "/api/webhooks/evolution", method: Post, tag: "Webhooks", auth: Signature,
            summary: "Webhook do WhatsApp (Evolution API)",
            description: "Recebe eventos da instância WhatsApp: mensagens do cliente, localização compartilhada e mudanças de estado da conexão. Localização recebida é gravada no pedido correspondente para o motoboy enxergar no mapa.",
            body: Some("`{ event, instance, data }` — payload da Evolution API."), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/internal/health", method: Get, tag: "Interno (plataforma)", auth: Public,
            summary: "Health check", description: "Verificação de saúde do serviço, usada pelo healthcheck do deploy.", body: None, query: &[] },

        Route { path: "/internal/provision-tenant", method: Post, tag: "Interno (plataforma)", auth: Internal,
            summary: "Provisionar loja nova",
            description: "Chamado uma única vez pela plataforma (ufersin-api) ao fim do onboarding: cria Organization + Tenant + Subscription + o admin da loja numa transação só. `vertical` define o ramo (`ecommerce` ou `eletronicos`) e decide qual módulo atende a loja.",
            body: Some("`{ organization_name, organization_email, tenant_name, tenant_slug, admin_email, admin_password_hash, plan_code, vertical, theme_primary_color, ... }`"), query: &[] },

        Route { path: "/internal/sync-payment-credentials", method: Post, tag: "Interno (plataforma)", auth: Internal,
            summary: "Sincronizar credenciais de pagamento",
            description: "A plataforma repassa aqui o access token e a public key da conta Mercado Pago que o lojista conectou via OAuth. É o que habilita Pix e cartão na loja — sem isso, o checkout recusa cobrança online.",
            body: Some("`{ tenant_slug, provider, access_token, public_key, mp_user_id? }`"), query: &[] },

        Route { path: "/internal/set-tenant-status", method: Post, tag: "Interno (plataforma)", auth: Internal,
            summary: "Ativar/suspender loja",
            description: "Suspende ou reativa a loja conforme o status da assinatura (ex: inadimplência derruba a vitrine).",
            body: Some("`{ tenant_slug, status }`"), query: &[] },

        Route { path: "/internal/sync-admin-password", method: Post, tag: "Interno (plataforma)", auth: Internal,
            summary: "Sincronizar senha do lojista",
            description: "Replica a troca de senha feita na plataforma para o admin da loja, mantendo um login único entre os dois sistemas.",
            body: Some("`{ tenant_slug, admin_email, admin_password_hash }`"), query: &[] },

        Route { path: "/internal/sync-pickup-address", method: Post, tag: "Interno (plataforma)", auth: Internal,
            summary: "Sincronizar endereço da loja",
            description: "Atualiza o endereço/coordenada de retirada usado como origem no cálculo de frete.",
            body: Some("`{ tenant_slug, address, lat, lng }`"), query: &[] },

        // ------------------------------------------------------------------
        Route { path: "/api/sandbox/orders/{order_id}/payments", method: Get, tag: "Sandbox (simulação de pagamento)", auth: Public,
            summary: "Listar pagamentos simulados do pedido",
            description: "Cobranças simuladas geradas para o pedido, com status atual. Só responde em loja com credencial de simulação; loja com Mercado Pago real recebe `403`.",
            body: None, query: &[] },

        Route { path: "/api/sandbox/payments/{payment_id}/approve", method: Post, tag: "Sandbox (simulação de pagamento)", auth: Public,
            summary: "Aprovar pagamento simulado",
            description: "Equivale ao cliente ter pago. Aprova a cobrança no simulador e dispara o **mesmo handler do webhook real** — o que é exercitado é o fluxo de produção inteiro: rebusca do pagamento, idempotência, baixa de estoque, transição de status e notificação no WhatsApp. Recusa (`403`) em loja com Mercado Pago de verdade conectado.",
            body: None, query: &[] },

        Route { path: "/api/sandbox/payments/{payment_id}/reject", method: Post, tag: "Sandbox (simulação de pagamento)", auth: Public,
            summary: "Recusar pagamento simulado",
            description: "Marca a cobrança como recusada, para exercitar o caminho de falha. O pedido continua pendente, como aconteceria de verdade.",
            body: None, query: &[] },

        Route { path: "/internal/teardown-whatsapp", method: Post, tag: "Interno (plataforma)", auth: Internal,
            summary: "Remover instância WhatsApp",
            description: "Apaga a instância Evolution da loja — usado no cancelamento da assinatura, para não deixar sessão órfã conectada.",
            body: Some("`{ tenant_slug }`"), query: &[] },
    ]
}

pub fn build() -> OpenApi {
    let mut paths = PathsBuilder::new().build();
    for r in routes() {
        merge(&mut paths, r.path, r.method.clone(), build_operation(&r));
    }

    let mut components = Components::new();
    components.security_schemes.insert(
        "admin_jwt".to_string(),
        SecurityScheme::Http(
            HttpBuilder::new()
                .scheme(HttpAuthScheme::Bearer)
                .bearer_format("JWT")
                .description(Some("JWT do lojista, obtido em `POST /api/auth/admin/login`."))
                .build(),
        ),
    );
    components.security_schemes.insert(
        "motoboy_jwt".to_string(),
        SecurityScheme::Http(
            HttpBuilder::new()
                .scheme(HttpAuthScheme::Bearer)
                .bearer_format("JWT")
                .description(Some("JWT do motoboy, obtido em `POST /api/auth/motoboy/login`."))
                .build(),
        ),
    );
    components.security_schemes.insert(
        "internal_key".to_string(),
        SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::with_description(
            "x-internal-key",
            "Chave compartilhada entre a plataforma e este serviço (`INTERNAL_API_KEY`). Backend-a-backend apenas — nunca exposta ao navegador.",
        ))),
    );

    OpenApiBuilder::new()
        .info(
            InfoBuilder::new()
                .title("Resolutoo — ecommerce-api (motor da loja)")
                .version(env!("CARGO_PKG_VERSION"))
                .description(Some(
                    "Motor multi-tenant que atende as lojas do Resolutoo: catálogo público, \
                     checkout, pagamentos via Mercado Pago (Pix e cartão), webhooks, PDV, \
                     painel do lojista, app do motoboy e as rotas internas usadas pela plataforma.\n\n\
                     **Isolamento por tenant:** toda rota `/api/admin/*`, `/api/pdv/*` e \
                     `/api/motoboy/*` resolve o tenant a partir do token, e as consultas rodam \
                     numa transação com `app.tenant_id` setado (RLS no Postgres). As rotas \
                     públicas recebem o tenant pelo `slug` na URL. Dados de uma loja não são \
                     alcançáveis por outra.\n\n\
                     **Pagamento:** o pedido só passa a `pago` pelo webhook do Mercado Pago ou \
                     por reconsulta explícita ao provedor — nunca por informação vinda do cliente.\n\n\
                     **Autenticação:** ver o cadeado em cada rota. Quatro modelos coexistem — \
                     público (vitrine), JWT de lojista, JWT de motoboy e chave interna.",
                ))
                .build(),
        )
        .servers(Some(vec![
            Server::new("https://ecommerce-api-production-d447.up.railway.app"),
            Server::new("http://localhost:8080"),
        ]))
        .paths(paths)
        .tags(Some(vec![
            Tag::new("Autenticação"),
            Tag::new("Catálogo público"),
            Tag::new("Pagamentos"),
            Tag::new("Pedidos"),
            Tag::new("PDV"),
            Tag::new("Admin — Catálogo"),
            Tag::new("Admin — Formulação (ERP)"),
            Tag::new("Admin — Pedidos"),
            Tag::new("Admin — Financeiro"),
            Tag::new("Admin — Entregas"),
            Tag::new("Admin — WhatsApp"),
            Tag::new("Admin — Configuração"),
            Tag::new("Motoboy"),
            Tag::new("Webhooks"),
            Tag::new("Sandbox (simulação de pagamento)"),
            Tag::new("Interno (plataforma)"),
        ]))
        .components(Some(components))
        .build()
}
