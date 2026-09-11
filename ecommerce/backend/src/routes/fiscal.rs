//! Admin-facing: configuração fiscal da loja + emissão de NF-e/NFC-e por
//! pedido. Tudo atrás de `AdminUser` + `Feature::EmissaoFiscal` (liberado
//! só por linha em `feature_flags`, nunca hardcode de tenant aqui) --
//! mesmo padrão de `routes/delivery.rs`.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::fiscal::{self, jubilados_client::{FreightInfo, JubiladosClient}, DocumentKind, FiscalItem};
use crate::orders_common;
use crate::state::AppState;
use crate::tenant;

async fn require_beta(pool: &sqlx::PgPool, tenant_id: &str) -> Result<(), AppError> {
    features::require_feature(pool, tenant_id, Feature::EmissaoFiscal).await
}

/// Frete/pagamento reais do pedido pra DANFE -- sem isso ela sempre mostrava
/// "Sem Frete" e pagamento em branco mesmo em pedido com entrega paga e
/// método real. Códigos conforme NFeDto.cs do Jubilados (ver jubilados_client.rs).
fn order_freight_info(order: &crate::models::OrderRow) -> FreightInfo {
    let forma_pagamento = match (order.payment_method.as_str(), order.card_type.as_deref()) {
        ("pix", _) => "17",
        ("cartao", Some("debito")) => "04",
        ("cartao", _) => "03",
        ("dinheiro", _) => "01",
        _ => "99",
    }
    .to_string();
    let modalidade = if order.delivery_type == "retirada" { "9" } else { "0" }.to_string();
    FreightInfo { valor: order.shipping_price, modalidade, forma_pagamento }
}

fn client(state: &AppState) -> Result<JubiladosClient, AppError> {
    if state.jubilados_api_url.is_empty() || state.jubilados_internal_key.is_empty() {
        return Err(AppError::Internal(
            "módulo fiscal não configurado neste ambiente (JUBILADOS_API_URL/JUBILADOS_INTERNAL_KEY)".to_string(),
        ));
    }
    Ok(JubiladosClient::new(
        state.http.clone(),
        state.jubilados_api_url.to_string(),
        state.jubilados_internal_key.to_string(),
    ))
}

#[derive(Debug, Serialize)]
pub struct FiscalSettingsDto {
    pub jubilados_empresa_id: Option<Uuid>,
    pub ambiente: String,
    pub cfop_padrao_saida: Option<String>,
    pub auto_emitir: bool,
    pub enabled: bool,
    pub cst_padrao: Option<String>,
    pub csosn_padrao: Option<String>,
    pub cest_padrao: Option<String>,
    pub cclass_trib_padrao: Option<String>,
}

