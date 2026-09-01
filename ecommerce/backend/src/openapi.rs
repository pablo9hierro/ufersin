// Documentação OpenAPI/Swagger da API da loja (ecommerce-api).
//
// Mesmo formato do openapi.rs do ufersin-api (a API da plataforma) — as duas
// docs são o padrão do resolutoo.com, então mantê-las com a mesma estrutura
// é proposital: quem lê uma reconhece a outra. Construída manualmente (sem
// macro por handler) porque o objetivo é documentar a superfície da API
// existente pra referência/teste, não recriar toda a tipagem de request/
// response — detalhe de payload está nos handlers em src/routes/*.rs.

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

/// Rotas com o mesmo path atendendo múltiplos métodos (ex.: GET+POST em
/// /api/admin/products) precisam ser mescladas manualmente, já que
/// `Paths::path` sobrescreve o item inteiro.
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
        ("/api/auth/admin/login", Post, "Login do lojista/admin da loja", "Auth", false, true),
        ("/api/auth/motoboy/login", Post, "Login do motoboy", "Auth", false, true),
        ("/api/auth/vendedor/login", Post, "Login do vendedor", "Auth", false, true),
        ("/api/auth/cozinha/login", Post, "Login da tela de cozinha", "Auth", false, true),
        ("/api/customer/request-password-reset", Post, "Solicitar redefinicao de senha do cliente", "Auth", false, true),
        ("/api/public/catalog/{slug}/products", Get, "Produtos ativos da vitrine", "Publico", false, false),
        ("/api/public/catalog/{slug}/products/{id}", Get, "Detalhe de um produto", "Publico", false, false),
        ("/api/public/catalog/{slug}/categories", Get, "Categorias da vitrine", "Publico", false, false),
        ("/api/public/catalog/{slug}/services", Get, "Servicos ativos da vitrine", "Publico", false, false),
        ("/api/public/catalog/{slug}/services/{id}", Get, "Detalhe de um servico", "Publico", false, false),
        ("/api/public/catalog/{slug}/product-sales-counts", Get, "Quantidade vendida por produto", "Publico", false, false),
        ("/api/public/catalog/{slug}/store-status", Get, "Horario/status e endereco da loja", "Publico", false, false),
        ("/api/public/catalog/{slug}/mp-public-key", Get, "Chave publica do Mercado Pago da loja", "Publico", false, false),
        ("/api/public/catalog/{slug}/sitemap.xml", Get, "Sitemap de produtos", "Publico", false, false),
        ("/api/public/catalog/{slug}/sitemap-servicos.xml", Get, "Sitemap de servicos", "Publico", false, false),
        ("/api/public/catalog/{slug}/orders-by-phone/{phone}", Get, "Pedidos recentes por telefone", "Publico", false, false),
        ("/api/public/catalog/{slug}/estimate-delivery", Post, "Calcular valor e tempo de entrega por km", "Publico", false, true),
        ("/api/public/catalog/{slug}/assistant-order", Post, "Criar pedido pela Assistente IA", "Assistente IA", false, true),
        ("/api/public/catalog/{slug}/appointments", Post, "Marcar horario (agendamento)", "Agendamentos", false, true),
        ("/api/public/catalog/{slug}/appointments/by-phone/{phone}", Get, "Agendamentos ativos por telefone", "Agendamentos", false, false),
        ("/api/public/catalog/{slug}/appointments/{id}", Put, "Remarcar agendamento", "Agendamentos", false, true),
        ("/api/public/catalog/{slug}/appointments/{id}/cancel", Post, "Desmarcar agendamento", "Agendamentos", false, false),
        ("/api/route", Post, "Calcular rota entre dois pontos", "Publico", false, true),
        ("/api/orders/{id}/create-pix-payment", Post, "Gerar cobranca Pix do pedido", "Pagamentos", false, true),
        ("/api/orders/{id}/refresh-payment", Post, "Reconsultar status do pagamento", "Pagamentos", false, false),
        ("/api/orders/{id}/card-link", Post, "Gerar link de pagamento por cartao", "Pagamentos", false, false),
        ("/api/orders/{id}/card-payment", Post, "Cobrar cartao (checkout transparente)", "Pagamentos", false, true),
        ("/api/orders/{id}/simulate-pix-paid", Post, "Simular Pix pago (sandbox)", "Pagamentos", false, false),
        ("/api/orders/{id}/cancel", Post, "Cancelar pedido (cliente)", "Pedidos", false, true),
        ("/api/orders/notify-created", Post, "Avisar loja de pedido criado (WhatsApp)", "Pedidos", false, true),
        ("/api/orders/{id}/notify-payment-received", Post, "Avisar pagamento recebido (WhatsApp)", "Pedidos", false, true),
        ("/api/pdv/products", Get, "Produtos disponiveis no PDV", "PDV", true, false),
        ("/api/pdv/services", Get, "Servicos disponiveis no PDV", "PDV", true, false),
        ("/api/pdv/sales", Post, "Registrar venda no PDV", "PDV", true, true),
        ("/api/pdv/relatorio", Get, "Relatorio de vendas do PDV", "PDV", true, false),
        ("/api/pdv/relatorio", Post, "Relatorio de vendas do PDV (com filtros)", "PDV", true, true),
        ("/api/pdv/notify-sale", Post, "Avisar cliente da venda (WhatsApp)", "PDV", true, true),
        ("/api/pdv/notify-pix-charge", Post, "Enviar cobranca Pix do PDV (WhatsApp)", "PDV", true, true),
        ("/api/pdv/notify-card-charge", Post, "Enviar cobranca de cartao do PDV (WhatsApp)", "PDV", true, true),
        ("/api/admin/categories", Get, "Listar categorias", "Admin - Catalogo", true, false),
        ("/api/admin/categories", Post, "Criar categoria", "Admin - Catalogo", true, true),
        ("/api/admin/categories/{id}", Put, "Atualizar categoria", "Admin - Catalogo", true, true),
        ("/api/admin/categories/{id}", Delete, "Excluir categoria", "Admin - Catalogo", true, false),
        ("/api/admin/products", Get, "Listar produtos", "Admin - Catalogo", true, false),
        ("/api/admin/products", Post, "Criar produto", "Admin - Catalogo", true, true),
        ("/api/admin/products/{id}", Get, "Detalhe do produto", "Admin - Catalogo", true, false),
        ("/api/admin/products/{id}", Put, "Atualizar produto", "Admin - Catalogo", true, true),
        ("/api/admin/products/{id}", Delete, "Excluir produto", "Admin - Catalogo", true, false),
        ("/api/admin/products/upload-image", Post, "Upload de imagem de produto (multipart)", "Admin - Catalogo", true, true),
        ("/api/admin/products/{id}/stock-entry", Post, "Entrada de estoque do produto", "Admin - Estoque", true, true),
        ("/api/admin/products/erp-formulation", Post, "Criar produto com formulacao (ERP)", "Admin - Estoque", true, true),
        ("/api/admin/products/{id}/erp-formulation", Put, "Atualizar formulacao do produto", "Admin - Estoque", true, true),
        ("/api/admin/ingredients", Get, "Listar insumos", "Admin - Estoque", true, false),
        ("/api/admin/ingredients", Post, "Criar insumo", "Admin - Estoque", true, true),
        ("/api/admin/ingredients/{id}", Put, "Atualizar insumo", "Admin - Estoque", true, true),
        ("/api/admin/ingredients/{id}", Delete, "Excluir insumo", "Admin - Estoque", true, false),
        ("/api/admin/ingredients/{id}/stock-entry", Post, "Entrada de estoque do insumo", "Admin - Estoque", true, true),
        ("/api/admin/services", Get, "Listar servicos", "Admin - Catalogo", true, false),
        ("/api/admin/services", Post, "Criar servico", "Admin - Catalogo", true, true),
        ("/api/admin/services/{id}", Put, "Atualizar servico", "Admin - Catalogo", true, true),
        ("/api/admin/services/{id}", Delete, "Excluir servico", "Admin - Catalogo", true, false),
        ("/api/admin/orders", Get, "Listar pedidos da loja", "Admin - Pedidos", true, false),
        ("/api/admin/orders/{id}/status", Patch, "Mudar status do pedido", "Admin - Pedidos", true, true),
        ("/api/admin/orders/{id}/cancel", Post, "Cancelar pedido (admin)", "Admin - Pedidos", true, true),
        ("/api/admin/motoboys", Get, "Listar motoboys e vendedores", "Admin - Equipe", true, false),
        ("/api/admin/motoboys", Post, "Cadastrar motoboy", "Admin - Equipe", true, true),
        ("/api/admin/motoboys/{id}", Get, "Detalhe do motoboy", "Admin - Equipe", true, false),
        ("/api/admin/motoboys/{id}", Put, "Atualizar motoboy", "Admin - Equipe", true, true),
        ("/api/admin/motoboys/{id}", Delete, "Excluir motoboy", "Admin - Equipe", true, false),
        ("/api/admin/vendedores", Get, "Listar vendedores", "Admin - Equipe", true, false),
        ("/api/admin/vendedores", Post, "Cadastrar vendedor", "Admin - Equipe", true, true),
        ("/api/admin/vendedores/{id}", Put, "Atualizar vendedor", "Admin - Equipe", true, true),
        ("/api/admin/vendedores/{id}", Delete, "Excluir vendedor", "Admin - Equipe", true, false),
        ("/api/admin/cozinha-users", Get, "Listar usuarios de cozinha", "Admin - Equipe", true, false),
        ("/api/admin/cozinha-users", Post, "Cadastrar usuario de cozinha", "Admin - Equipe", true, true),
        ("/api/admin/cozinha-users/{id}", Put, "Atualizar usuario de cozinha", "Admin - Equipe", true, true),
        ("/api/admin/cozinha-users/{id}", Delete, "Excluir usuario de cozinha", "Admin - Equipe", true, false),
        ("/api/admin/payroll/alerts", Get, "Alertas de pagamento fixo a vencer (motoboy/vendedor)", "Admin - Equipe", true, false),
        ("/api/admin/payroll/payments", Post, "Informar pagamento fixo de funcionario", "Admin - Equipe", true, true),
        ("/api/admin/payroll/history", Get, "Historico de pagamentos fixos", "Admin - Equipe", true, false),
        ("/api/payroll/my-pending", Get, "Meus pagamentos aguardando confirmacao", "Equipe", true, false),
        ("/api/payroll/payments/{id}/confirm", Post, "Confirmar recebimento de pagamento fixo", "Equipe", true, false),
        ("/api/admin/financeiro", Get, "Resumo financeiro da loja", "Admin - Financeiro", true, false),
        ("/api/admin/financeiro/lucro", Get, "Lucro por periodo", "Admin - Financeiro", true, false),
        ("/api/admin/shipping-settings", Get, "Config de frete (preco por km)", "Admin - Config", true, false),
        ("/api/admin/shipping-settings", Put, "Salvar config de frete", "Admin - Config", true, true),
        ("/api/admin/store-status", Get, "Horario e status da loja (admin)", "Admin - Config", true, false),
        ("/api/admin/store-hours", Put, "Salvar horario de funcionamento", "Admin - Config", true, true),
        ("/api/admin/store-manual-status", Put, "Abrir ou fechar a loja manualmente", "Admin - Config", true, true),
        ("/api/admin/onboarding-gate", Get, "Status do gate de onboarding", "Admin - Config", true, false),
        ("/api/admin/onboarding-gate", Post, "Concluir etapa do onboarding", "Admin - Config", true, true),
        ("/api/admin/message-templates", Get, "Templates de mensagem automatica", "Admin - Config", true, false),
        ("/api/admin/message-templates/{key}", Put, "Salvar template de mensagem", "Admin - Config", true, true),
        ("/api/admin/appointments", Get, "Agendamentos da loja", "Agendamentos", true, false),
        ("/api/admin/appointments/{id}/cancel", Post, "Cancelar agendamento (lojista)", "Agendamentos", true, false),
        ("/api/admin/whatsapp/status", Get, "Status da conexao WhatsApp da loja", "WhatsApp", true, false),
        ("/api/admin/whatsapp/connect", Get, "Gerar QR code de conexao", "WhatsApp", true, false),
        ("/api/admin/whatsapp/logout", Post, "Desconectar WhatsApp da loja", "WhatsApp", true, false),
        ("/api/admin/whatsapp/connection-events", Get, "Eventos de conexao do WhatsApp", "WhatsApp", true, false),
        ("/api/admin/whatsapp/notify-order-ready", Post, "Avisar cliente que o pedido esta pronto", "WhatsApp", true, true),
        ("/api/admin/whatsapp/notify-coupon-grant", Post, "Enviar cupom ao cliente", "WhatsApp", true, true),
        ("/api/admin/assistant-ia/simulate-message", Post, "Simular mensagem de cliente (Novo Chat)", "Assistente IA", true, true),
        ("/api/admin/assistant-ia/conversations", Get, "Conversas da Assistente IA", "Assistente IA", true, false),
        ("/api/admin/assistant-ia/conversations/{id}/messages", Get, "Mensagens de uma conversa", "Assistente IA", true, false),
        ("/api/admin/assistant-ia/conversations/{id}/assistant-enabled", Put, "Ligar ou desligar a IA numa conversa", "Assistente IA", true, true),
        ("/api/admin/assistant-ia/conversations/{id}", Delete, "Excluir conversa", "Assistente IA", true, false),
        ("/api/motoboy/orders", Get, "Pedidos atribuidos ao motoboy", "Motoboy", true, false),
        ("/api/motoboy/orders/{id}/status", Patch, "Mudar status da entrega", "Motoboy", true, true),
        ("/api/motoboy/orders/request-location", Post, "Pedir localizacao ao cliente", "Motoboy", true, true),
        ("/api/motoboy/orders/{id}/pix", Post, "Gerar Pix pra cobrar na entrega (credencial da loja)", "Motoboy", true, false),
        ("/api/motoboy/runs/start", Post, "Iniciar corrida de entrega", "Motoboy", true, true),
        ("/api/motoboy/whatsapp/status", Get, "Status do WhatsApp do motoboy", "Motoboy", true, false),
        ("/api/motoboy/whatsapp/connect", Get, "QR code do WhatsApp do motoboy", "Motoboy", true, false),
        ("/api/motoboy/whatsapp/logout", Post, "Desconectar WhatsApp do motoboy", "Motoboy", true, false),
        ("/api/motoboy/whatsapp/notify-location-request", Post, "Pedir localizacao (WhatsApp do motoboy)", "Motoboy", true, true),
        ("/api/motoboy/whatsapp/notify-en-route", Post, "Avisar que saiu pra entrega", "Motoboy", true, true),
        ("/api/webhooks/mercadopago", Get, "Webhook Mercado Pago (verificacao)", "Webhooks", false, false),
        ("/api/webhooks/mercadopago", Post, "Webhook Mercado Pago (evento)", "Webhooks", false, true),
        ("/api/webhooks/evolution", Post, "Webhook Evolution API (WhatsApp recebido)", "Webhooks", false, true),
        // Vertical eletronicos (assistencia tecnica) -- schema `eletronicos`
        // proprio (ver migrations/0022_eletronicos_module.sql), so serve
        // tenants com vertical='eletronicos'. Ver src/routes/eletronicos.rs.
        ("/api/admin/eletronicos/service-requests", Get, "Listar solicitacoes de servico", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-requests", Post, "Criar solicitacao de servico", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-requests/{id}", Get, "Detalhe da solicitacao", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-requests/{id}/status", Post, "Avancar status da solicitacao", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-requests/{id}/quote-value", Patch, "Atualizar so o valor do orcamento, sem notificar WhatsApp (usado ao salvar checklist da OS)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-requests/{request_id}/service-order", Get, "Ordem de servico do atendimento (cria se nao existir)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-orders/{id}/checklist", Post, "Salvar checklist da OS", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-orders/{id}/updates", Get, "Timeline de atualizacoes da OS", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-orders/{id}/updates", Post, "Registrar atualizacao na OS", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-orders/{id}/complete", Post, "Concluir OS (calcula valor, baixa estoque, garantia)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-orders/{id}/reopen", Post, "Reabrir OS ja concluida", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/agenda/settings", Get, "Configuracao da agenda (duracao, buffer, antecedencia)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/agenda/business-hours", Get, "Horario de funcionamento por dia da semana", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/appointments", Get, "Listar agendamentos", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/appointments", Post, "Criar agendamento (valida conflito e expediente)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/appointments/{id}/cancel", Post, "Cancelar agendamento (justificativa >=20 chars + aviso WhatsApp padrao ou customizado)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/appointments/{id}/reschedule", Patch, "Remarcar agendamento (revalida conflito/expediente, aviso WhatsApp padrao ou customizado)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/appointments/{id}/complete", Post, "Concluir agendamento", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/appointments/{id}/events", Get, "Historico de eventos do agendamento (timeline)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/agenda/day", Get, "Grade de horarios do dia (livre/ocupado/bloqueado/muito em cima)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/agenda/blocks", Get, "Listar bloqueios de horario do dia", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/agenda/blocks", Post, "Criar bloqueio de horario", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/agenda/blocks/{id}", Delete, "Remover bloqueio de horario", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/agenda/settings", Put, "Editar configuracao de agendamento (antecedencia/buffer/IA)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/agenda/business-hours", Put, "Editar horario de funcionamento (blocos por dia da semana)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/stock-items", Get, "Listar itens de estoque (pecas)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/stock-items", Post, "Cadastrar item de estoque", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/stock-items/{id}/entry", Post, "Entrada de estoque (compra de pecas)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/stock-items/{id}/exit", Post, "Saida manual de estoque (uso/perda fora de venda/OS)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/stock-items/{id}", Put, "Editar item de estoque (nome/qtd/unidade/custo/garantia/alerta)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/stock-items/{id}", Delete, "Excluir item de estoque", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/stock-movements", Get, "Ultimas movimentacoes de estoque (entrada/saida)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/stock-activity-log", Get, "Feed de atividade de estoque (criados/editados/removidos/baixo estoque/em falta)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/error-log", Get, "Listar erros registrados do painel eletronica", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/error-log", Post, "Reportar erro de cliente (JS) do painel eletronica", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/error-log/{id}/resolve", Post, "Marcar erro registrado como resolvido", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-requests/{id}/credential", Get, "Obter PIN/padrao de desbloqueio do aparelho", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-requests/{id}/credential", Put, "Salvar PIN/padrao de desbloqueio do aparelho", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-requests/{id}/diagnostic", Get, "Obter diagnostico/orcamento do atendimento", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/service-requests/{id}/diagnostic", Put, "Salvar diagnostico (avanca status automaticamente conforme valor)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-orders-closed", Get, "Ordens de servico fechadas (relatorios)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/shipping-settings", Get, "Config de frete da vertical eletronicos", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/shipping-settings", Put, "Salvar config de frete da vertical eletronicos", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/mercadopago-status", Get, "Status (somente leitura) da conexao Mercado Pago do tenant", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/driver-location", Get, "Ultima localizacao ao vivo do tecnico (mapa de trajetoria)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/driver-location", Put, "Atualiza a localizacao ao vivo do tecnico (push periodico do browser)", "Admin - Eletronicos", true, true),
        ("/api/public/eletronicos/{slug}/driver-location", Get, "Localizacao ao vivo do tecnico (publico, usado em /consultar)", "Publico - Eletronicos", false, false),
        ("/api/admin/eletronicos/catalog-categories", Get, "Listar categorias (marcas) do catalogo de servicos", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/catalog-categories", Post, "Criar categoria (marca) do catalogo de servicos", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/catalog-categories/{id}", Put, "Atualizar categoria (marca) do catalogo de servicos", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/catalog-categories/{id}", Delete, "Excluir categoria (marca) do catalogo de servicos", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/catalog-items", Get, "Listar itens (servicos/modelos) do catalogo", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/catalog-items", Post, "Criar item (servico/modelo) do catalogo", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/catalog-items/{id}", Put, "Atualizar item (servico/modelo) do catalogo", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/catalog-items/{id}", Delete, "Excluir item (servico/modelo) do catalogo", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/products-links/{id}", Put, "Salvar vinculo aparelho/marca/modelo de um produto", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/products-devices", Get, "Listar vinculos produto-aparelho", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/products-brands", Get, "Listar vinculos produto-marca", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/products-models", Get, "Listar vinculos produto-modelo", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/device-types", Get, "Listar aparelhos (celular/tablet/notebook/computador)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/device-types", Post, "Criar aparelho", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/device-types/{id}", Put, "Atualizar aparelho", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/device-types/{id}", Delete, "Excluir aparelho", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/catalog-models", Get, "Listar modelos (ex: iPhone 14 Pro)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/catalog-models", Post, "Criar modelo", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/catalog-models/{id}", Put, "Atualizar modelo", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/catalog-models/{id}", Delete, "Excluir modelo", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/pdv/sales", Post, "Abrir venda no PDV", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/pdv/sales/{id}", Get, "Detalhe da venda (itens + pagamentos)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/pdv/sales/{id}", Delete, "Cancelar venda aberta (devolve pecas de estoque decrementadas)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/pdv/sales/{id}/items", Post, "Adicionar item a venda (decrementa estoque se aplicavel)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/pdv/sales/{id}/payments", Post, "Registrar pagamento (Pix ja gerado via /api/admin/pdv/pix, ou manual)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/pdv/sales/{sale_id}/payments/{payment_id}/confirm", Post, "Confirmar pagamento (fecha a venda se cobrir o total)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/templates", Get, "Listar templates de WhatsApp (Template Zap)", "Admin - Eletronicos", true, false),
        ("/api/admin/eletronicos/templates/{key}", Put, "Editar conteudo de um template (valida variaveis obrigatorias)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/templates/{key}/toggle", Patch, "Ligar/desligar disparo de um template", "Admin - Eletronicos", true, true),
        ("/api/public/eletronicos/{slug}/service-requests", Post, "Vitrine: cliente cria solicitacao de servico (sem login)", "Publico - Eletronicos", false, true),
        ("/api/public/eletronicos/{slug}/consultar-otp", Post, "Vitrine: verifica telefone e envia codigo OTP por WhatsApp (etapa 1 da Consulta)", "Publico - Eletronicos", false, true),
        ("/api/public/eletronicos/{slug}/consultar-verify", Post, "Vitrine: valida codigo OTP e retorna atendimentos/agendamentos do telefone (etapa 2 da Consulta)", "Publico - Eletronicos", false, true),
        ("/api/public/eletronicos/{slug}/consultar-cancel", Post, "Vitrine: cliente cancela a propria solicitacao pendente (telefone precisa bater com o dono)", "Publico - Eletronicos", false, true),
        ("/api/public/eletronicos/{slug}/upload", Post, "Vitrine: upload de foto/video do aparelho (multipart, campo file)", "Publico - Eletronicos", false, true),
        ("/api/admin/eletronicos/upload", Post, "Admin: upload de foto/video/pdf (multipart, campo file)", "Admin - Eletronicos", true, true),
        ("/api/admin/eletronicos/service-orders/{id}/pdf", Post, "Salva a URL do PDF gerado da OS", "Admin - Eletronicos", true, true),
        ("/api/public/eletronicos/{slug}/catalog", Get, "Vitrine: catalogo de marcas/modelos/servicos pro wizard de solicitacao", "Publico - Eletronicos", false, false),
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
                .title("Resolutoo — API da Loja (ecommerce-api)")
                .version(env!("CARGO_PKG_VERSION"))
                .description(Some(
                    "API da loja de cada tenant do Resolutoo: vitrine pública (catálogo, serviços, \
                     agendamento), checkout e pagamentos (Pix/cartão via Mercado Pago), painel do \
                     lojista (produtos, estoque/ERP, pedidos, PDV, financeiro, equipe), WhatsApp \
                     (Evolution API) e Assistente IA. Rotas públicas resolvem o tenant pelo `slug` \
                     da URL; as marcadas com cadeado exigem Bearer JWT do login de admin/motoboy.",
                ))
                .build(),
        )
        .servers(Some(vec![
            Server::new("https://ecommerce-api-production-d447.up.railway.app"),
            Server::new("http://localhost:8080"),
        ]))
        .paths(paths)
        .tags(Some(vec![
            Tag::new("Sistema"),
            Tag::new("Auth"),
            Tag::new("Publico"),
            Tag::new("Assistente IA"),
            Tag::new("Agendamentos"),
            Tag::new("Pagamentos"),
            Tag::new("Pedidos"),
            Tag::new("PDV"),
            Tag::new("Admin - Catalogo"),
            Tag::new("Admin - Estoque"),
            Tag::new("Admin - Pedidos"),
            Tag::new("Admin - Equipe"),
            Tag::new("Admin - Financeiro"),
            Tag::new("Admin - Config"),
            Tag::new("WhatsApp"),
            Tag::new("Motoboy"),
            Tag::new("Webhooks"),
        ]))
        .components(Some(components))
        .build()
}
