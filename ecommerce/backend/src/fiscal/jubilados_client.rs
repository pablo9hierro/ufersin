//! Cliente HTTP pro módulo fiscal Jubilados (.NET, backend separado --
//! repo `pablo9hierro/ouvir`, pasta `jubilados/`). Mesmo estilo de
//! `delivery/providers/uber_direct.rs`: `reqwest::Client` compartilhado,
//! erro tratado por `AppError`, nunca confia cegamente na resposta.
//!
//! Autenticação: header `X-Internal-Key` (RequireAuthFilter.cs do lado do
//! Jubilados, adicionado nesta mesma integração -- antes os controllers
//! fiscais não exigiam nada). Nunca chega ao navegador.
//!
//! ⚠️ Payload do endpoint de produto (`Jubilados.Domain.Entities.Produto`)
//! tem campos com sigla (NCM/CFOP/CST/CSOSN/CEST/EAN) -- o
//! `JsonNamingPolicy.CamelCase` padrão do .NET só faz lower no primeiro
//! caractere ("NCM" -> "nCM"), não uma conversão camelCase "de verdade".
//! Como o Jubilados também liga `PropertyNameCaseInsensitive = true`
//! (`Program.cs`), mandar tudo em minúsculo simples (`"ncm"`, `"cfop"`)
//! funciona nos dois sentidos sem depender de acertar a sigla exata --
//! por isso os `#[serde(rename = "...")]` abaixo usam minúsculo explícito
//! em vez de `rename_all = "camelCase"` só nesses campos.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

use super::{DocumentKind, FiscalItem};

pub struct JubiladosClient {
    http: reqwest::Client,
    base_url: String,
    internal_key: String,
}

/// Controllers do Jubilados sempre respondem erro como `{ "erro": "..." }`
/// (português, confirmado em todos os `BadRequest(new { erro = ... })` do
/// código) -- nunca `"error"`.
#[derive(Debug, Deserialize)]
struct JubiladosErrorBody {
    erro: Option<String>,
}