type SettingsRow = (
    Option<Uuid>,
    String,
    Option<String>,
    bool,
    bool,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

pub async fn get_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<FiscalSettingsDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<SettingsRow> = sqlx::query_as(
        "SELECT jubilados_empresa_id, ambiente, cfop_padrao_saida, auto_emitir, enabled, \
                cst_padrao, csosn_padrao, cest_padrao, cclass_trib_padrao \
         FROM tenant_fiscal_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let (
        jubilados_empresa_id,
        ambiente,
        cfop_padrao_saida,
        auto_emitir,
        enabled,
        cst_padrao,
        csosn_padrao,
        cest_padrao,
        cclass_trib_padrao,
    ) = row.unwrap_or((None, "homologacao".to_string(), None, false, false, None, None, None, None));
    Ok(Json(FiscalSettingsDto {
        jubilados_empresa_id,
        ambiente,
        cfop_padrao_saida,
        auto_emitir,
        enabled,
        cst_padrao,
        csosn_padrao,
        cest_padrao,
        cclass_trib_padrao,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateFiscalSettingsInput {
    pub ambiente: String,
    pub cfop_padrao_saida: Option<String>,
    pub auto_emitir: bool,
    #[serde(default)]
    pub cst_padrao: Option<String>,
    #[serde(default)]
    pub csosn_padrao: Option<String>,
    #[serde(default)]
    pub cest_padrao: Option<String>,
    #[serde(default)]
    pub cclass_trib_padrao: Option<String>,
}

/// Chamado normalmente pela ponte `/internal/sync-fiscal-config` (a
/// plataforma já resolveu o `jubilados_empresa_id` do lado dela), mas
/// também exposto pro admin poder ajustar ambiente/CFOP padrão/auto-emitir
/// sem precisar passar pela plataforma de novo.
pub async fn update_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<UpdateFiscalSettingsInput>,
) -> Result<Json<FiscalSettingsDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if !matches!(body.ambiente.as_str(), "homologacao" | "producao") {
        return Err(AppError::BadRequest("ambiente deve ser 'homologacao' ou 'producao'".to_string()));
    }
    sqlx::query(
        "INSERT INTO tenant_fiscal_settings \
           (tenant_id, ambiente, cfop_padrao_saida, auto_emitir, cst_padrao, csosn_padrao, cest_padrao, cclass_trib_padrao) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
           ambiente = EXCLUDED.ambiente, cfop_padrao_saida = EXCLUDED.cfop_padrao_saida, \
           auto_emitir = EXCLUDED.auto_emitir, cst_padrao = EXCLUDED.cst_padrao, \
           csosn_padrao = EXCLUDED.csosn_padrao, cest_padrao = EXCLUDED.cest_padrao, \
           cclass_trib_padrao = EXCLUDED.cclass_trib_padrao, updated_at = now()::text",
    )
    .bind(&claims.tenant_id)
    .bind(&body.ambiente)
    .bind(&body.cfop_padrao_saida)
    .bind(body.auto_emitir)
    .bind(&body.cst_padrao)
    .bind(&body.csosn_padrao)
    .bind(&body.cest_padrao)
    .bind(&body.cclass_trib_padrao)
    .execute(&state.pool)
    .await?;
    get_settings(State(state), AdminUser(claims)).await
}

/// Passthrough da tabela oficial de Classificação Tributária (IBS/CBS) --
/// o frontend usa isso pra oferecer uma lista real de códigos em vez do
/// lojista digitar um código que pode não existir.
pub async fn classificacao_tributaria(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    Ok(Json(c.listar_classificacao_tributaria().await?))
}

#[derive(Debug, Deserialize)]
pub struct UpdateProductFiscalInput {
    pub ncm: Option<String>,
    pub cfop: Option<String>,
    pub cst: Option<String>,
    pub csosn: Option<String>,
    pub cest: Option<String>,
    pub origem: Option<String>,
    pub unidade_fiscal: Option<String>,
    pub ean: Option<String>,
    pub cclass_trib: Option<String>,
}

pub async fn update_product_fiscal(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateProductFiscalInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE products SET ncm = $3, cfop = $4, cst = $5, csosn = $6, cest = $7, origem = $8, \
           unidade_fiscal = $9, ean = $10, cclass_trib = $11 \
         WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&body.ncm)
    .bind(&body.cfop)
    .bind(&body.cst)
    .bind(&body.csosn)
    .bind(&body.cest)
    .bind(&body.origem)
    .bind(&body.unidade_fiscal)
    .bind(&body.ean)
    .bind(&body.cclass_trib)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("produto não encontrado".to_string()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

struct ProductFiscalRow {
    ncm: Option<String>,
    cfop: Option<String>,
    cst: Option<String>,
    csosn: Option<String>,
    cest: Option<String>,
    origem: Option<String>,
    unidade_fiscal: Option<String>,
    ean: Option<String>,
    cclass_trib: Option<String>,
    jubilados_produto_id: Option<Uuid>,
}

/// CFOP efetivo do produto: usa o específico se setado, senão o padrão
/// cadastrado do tenant (`tenant_cfops.is_default`) -- nunca inventa nem
/// deixa `None` silenciosamente quando existe um padrão configurado.
async fn effective_cfop(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    product_cfop: Option<&str>,
) -> Result<Option<String>, AppError> {
    if let Some(cfop) = product_cfop.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(Some(cfop.to_string()));
    }
    let default: Option<(String,)> = sqlx::query_as(
        "SELECT cfop_codigo FROM tenant_cfops WHERE tenant_id = $1 AND is_default LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    Ok(default.map(|(c,)| c))
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// CST/CSOSN, CEST e Classificação Tributária (IBS/CBS) padrão da empresa --
/// cadastrados uma vez em Meu Plano -> Integrações, usados quando o produto
/// não tem valor específico (mesma lógica de `effective_cfop`, buscado uma
/// vez por pedido em vez de por item pra não fazer N+1 na emissão).
struct FiscalDefaults {
    cst: Option<String>,
    csosn: Option<String>,
    cest: Option<String>,
    cclass_trib: Option<String>,
}

async fn tenant_fiscal_defaults(pool: &sqlx::PgPool, tenant_id: &str) -> Result<FiscalDefaults, AppError> {
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT cst_padrao, csosn_padrao, cest_padrao, cclass_trib_padrao \
         FROM tenant_fiscal_settings WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    let (cst, csosn, cest, cclass_trib) = row.unwrap_or((None, None, None, None));
    Ok(FiscalDefaults { cst, csosn, cest, cclass_trib })
}

async fn build_fiscal_items(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    order_id: &str,
) -> Result<Vec<FiscalItem>, AppError> {
    let items = orders_common::fetch_items(pool, tenant_id, order_id).await?;
    let defaults = tenant_fiscal_defaults(pool, tenant_id).await?;
    let mut fiscal_items = Vec::with_capacity(items.len());
    for item in items {
        let row: Option<(
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<Uuid>,
        )> = sqlx::query_as(
            "SELECT ncm, cfop, cst, csosn, cest, origem, unidade_fiscal, ean, cclass_trib, jubilados_produto_id \
             FROM products WHERE tenant_id = $1 AND id = $2",
        )
        .bind(tenant_id)
        .bind(&item.product_id)
        .fetch_optional(pool)
        .await?;
        let row = row.map(
            |(ncm, cfop, cst, csosn, cest, origem, unidade_fiscal, ean, cclass_trib, jubilados_produto_id)| {
                ProductFiscalRow {
                    ncm,
                    cfop,
                    cst,
                    csosn,
                    cest,
                    origem,
                    unidade_fiscal,
                    ean,
                    cclass_trib,
                    jubilados_produto_id,
                }
            },
        );
        let row = row.unwrap_or(ProductFiscalRow {
            ncm: None,
            cfop: None,
            cst: None,
            csosn: None,
            cest: None,
            origem: None,
            unidade_fiscal: None,
            ean: None,
            cclass_trib: None,
            jubilados_produto_id: None,
        });
        let cfop = effective_cfop(pool, tenant_id, row.cfop.as_deref()).await?;
        fiscal_items.push(FiscalItem {
            product_id: item.product_id,
            jubilados_produto_id: row.jubilados_produto_id,
            product_name: item.product_name,
            ncm: row.ncm,
            cfop,
            cst: non_empty(row.cst).or_else(|| defaults.cst.clone()),
            csosn: non_empty(row.csosn).or_else(|| defaults.csosn.clone()),
            cest: non_empty(row.cest).or_else(|| defaults.cest.clone()),
            origem: row.origem,
            unidade_fiscal: row.unidade_fiscal,
            ean: row.ean,
            cclass_trib: non_empty(row.cclass_trib).or_else(|| defaults.cclass_trib.clone()),
            quantity: item.quantity,
            unit_price: item.unit_price,
        });
    }
    Ok(fiscal_items)
}

pub async fn emitir(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let tenant_id = claims.tenant_id.clone();

    let settings: Option<(Option<Uuid>, String, Option<String>, bool)> = sqlx::query_as(
        "SELECT jubilados_empresa_id, ambiente, cfop_padrao_saida, enabled FROM tenant_fiscal_settings WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((Some(empresa_id), ambiente, cfop_padrao, true)) = settings else {
        return Err(AppError::BadRequest(
            "configure os dados fiscais da loja em Meu Plano → Financeiro → Fiscal antes de emitir".to_string(),
        ));
    };

    let mut tx = tenant::tenant_tx(&state.pool, &tenant_id).await?;
    let order = orders_common::fetch_order_row(&mut *tx, &tenant_id, &order_id)
        .await?
        .ok_or_else(|| AppError::NotFound("pedido não encontrado".to_string()))?;
    tx.commit().await?;

    let items = build_fiscal_items(&state.pool, &tenant_id, &order_id).await?;
    if items.is_empty() {
        return Err(AppError::BadRequest("pedido sem itens".to_string()));
    }
    let errors = fiscal::validate_items(&items);
    if !errors.is_empty() {
        return Err(AppError::BadRequest(format!(
            "produtos sem dados fiscais completos: {}",
            errors
                .iter()
                .map(|e| format!("{} (faltando: {})", e.product_name, e.missing_fields.join(", ")))
                .collect::<Vec<_>>()
                .join("; ")
        )));
    }

    let c = client(&state)?;
    let mut resolved_items = Vec::with_capacity(items.len());
    for item in &items {
        let jubilados_id = c.upsert_produto(empresa_id, item).await?;
        if item.jubilados_produto_id != Some(jubilados_id) {
            sqlx::query("UPDATE products SET jubilados_produto_id = $1 WHERE tenant_id = $2 AND id = $3")
                .bind(jubilados_id)
                .bind(&tenant_id)
                .bind(&item.product_id)
                .execute(&state.pool)
                .await?;
        }
        resolved_items.push((item.clone(), jubilados_id));
    }

    let kind = DocumentKind::from_order_delivery_type(&order.delivery_type);
    let doc_id = uuid::Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO fiscal_documents (id, tenant_id, order_id, modelo, status) \
         VALUES ($1, $2, $3, $4, 'processando') \
         ON CONFLICT (order_id) WHERE status NOT IN ('rejeitada', 'cancelada', 'erro') DO NOTHING \
         RETURNING id",
    )
    .bind(&doc_id)
    .bind(&tenant_id)
    .bind(&order_id)
    .bind(kind.modelo())
    .fetch_optional(&state.pool)
    .await?;
    let Some((doc_id,)) = inserted else {
        return Err(AppError::Conflict("já existe uma nota fiscal pra este pedido".to_string()));
    };

    let result = c
        .emitir(
            kind,
            empresa_id,
            &ambiente,
            "1",
            cfop_padrao.as_deref().unwrap_or("5102"),
            &order_id,
            &resolved_items,
            &order_freight_info(&order),
        )
        .await;

    let (status, cstat, xmotivo, chave, protocolo, jubilados_nota_id) = match &result {
        Ok(r) if r.sucesso => (
            "autorizada",
            Some(r.cstat.clone()),
            Some(r.xmotivo.clone()),
            r.chave_acesso.clone(),
            r.protocolo.clone(),
            r.nota_fiscal_id,
        ),
        Ok(r) => ("rejeitada", Some(r.cstat.clone()), Some(r.xmotivo.clone()), None, None, r.nota_fiscal_id),
        Err(e) => ("erro", None, Some(e.message().to_string()), None, None, None),
    };
    sqlx::query(
        "UPDATE fiscal_documents SET status = $1, cstat = $2, xmotivo = $3, chave_acesso = $4, \
           protocolo = $5, jubilados_nota_id = $6, updated_at = now()::text WHERE id = $7",
    )
    .bind(status)
    .bind(&cstat)
    .bind(&xmotivo)
    .bind(&chave)
    .bind(&protocolo)
    .bind(jubilados_nota_id)
    .bind(&doc_id)
    .execute(&state.pool)
    .await?;

    match result {
        Ok(r) if r.sucesso => Ok(Json(serde_json::json!({
            "status": status, "chave_acesso": chave, "protocolo": protocolo, "cstat": cstat, "xmotivo": xmotivo,
        }))),
        Ok(r) => Err(AppError::BadRequest(format!("SEFAZ rejeitou: {} - {}", r.cstat, r.xmotivo))),
        Err(e) => Err(e),
    }
}

#[derive(Debug, Serialize)]
pub struct FiscalDocumentListItem {
    pub id: String,
    pub order_id: String,
    pub modelo: String,
    pub status: String,
    pub chave_acesso: Option<String>,
    pub protocolo: Option<String>,
    pub xml_url: Option<String>,
    pub danfe_url: Option<String>,
    pub created_at: String,
    pub customer_name: Option<String>,
    pub total: Option<f64>,
}

/// Painel Fiscal → Documentos -- lista as últimas notas emitidas (nunca
/// gera XML/DANFE aqui, só exibe os links que o Jubilados já devolveu).
pub async fn list_documents(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<FiscalDocumentListItem>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String, Option<String>, Option<f64>)> = sqlx::query_as(
        "SELECT fd.id, fd.order_id, fd.modelo, fd.status, fd.chave_acesso, fd.protocolo, \
                fd.xml_url, fd.danfe_url, fd.created_at, o.customer_name, o.total \
         FROM fiscal_documents fd LEFT JOIN orders o ON o.id = fd.order_id AND o.tenant_id = fd.tenant_id \
         WHERE fd.tenant_id = $1 ORDER BY fd.created_at DESC LIMIT 200",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, order_id, modelo, status, chave_acesso, protocolo, xml_url, danfe_url, created_at, customer_name, total)| {
                FiscalDocumentListItem { id, order_id, modelo, status, chave_acesso, protocolo, xml_url, danfe_url, created_at, customer_name, total }
            })
            .collect(),
    ))
}

