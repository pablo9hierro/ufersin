//! Dados fixos da demo pública de IA — NUNCA vêm de `ecommerce/backend` nem
//! do schema `resolutoo` de tenant real. Existem só pra dar à IA algo
//! concreto pra consultar via tool-calling, igual um catálogo/pedido de
//! verdade teria, mas sem tocar nenhum dado de cliente pagante.

use serde::Serialize;

/// Links sugeridos nas respostas da demo — de propósito, NÃO são tenants
/// reais (isso já foi cogitado e descartado): apontam pro fluxo de demo
/// mockada que já existe (Demo.tsx/DemoPlano.tsx/DemoPlanoEletronica.tsx),
/// caminho relativo (mesma origem do site em qualquer ambiente, local ou
/// produção).
pub const ECOMMERCE_STOREFRONT_URL: &str = "/demo/vitrine/essential";
pub const ELETRONICOS_STOREFRONT_URL: &str = "/demo/eletronica/essential";

#[derive(Debug, Clone, Serialize)]
pub struct DemoProduct {
    pub name: &'static str,
    pub price: f64,
    pub category: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct DemoOrder {
    pub id: &'static str,
    pub items: &'static str,
    pub status: &'static str,
    pub extra: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct DemoService {
    pub name: &'static str,
    pub price_from: f64,
    pub price_to: Option<f64>,
    pub eta: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct DemoServiceOrder {
    pub id: &'static str,
    pub device: &'static str,
    pub issue: &'static str,
    pub status: &'static str,
}

/// Mesmo catálogo EXATO da demo mockada de vitrine já existente
/// (`ecommerce/frontend/src/lib/localData.ts`, ativada por `/demo-entrar`,
/// é o que `/demo/vitrine/essential` mostra de verdade) — nomes, preços e
/// categorias idênticos, pra não divergir do que o visitante vê clicando
/// na vitrine de verdade. `Batata Frita` está com estoque 0 lá (fora de
/// estoque), replicado aqui.
pub fn ecommerce_products() -> &'static [DemoProduct] {
    &[
        DemoProduct { name: "Refrigerante Lata", price: 6.00, category: "Bebidas" },
        DemoProduct { name: "Suco Natural", price: 8.50, category: "Bebidas" },
        DemoProduct { name: "Milk-shake", price: 13.90, category: "Bebidas" },
        DemoProduct { name: "Sanduíche Natural", price: 14.90, category: "Lanches" },
        DemoProduct { name: "Hambúrguer Artesanal", price: 24.90, category: "Lanches" },
        DemoProduct { name: "Pudim de Leite", price: 9.90, category: "Sobremesas" },
        DemoProduct { name: "Brownie com Sorvete", price: 12.90, category: "Sobremesas" },
    ]
}

/// Sem estoque na vitrine real (quantity: 0 em localData.ts) — a IA precisa
/// saber disso pra não vender o que não tem.
pub const OUT_OF_STOCK: &[&str] = &["Batata Frita"];

/// Mesmos status/produtos/totais dos 5 pedidos de exemplo em localData.ts
/// (vocabulário de status idêntico ao painel real: pendente, montando_pedido,
/// pedido_pronto, em_rota_de_entrega, concluido) — só o ID é próprio daqui
/// (o sistema mockado gera IDs aleatórios por sessão de navegador, sem
/// correspondência fixa possível).
pub fn ecommerce_orders() -> &'static [DemoOrder] {
    &[
        DemoOrder { id: "DEMO-1001", items: "2x Hambúrguer Artesanal", status: "pendente", extra: "pagamento Pix pendente" },
        DemoOrder { id: "DEMO-1002", items: "1x Sanduíche Natural", status: "montando_pedido", extra: "" },
        DemoOrder { id: "DEMO-1003", items: "3x Refrigerante Lata", status: "pedido_pronto", extra: "pagamento na entrega (dinheiro)" },
        DemoOrder { id: "DEMO-1004", items: "2x Pudim de Leite", status: "em_rota_de_entrega", extra: "motoboy a caminho" },
        DemoOrder { id: "DEMO-1005", items: "1x Brownie com Sorvete", status: "concluido", extra: "retirada no local" },
    ]
}

pub fn eletronicos_services() -> &'static [DemoService] {
    &[
        DemoService { name: "Troca de tela iPhone 12", price_from: 480.0, price_to: None, eta: "2 horas" },
        DemoService { name: "Troca de bateria Galaxy S21", price_from: 180.0, price_to: None, eta: "1 hora" },
        DemoService { name: "Diagnóstico geral (aparelho não liga)", price_from: 50.0, price_to: None, eta: "24 horas — valor abatido se o orçamento for aprovado" },
        DemoService { name: "Reparo de placa-mãe (oxidação)", price_from: 250.0, price_to: Some(450.0), eta: "3 a 5 dias úteis" },
        DemoService { name: "Troca de conector de carga", price_from: 120.0, price_to: None, eta: "1 hora" },
    ]
}

pub fn eletronicos_orders() -> &'static [DemoServiceOrder] {
    &[
        DemoServiceOrder { id: "DEMO-5001", device: "iPhone 12", issue: "tela trincada", status: "aguardando aprovação do orçamento" },
        DemoServiceOrder { id: "DEMO-5002", device: "Galaxy S21", issue: "troca de bateria", status: "em reparo" },
        DemoServiceOrder { id: "DEMO-5003", device: "Motorola Edge 30", issue: "troca de tela", status: "pronto para retirada" },
    ]
}
