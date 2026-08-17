//! Dados fixos da demo pública de IA — NUNCA vêm de `ecommerce/backend` nem
//! do schema `resolutoo` de tenant real. Existem só pra dar à IA algo
//! concreto pra consultar via tool-calling, igual um catálogo/pedido de
//! verdade teria, mas sem tocar nenhum dado de cliente pagante.

use serde::Serialize;

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

pub fn ecommerce_products() -> &'static [DemoProduct] {
    &[
        DemoProduct { name: "Combo X-Burger Artesanal", price: 28.90, category: "Lanches" },
        DemoProduct { name: "Pizza Grande Calabresa", price: 54.90, category: "Pizzas" },
        DemoProduct { name: "Combo Batata Frita + Refrigerante", price: 22.50, category: "Combos" },
        DemoProduct { name: "Refrigerante Lata 350ml", price: 6.00, category: "Bebidas" },
        DemoProduct { name: "Cerveja Long Neck 355ml", price: 8.90, category: "Bebidas" },
        DemoProduct { name: "Essência para Narguilé 50g", price: 32.00, category: "Tabacaria" },
    ]
}

pub fn ecommerce_orders() -> &'static [DemoOrder] {
    &[
        DemoOrder { id: "DEMO-1001", items: "2x Combo X-Burger Artesanal + 1x Refrigerante Lata", status: "em preparo", extra: "bairro Centro" },
        DemoOrder { id: "DEMO-1002", items: "1x Pizza Grande Calabresa", status: "saiu para entrega", extra: "motoboy João (demo)" },
        DemoOrder { id: "DEMO-1003", items: "1x Combo Batata Frita + Refrigerante", status: "entregue", extra: "" },
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