pub async fn get_fiscal(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String, String, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, status, chave_acesso, protocolo, cstat, xmotivo FROM fiscal_documents \
         WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(&order_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((id, status, chave_acesso, protocolo, cstat, xmotivo)) = row else {
        return Err(AppError::NotFound("nenhuma nota fiscal emitida pra este pedido".to_string()));
    };
    Ok(Json(serde_json::json!({
        "id": id, "status": status, "chave_acesso": chave_acesso, "protocolo": protocolo,
        "cstat": cstat, "xmotivo": xmotivo,
    })))
}

pub async fn cancelar(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let tenant_id = claims.tenant_id.clone();

    let doc: Option<(String, Option<Uuid>)> = sqlx::query_as(
        "SELECT id, jubilados_nota_id FROM fiscal_documents \
         WHERE tenant_id = $1 AND order_id = $2 AND status = 'autorizada'",
    )
    .bind(&tenant_id)
    .bind(&order_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((doc_id, Some(jubilados_nota_id))) = doc else {
        return Err(AppError::NotFound("nenhuma nota autorizada pra cancelar neste pedido".to_string()));
    };
    let empresa_id: Option<(Uuid,)> = sqlx::query_as(
        "SELECT jubilados_empresa_id FROM tenant_fiscal_settings WHERE tenant_id = $1 AND jubilados_empresa_id IS NOT NULL",
    )
    .bind(&tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((empresa_id,)) = empresa_id else {
        return Err(AppError::BadRequest("configuração fiscal da loja incompleta".to_string()));
    };

    let c = client(&state)?;
    c.cancelar(empresa_id, jubilados_nota_id, "Cancelamento solicitado pelo lojista via Resolutoo").await?;

    sqlx::query("UPDATE fiscal_documents SET status = 'cancelada', updated_at = now()::text WHERE id = $1")
        .bind(&doc_id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct CancelarNotaInput {
    #[serde(default)]
    pub justificativa: Option<String>,
}

/// Anular nota de saída direto pelo id do Jubilados -- usado pela tela
/// "Consultar nuvem fiscal", que lista notas sem necessariamente saber o
/// order_id local (pode ter nota importada/legada sem pedido vinculado).
/// Mesma ação de `cancelar` acima, só que sem depender de order_id.
pub async fn cancelar_por_nota(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(nota_fiscal_id): Path<Uuid>,
    Json(body): Json<CancelarNotaInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let empresa_id = tenant_empresa_id(&state.pool, &claims.tenant_id).await?;
    let justificativa = body
        .justificativa
        .filter(|s| s.trim().len() >= 15)
        .unwrap_or_else(|| "Cancelamento solicitado pelo lojista via Resolutoo".to_string());

    let c = client(&state)?;
    c.cancelar(empresa_id, nota_fiscal_id, &justificativa).await?;

    sqlx::query(
        "UPDATE fiscal_documents SET status = 'cancelada', updated_at = now()::text \
         WHERE tenant_id = $1 AND jubilados_nota_id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(nota_fiscal_id)
    .execute(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Chamado por `webhooks.rs::handle_mercadopago` quando o modo é
/// automático. Fire-and-forget -- erros aqui nunca bloqueiam nem revertem
/// a confirmação de pagamento (mesmo espírito do WhatsApp/baixa de
/// estoque que já rodam nesse mesmo ponto).
pub async fn maybe_auto_emit(pool: &sqlx::PgPool, http: &reqwest::Client, jubilados_api_url: &str, jubilados_internal_key: &str, tenant_id: &str, order_id: &str) {
    if jubilados_api_url.is_empty() || jubilados_internal_key.is_empty() {
        return;
    }
    let settings: Option<(Option<Uuid>, String, Option<String>, bool, bool)> = sqlx::query_as(
        "SELECT jubilados_empresa_id, ambiente, cfop_padrao_saida, auto_emitir, enabled FROM tenant_fiscal_settings WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let Some((Some(empresa_id), ambiente, cfop_padrao, true, true)) = settings else {
        return;
    };

    let order: Option<crate::models::OrderRow> = sqlx::query_as("SELECT * FROM orders WHERE tenant_id = $1 AND id = $2")
        .bind(tenant_id)
        .bind(order_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    let Some(order) = order else { return };

    let Ok(items) = build_fiscal_items(pool, tenant_id, order_id).await else { return };
    if items.is_empty() || !fiscal::validate_items(&items).is_empty() {
        tracing::warn!("auto-emitir fiscal pulado pro pedido {order_id}: itens sem dados fiscais completos");
        return;
    }

    let c = JubiladosClient::new(http.clone(), jubilados_api_url.to_string(), jubilados_internal_key.to_string());
    let mut resolved = Vec::with_capacity(items.len());
    for item in &items {
        let Ok(jid) = c.upsert_produto(empresa_id, item).await else { return };
        if item.jubilados_produto_id != Some(jid) {
            let _ = sqlx::query("UPDATE products SET jubilados_produto_id = $1 WHERE tenant_id = $2 AND id = $3")
                .bind(jid)
                .bind(tenant_id)
                .bind(&item.product_id)
                .execute(pool)
                .await;
        }
        resolved.push((item.clone(), jid));
    }

    let kind = DocumentKind::from_order_delivery_type(&order.delivery_type);
    let doc_id = uuid::Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO fiscal_documents (id, tenant_id, order_id, modelo, status) \
         VALUES ($1, $2, $3, $4, 'processando') \
         ON CONFLICT (order_id) WHERE status NOT IN ('rejeitada', 'cancelada', 'erro') DO NOTHING \
         RETURNING id",
    )
    .bind(&doc_id)
    .bind(tenant_id)
    .bind(order_id)
    .bind(kind.modelo())
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let Some((doc_id,)) = inserted else { return }; // já tem nota pra esse pedido -- idempotente

    let result = c
        .emitir(
            kind,
            empresa_id,
            &ambiente,
            "1",
            cfop_padrao.as_deref().unwrap_or("5102"),
            order_id,
            &resolved,
            &order_freight_info(&order),
        )
        .await;
    let (status, cstat, xmotivo, chave, protocolo, jubilados_nota_id) = match &result {
        Ok(r) if r.sucesso => (
            "autorizada",
            Some(r.cstat.clone()),
            Some(r.xmotivo.clone()),
            r.chave_acesso.clone(),
            r.protocolo.clone(),
            r.nota_fiscal_id,
        ),
        Ok(r) => ("rejeitada", Some(r.cstat.clone()), Some(r.xmotivo.clone()), None, None, r.nota_fiscal_id),
        Err(e) => ("erro", None, Some(e.message().to_string()), None, None, None),
    };
    let _ = sqlx::query(
        "UPDATE fiscal_documents SET status = $1, cstat = $2, xmotivo = $3, chave_acesso = $4, \
           protocolo = $5, jubilados_nota_id = $6, updated_at = now()::text WHERE id = $7",
    )
    .bind(status)
    .bind(&cstat)
    .bind(&xmotivo)
    .bind(&chave)
    .bind(&protocolo)
    .bind(jubilados_nota_id)
    .bind(&doc_id)
    .execute(pool)
    .await;
    if status != "autorizada" {
        tracing::warn!("auto-emissão fiscal falhou pro pedido {order_id}: {xmotivo:?}");
    }
}

#[derive(Debug, Serialize)]
pub struct CfopOption {
    pub codigo: String,
    pub descricao: String,
    pub contexto: String,
}

#[derive(Debug, Serialize)]
pub struct TenantCfopDto {
    pub codigo: String,
    pub descricao: String,
    pub contexto: String,
    pub is_default: bool,
}

/// CFOPs que o tenant já cadastrou, com o padrão marcado -- é a lista que
/// alimenta o dropdown de "CFOP de saída" no cadastro do produto (só
/// aceita um destes, nunca um código arbitrário digitado).
pub async fn list_cfops(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<TenantCfopDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<(String, String, String, bool)> = sqlx::query_as(
        "SELECT tc.cfop_codigo, fc.descricao, fc.contexto, tc.is_default \
         FROM tenant_cfops tc JOIN fiscal_cfops fc ON fc.codigo = tc.cfop_codigo \
         WHERE tc.tenant_id = $1 ORDER BY tc.is_default DESC, tc.cfop_codigo",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(codigo, descricao, contexto, is_default)| TenantCfopDto { codigo, descricao, contexto, is_default })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct SearchCfopQuery {
    #[serde(default)]
    pub q: String,
}

/// Busca na tabela oficial (não na do tenant) por código ou descrição --
/// alimenta o combobox "+ Adicionar CFOP" da Configuração Fiscal.
pub async fn search_cfops(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    axum::extract::Query(q): axum::extract::Query<SearchCfopQuery>,
) -> Result<Json<Vec<CfopOption>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let term = format!("%{}%", q.q.trim());
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT codigo, descricao, contexto FROM fiscal_cfops \
         WHERE codigo ILIKE $1 OR descricao ILIKE $1 ORDER BY codigo LIMIT 30",
    )
    .bind(&term)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter().map(|(codigo, descricao, contexto)| CfopOption { codigo, descricao, contexto }).collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct AddCfopInput {
    pub codigo: String,
}

/// Adiciona um CFOP ao catálogo do tenant -- primeiro adicionado vira
/// padrão automaticamente se ainda não existir nenhum (seção 10 do pedido).
pub async fn add_cfop(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<AddCfopInput>,
) -> Result<Json<Vec<TenantCfopDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let exists: Option<(String,)> = sqlx::query_as("SELECT codigo FROM fiscal_cfops WHERE codigo = $1")
        .bind(&body.codigo)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::BadRequest("CFOP não encontrado na tabela oficial".to_string()));
    }
    let has_default: Option<(bool,)> =
        sqlx::query_as("SELECT true FROM tenant_cfops WHERE tenant_id = $1 AND is_default LIMIT 1")
            .bind(&claims.tenant_id)
            .fetch_optional(&state.pool)
            .await?;
    sqlx::query(
        "INSERT INTO tenant_cfops (id, tenant_id, cfop_codigo, is_default) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (tenant_id, cfop_codigo) DO NOTHING",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&body.codigo)
    .bind(has_default.is_none())
    .execute(&state.pool)
    .await?;
    list_cfops(State(state), AdminUser(claims)).await
}

/// Troca qual CFOP cadastrado é o padrão -- nunca mais de um por tenant
/// (garantido pelo índice único parcial da migration).
pub async fn set_default_cfop(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(codigo): Path<String>,
) -> Result<Json<Vec<TenantCfopDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE tenant_cfops SET is_default = false WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
    let updated = sqlx::query(
        "UPDATE tenant_cfops SET is_default = true WHERE tenant_id = $1 AND cfop_codigo = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&codigo)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("CFOP não cadastrado pra esta loja".to_string()));
    }
    tx.commit().await?;
    list_cfops(State(state), AdminUser(claims)).await
}

/// Remove um CFOP do catálogo do tenant -- se era o padrão, ninguém mais é
/// (produtos sem override ficam sem CFOP efetivo até o lojista escolher
/// outro padrão; nunca promove um substituto sem o lojista decidir).
pub async fn remove_cfop(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(codigo): Path<String>,
) -> Result<Json<Vec<TenantCfopDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    sqlx::query("DELETE FROM tenant_cfops WHERE tenant_id = $1 AND cfop_codigo = $2")
        .bind(&claims.tenant_id)
        .bind(&codigo)
        .execute(&state.pool)
        .await?;
    list_cfops(State(state), AdminUser(claims)).await
}

async fn tenant_empresa_id(pool: &sqlx::PgPool, tenant_id: &str) -> Result<Uuid, AppError> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT jubilados_empresa_id FROM tenant_fiscal_settings WHERE tenant_id = $1 AND jubilados_empresa_id IS NOT NULL",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;
    row.map(|(id,)| id)
        .ok_or_else(|| AppError::BadRequest("configure os dados fiscais da loja em Meu Plano → Integrações antes".to_string()))
}

#[derive(Debug, Deserialize)]
pub struct InutilizarInput {
    pub serie: String,
    pub numero_inicial: i32,
    pub numero_final: i32,
    pub justificativa: String,
}

/// Inutiliza uma faixa de numeração NUNCA emitida (pulo de número por
/// falha de sistema, por exemplo) -- diferente de cancelar uma nota já
/// autorizada, que é `/api/admin/fiscal/pedidos/{order_id}/cancelar`.
pub async fn inutilizar(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<InutilizarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if body.justificativa.trim().len() < 15 {
        return Err(AppError::BadRequest("justificativa deve ter ao menos 15 caracteres".to_string()));
    }
    let empresa_id = tenant_empresa_id(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    let result = c
        .inutilizar(empresa_id, &body.serie, body.numero_inicial, body.numero_final, &body.justificativa)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true, "protocolo": result.protocolo })))
}

