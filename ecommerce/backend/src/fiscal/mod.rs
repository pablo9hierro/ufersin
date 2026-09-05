//! Emissão fiscal (NF-e/NFC-e) na venda de produtos, integrando com o
//! módulo Jubilados (ASP.NET Core/.NET separado, repo `pablo9hierro/ouvir`,
//! pasta `jubilados/`) -- NÃO é um segundo emissor fiscal, é só o cliente
//! HTTP que fala com o emissor que já existe e já funciona de verdade
//! (validado em produção pra Paraíba). Ver `jubilados_client.rs`.
//!
//! Direção do pedido explícita: `Módulo comercial → FiscalService →
//! Jubilados → SEFAZ`, nunca `Frontend → Jubilados` -- o navegador nunca
//! fala com o Jubilados, só este backend.

pub mod jubilados_client;

use serde::{Deserialize, Serialize};

/// Bate com o CHECK constraint de `fiscal_documents.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FiscalStatus {
    Processando,
    Autorizada,
    Rejeitada,
    Cancelada,
    Erro,
}

impl FiscalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            FiscalStatus::Processando => "processando",
            FiscalStatus::Autorizada => "autorizada",
            FiscalStatus::Rejeitada => "rejeitada",
            FiscalStatus::Cancelada => "cancelada",
            FiscalStatus::Erro => "erro",
        }
    }
}

/// NF-e (modelo 55, venda "de fora" -- entrega/retirada) vs NFC-e (modelo
/// 65, venda de balcão/PDV) -- decidido pelo `delivery_type` do pedido já
/// existente, sem inventar uma segunda distinção (seção 3/43 do pedido).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentKind {
    NFe,
    NFCe,
}

impl DocumentKind {
    pub fn from_order_delivery_type(delivery_type: &str) -> Self {
        if delivery_type == "balcao" {
            DocumentKind::NFCe
        } else {
            DocumentKind::NFe
        }
    }

    pub fn modelo(self) -> &'static str {
        match self {
            DocumentKind::NFe => "55",
            DocumentKind::NFCe => "65",
        }
    }
}

/// Dados fiscais do item -- confirmados presentes/ausentes na tabela
/// `products` conforme a auditoria (NCM/CFOP/CST/CSOSN/CEST/origem/
/// unidade_fiscal). `None` em qualquer campo obrigatório bloqueia a
/// emissão (seção 44 do pedido: nunca preencher com valor inventado).
#[derive(Debug, Clone)]
pub struct FiscalItem {
    pub product_id: String,
    pub jubilados_produto_id: Option<uuid::Uuid>,
    pub product_name: String,
    pub ncm: Option<String>,
    pub cfop: Option<String>,
    pub cst: Option<String>,
    pub csosn: Option<String>,
    pub cest: Option<String>,
    pub origem: Option<String>,
    pub unidade_fiscal: Option<String>,
    pub ean: Option<String>,
    /// Código oficial do Portal de Classificação Tributária (Reforma/IBS-
    /// CBS) -- o Jubilados valida isso contra a tabela oficial ao vivo, é
    /// obrigatório de verdade (confirmado lendo `ProdutoController.
    /// CriarAsync`, não uma suposição).
    pub cclass_trib: Option<String>,
    pub quantity: i64,
    pub unit_price: f64,
}

/// Por que um item não pode ser emitido -- mostrado ao lojista em vez de
/// um erro genérico (seção 44).
#[derive(Debug, Clone)]
pub struct FiscalValidationError {
    pub product_id: String,
    pub product_name: String,
    pub missing_fields: Vec<&'static str>,
}

