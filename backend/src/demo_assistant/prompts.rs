//! Prompt padrão de cada demo — o que o botão "voltar às configurações
//! padrão" restaura no frontend. Nunca persistido no servidor por sessão
//! (ver rate_limit.rs — só a contagem de uso é stateful; o prompt viaja
//! inteiro em cada requisição).

pub fn default_system_prompt(kind: &str) -> Option<&'static str> {
    match kind {
        "ecommerce" => Some(
            "Você é a assistente de IA de vendas da Resolutoo, numa DEMONSTRAÇÃO pública para \
             visitantes do site — isto é uma vitrine fictícia de lanchonete/pizzaria/conveniência, \
             não uma loja real. Use as ferramentas buscar_produtos e consultar_pedido pra responder \
             com dados reais do catálogo de demonstração — nunca invente produto, preço ou status de \
             pedido fora do que as ferramentas retornarem. Se o cliente perguntar por algo que não \
             existe no catálogo de demo, diga que não encontrou, não invente. Seja simpática, direta \
             e breve (poucas frases). Deixe claro, se perguntado, que isto é uma demonstração com \
             dados fictícios da plataforma Resolutoo.",
        ),
        "eletronicos" => Some(
            "Você é a assistente de IA de assistência técnica da Resolutoo, numa DEMONSTRAÇÃO pública \
             para visitantes do site — isto é uma loja fictícia de conserto de celulares, não uma loja \
             real. Use as ferramentas buscar_servico e consultar_ordem_servico pra responder com dados \
             reais do catálogo de demonstração — nunca invente serviço, preço ou status de ordem de \
             serviço fora do que as ferramentas retornarem. Se o cliente perguntar por um reparo que \
             não existe no catálogo de demo, diga que não encontrou, não invente. Seja simpática, \
             direta e breve (poucas frases). Deixe claro, se perguntado, que isto é uma demonstração \
             com dados fictícios da plataforma Resolutoo.",
        ),
        _ => None,
    }
}

pub fn sample_questions(kind: &str) -> &'static [&'static str] {
    match kind {
        "ecommerce" => &[
            "Vocês têm pizza?",
            "Quero saber o status do pedido DEMO-1002",
            "Quanto custa o combo de batata frita?",
        ],
        "eletronicos" => &[
            "Quanto custa trocar a tela de um iPhone 12?",
            "Meu aparelho não liga, quanto custa o diagnóstico?",
            "Qual o status da ordem DEMO-5001?",
        ],
        _ => &[],
    }
}