#[derive(Debug, Deserialize)]
pub struct CceInput {
    pub nota_fiscal_id: Uuid,
    pub correcao_texto: String,
}

pub async fn enviar_cce(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<CceInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if body.correcao_texto.trim().len() < 15 {
        return Err(AppError::BadRequest("texto de correção deve ter ao menos 15 caracteres".to_string()));
    }
    let empresa_id = tenant_empresa_id(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    let result = c.enviar_cce(empresa_id, body.nota_fiscal_id, &body.correcao_texto).await?;
    Ok(Json(serde_json::json!({ "ok": true, "protocolo": result.protocolo })))
}

#[derive(Debug, Deserialize)]
pub struct ManifestarInput {
    pub nota_fiscal_id: Uuid,
    /// "CienciaOperacao" | "ConfirmacaoOperacao" | "Desconhecimento" | "OperacaoNaoRealizada"
    pub tipo_manifestacao: String,
    #[serde(default)]
    pub justificativa: Option<String>,
}

pub async fn manifestar(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<ManifestarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if !matches!(
        body.tipo_manifestacao.as_str(),
        "CienciaOperacao" | "ConfirmacaoOperacao" | "Desconhecimento" | "OperacaoNaoRealizada"
    ) {
        return Err(AppError::BadRequest("tipo_manifestacao inválido".to_string()));
    }
    let empresa_id = tenant_empresa_id(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    c.manifestar(empresa_id, body.nota_fiscal_id, &body.tipo_manifestacao, body.justificativa.as_deref())
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Busca na SEFAZ (via Jubilados) por novas notas de ENTRADA -- roda antes
/// de listar pra sincronizar o que ainda não existe no banco do Jubilados.
pub async fn consultar_entrada(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let empresa_id = tenant_empresa_id(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    Ok(Json(c.consultar_entrada(empresa_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct ListarNotasQuery {
    #[serde(default)]
    pub tipo: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

/// Nuvem fiscal -- lista entrada e saída da empresa, filtro opcional por
/// tipo/status. Fonte pra tela "Consultar nuvem fiscal".
pub async fn listar_notas(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    axum::extract::Query(q): axum::extract::Query<ListarNotasQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let empresa_id = tenant_empresa_id(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    Ok(Json(c.listar_notas(empresa_id, q.tipo.as_deref(), q.status.as_deref()).await?))
}

/// Proxy autenticado do PDF da DANFE -- o navegador não pode falar direto
/// com o Jubilados (exige a chave interna, que nunca chega ao front).
pub async fn baixar_danfe(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(nota_fiscal_id): Path<Uuid>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    let bytes = c.baixar_danfe(nota_fiscal_id).await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/pdf")],
        bytes,
    ))
}

/// Proxy autenticado do XML autorizado -- mesmo motivo do proxy de DANFE.
pub async fn baixar_xml(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(nota_fiscal_id): Path<Uuid>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let c = client(&state)?;
    let bytes = c.baixar_xml(nota_fiscal_id).await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/xml")],
        bytes,
    ))
}