/// Valida que todo item tem o mínimo fiscal obrigatório antes de sequer
/// tentar montar a chamada pro Jubilados -- nunca "emite mesmo assim" com
/// NCM/CFOP inventado.
pub fn validate_items(items: &[FiscalItem]) -> Vec<FiscalValidationError> {
    items
        .iter()
        .filter_map(|item| {
            let mut missing = Vec::new();
            if item.ncm.as_deref().unwrap_or("").is_empty() {
                missing.push("NCM");
            }
            if item.cfop.as_deref().unwrap_or("").is_empty() {
                missing.push("CFOP");
            }
            // Confirmado obrigatório de verdade pelo próprio Jubilados
            // (ProdutoController.CriarAsync rejeita sem isso, valida
            // contra a tabela oficial ao vivo) -- não é suposição nossa.
            if item.cclass_trib.as_deref().unwrap_or("").is_empty() {
                missing.push("Classificação Tributária (IBS/CBS)");
            }
            // CST ou CSOSN -- qual dos dois é obrigatório depende do CRT da
            // empresa (Simples Nacional usa CSOSN, regime normal usa CST);
            // exigimos pelo menos um dos dois configurado no produto, a
            // escolha de qual usar fica a cargo do Jubilados (que já decide
            // isso por `empresa.CRT`, ver NFeService.cs).
            if item.cst.as_deref().unwrap_or("").is_empty()
                && item.csosn.as_deref().unwrap_or("").is_empty()
            {
                missing.push("CST/CSOSN");
            }
            if item.unidade_fiscal.as_deref().unwrap_or("").is_empty() {
                missing.push("Unidade");
            }
            if missing.is_empty() {
                None
            } else {
                Some(FiscalValidationError {
                    product_id: item.product_id.clone(),
                    product_name: item.product_name.clone(),
                    missing_fields: missing,
                })
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(ncm: &str, cfop: &str, cst: &str, csosn: &str, unidade: &str) -> FiscalItem {
        FiscalItem {
            product_id: "p1".to_string(),
            jubilados_produto_id: None,
            product_name: "Produto Teste".to_string(),
            ncm: (!ncm.is_empty()).then(|| ncm.to_string()),
            cfop: (!cfop.is_empty()).then(|| cfop.to_string()),
            cst: (!cst.is_empty()).then(|| cst.to_string()),
            csosn: (!csosn.is_empty()).then(|| csosn.to_string()),
            cest: None,
            origem: Some("0".to_string()),
            unidade_fiscal: (!unidade.is_empty()).then(|| unidade.to_string()),
            ean: None,
            cclass_trib: Some("000001".to_string()),
            quantity: 1,
            unit_price: 10.0,
        }
    }

    #[test]
    fn item_completo_passa_sem_erros() {
        let items = vec![item("12345678", "5102", "00", "", "UN")];
        assert!(validate_items(&items).is_empty());
    }

    #[test]
    fn item_sem_ncm_bloqueia_com_motivo_claro() {
        let items = vec![item("", "5102", "00", "", "UN")];
        let errors = validate_items(&items);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].missing_fields.contains(&"NCM"));
    }

    #[test]
    fn item_sem_cst_e_sem_csosn_bloqueia() {
        let items = vec![item("12345678", "5102", "", "", "UN")];
        let errors = validate_items(&items);
        assert!(errors[0].missing_fields.contains(&"CST/CSOSN"));
    }

    #[test]
    fn item_com_csosn_em_vez_de_cst_passa() {
        let items = vec![item("12345678", "5102", "", "102", "UN")];
        assert!(validate_items(&items).is_empty());
    }

    #[test]
    fn item_sem_cclass_trib_bloqueia() {
        let mut i = item("12345678", "5102", "00", "", "UN");
        i.cclass_trib = None;
        let errors = validate_items(&[i]);
        assert!(errors[0].missing_fields.contains(&"Classificação Tributária (IBS/CBS)"));
    }

    #[test]
    fn document_kind_balcao_vira_nfce() {
        assert_eq!(DocumentKind::from_order_delivery_type("balcao"), DocumentKind::NFCe);
        assert_eq!(DocumentKind::from_order_delivery_type("entrega"), DocumentKind::NFe);
        assert_eq!(DocumentKind::from_order_delivery_type("retirada"), DocumentKind::NFe);
    }
}