impl JubiladosClient {
    pub fn new(http: reqwest::Client, base_url: String, internal_key: String) -> Self {
        Self { http, base_url: base_url.trim_end_matches('/').to_string(), internal_key }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn error_from_response(resp: reqwest::Response) -> AppError {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<JubiladosErrorBody>(&text)
            .ok()
            .and_then(|b| b.erro)
            .unwrap_or(text);
        AppError::BadRequest(format!("jubilados respondeu {status}: {msg}"))
    }

    /// Garante que o produto exista no Jubilados com os dados fiscais
    /// atuais (cria se `jubilados_produto_id` for `None`, atualiza senão)
    /// -- `EmitirNFeDto.Itens` referencia um `ProdutoId` real de lá, não
    /// aceita dados fiscais soltos no corpo da emissão (confirmado lendo
    /// `NFeDto.cs`).
    pub async fn upsert_produto(
        &self,
        empresa_id: Uuid,
        item: &FiscalItem,
    ) -> Result<Uuid, AppError> {
        let body = ProdutoPayload {
            empresa_id,
            nome: item.product_name.clone(),
            ncm: item.ncm.clone().unwrap_or_default(),
            cfop: item.cfop.clone().unwrap_or_default(),
            cst: item.cst.clone().unwrap_or_default(),
            csosn: item.csosn.clone(),
            cest: item.cest.clone(),
            unidade: item.unidade_fiscal.clone().unwrap_or_else(|| "UN".to_string()),
            origem: item.origem.clone().unwrap_or_else(|| "0".to_string()),
            preco: item.unit_price,
            ean: item.ean.clone(),
            // Confirmado obrigatório pelo próprio Jubilados (valida contra
            // a tabela oficial ao vivo do Portal de Classificação
            // Tributária) -- CST/CstIbsCbs/ReducaoIbs/ReducaoCbs são
            // DERIVADOS disso pelo servidor, nunca mandamos nosso palpite.
            cclass_trib: item.cclass_trib.clone().unwrap_or_default(),
            ativo: true,
        };

        let resp = if let Some(id) = item.jubilados_produto_id {
            self.http
                .put(self.url(&format!("/api/produto/{id}")))
                .header("X-Internal-Key", &self.internal_key)
                .json(&body)
                .send()
                .await
        } else {
            self.http
                .post(self.url("/api/produto"))
                .header("X-Internal-Key", &self.internal_key)
                .json(&body)
                .send()
                .await
        }
        .map_err(|e| AppError::Internal(format!("jubilados produto request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        let produto: ProdutoResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("jubilados produto parse failed: {e}")))?;
        Ok(produto.id)
    }

    pub async fn emitir(
        &self,
        kind: DocumentKind,
        empresa_id: Uuid,
        ambiente: &str,
        serie: &str,
        cfop_padrao: &str,
        order_reference: &str,
        items: &[(FiscalItem, Uuid)],
    ) -> Result<EmitirResult, AppError> {
        // "1"=produção,"2"=homologação -- confirmado em NFeDto.cs, nunca
        // deixamos `null`/omitido (sidestepa o gap de Ambiente não existir
        // ainda por-empresa no Jubilados, ver plano).
        let ambiente_code = if ambiente == "producao" { "1" } else { "2" };

        let itens: Vec<ItemPayload> = items
            .iter()
            .map(|(item, jubilados_id)| ItemPayload {
                produto_id: *jubilados_id,
                quantidade: item.quantity as f64,
                valor_unitario: item.unit_price,
                valor_desconto: 0.0,
            })
            .collect();
        let _ = cfop_padrao; // CFOP é do produto no Jubilados, não da requisição de emissão.

        match kind {
            DocumentKind::NFe => {
                let body = EmitirNFeRequest {
                    empresa_id,
                    cliente_id: None,
                    natureza_operacao: "Venda de mercadoria".to_string(),
                    serie: serie.to_string(),
                    itens,
                    ambiente: ambiente_code.to_string(),
                    informacao_complementar: Some(format!("Pedido Resolutoo #{order_reference}")),
                };
                let resp = self
                    .http
                    .post(self.url("/api/nfe/emitir"))
                    .header("X-Internal-Key", &self.internal_key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("jubilados emitir nfe request failed: {e}")))?;
                if !resp.status().is_success() {
                    return Err(Self::error_from_response(resp).await);
                }
                let parsed: NFeResultResponse = resp
                    .json()
                    .await
                    .map_err(|e| AppError::Internal(format!("jubilados emitir nfe parse failed: {e}")))?;
                Ok(parsed.into())
            }
            DocumentKind::NFCe => {
                let body = EmitirNFCeRequest {
                    empresa_id,
                    itens,
                    serie: serie.to_string(),
                    forma_pagamento: "01".to_string(),
                    ambiente: ambiente_code.to_string(),
                    informacao_complementar: Some(format!("Pedido Resolutoo #{order_reference}")),
                };
                let resp = self
                    .http
                    .post(self.url("/api/nfe/emitir-nfce"))
                    .header("X-Internal-Key", &self.internal_key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("jubilados emitir nfce request failed: {e}")))?;
                if !resp.status().is_success() {
                    return Err(Self::error_from_response(resp).await);
                }
                let parsed: NFCeResultResponse = resp
                    .json()
                    .await
                    .map_err(|e| AppError::Internal(format!("jubilados emitir nfce parse failed: {e}")))?;
                Ok(parsed.into())
            }
        }
    }

    /// Passthrough da tabela oficial de Classificação Tributária (IBS/CBS)
    /// que o Jubilados já busca/cacheia do Portal do governo -- nunca
    /// inventamos código aqui, o admin escolhe de uma lista real.
    pub async fn listar_classificacao_tributaria(&self) -> Result<serde_json::Value, AppError> {
        let resp = self
            .http
            .get(self.url("/api/produto/classificacao-tributaria"))
            .header("X-Internal-Key", &self.internal_key)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("jubilados classificacao-tributaria request failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        resp.json()
            .await
            .map_err(|e| AppError::Internal(format!("jubilados classificacao-tributaria parse failed: {e}")))
    }

    pub async fn cancelar(
        &self,
        empresa_id: Uuid,
        nota_fiscal_id: Uuid,
        justificativa: &str,
    ) -> Result<(), AppError> {
        let body = CancelarRequest {
            empresa_id,
            nota_fiscal_id,
            justificativa: justificativa.to_string(),
        };
        let resp = self
            .http
            .post(self.url("/api/nfe/cancelar"))
            .header("X-Internal-Key", &self.internal_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("jubilados cancelar request failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        let parsed: CancelamentoResultResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("jubilados cancelar parse failed: {e}")))?;
        if !parsed.sucesso {
            return Err(AppError::BadRequest(format!(
                "SEFAZ recusou o cancelamento: {}",
                parsed.x_motivo
            )));
        }
        Ok(())
    }
}

pub struct EmitirResult {
    pub sucesso: bool,
    pub cstat: String,
    pub xmotivo: String,
    pub nota_fiscal_id: Option<Uuid>,
    pub chave_acesso: Option<String>,
    pub protocolo: Option<String>,
}

impl From<NFeResultResponse> for EmitirResult {
    fn from(r: NFeResultResponse) -> Self {
        Self {
            sucesso: r.sucesso,
            cstat: r.c_stat,
            xmotivo: r.x_motivo,
            nota_fiscal_id: r.nota_fiscal_id,
            chave_acesso: r.chave_acesso,
            protocolo: r.protocolo,
        }
    }
}

impl From<NFCeResultResponse> for EmitirResult {
    fn from(r: NFCeResultResponse) -> Self {
        Self {
            sucesso: r.sucesso,
            cstat: r.c_stat,
            xmotivo: r.x_motivo,
            nota_fiscal_id: r.nota_fiscal_id,
            chave_acesso: r.chave_acesso,
            protocolo: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemPayload {
    produto_id: Uuid,
    quantidade: f64,
    valor_unitario: f64,
    valor_desconto: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmitirNFeRequest {
    empresa_id: Uuid,
    cliente_id: Option<Uuid>,
    natureza_operacao: String,
    serie: String,
    itens: Vec<ItemPayload>,
    ambiente: String,
    informacao_complementar: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmitirNFCeRequest {
    empresa_id: Uuid,
    itens: Vec<ItemPayload>,
    serie: String,
    forma_pagamento: String,
    ambiente: String,
    informacao_complementar: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelarRequest {
    empresa_id: Uuid,
    nota_fiscal_id: Uuid,
    justificativa: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NFeResultResponse {
    sucesso: bool,
    #[serde(rename = "cStat")]
    c_stat: String,
    #[serde(rename = "xMotivo")]
    x_motivo: String,
    nota_fiscal_id: Option<Uuid>,
    chave_acesso: Option<String>,
    protocolo: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NFCeResultResponse {
    sucesso: bool,
    #[serde(rename = "cStat")]
    c_stat: String,
    #[serde(rename = "xMotivo")]
    x_motivo: String,
    nota_fiscal_id: Option<Uuid>,
    chave_acesso: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelamentoResultResponse {
    sucesso: bool,
    #[serde(rename = "xMotivo")]
    x_motivo: String,
}

/// Payload do `Produto` do Jubilados -- ver aviso no topo do arquivo sobre
/// por que os campos com sigla usam `rename` explícito em minúsculo.
#[derive(Debug, Serialize)]
struct ProdutoPayload {
    #[serde(rename = "empresaId")]
    empresa_id: Uuid,
    nome: String,
    #[serde(rename = "ncm")]
    ncm: String,
    #[serde(rename = "cfop")]
    cfop: String,
    #[serde(rename = "cst")]
    cst: String,
    #[serde(rename = "csosn")]
    csosn: Option<String>,
    #[serde(rename = "cest")]
    cest: Option<String>,
    unidade: String,
    origem: String,
    preco: f64,
    #[serde(rename = "ean")]
    ean: Option<String>,
    #[serde(rename = "cclassTrib")]
    cclass_trib: String,
    ativo: bool,
}

#[derive(Debug, Deserialize)]
struct ProdutoResponse {
    id: Uuid,
}
