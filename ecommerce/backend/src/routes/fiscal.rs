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
use crate::fiscal::{self, jubilados_client::JubiladosClient, DocumentKind, FiscalItem};
use crate::orders_common;
use crate::state::AppState;
use crate::tenant;

async fn require_beta(pool: &sqlx::PgPool, tenant_id: &str) -> Result<(), AppError> {
    features::require_feature(pool, tenant_id, Feature::EmissaoFiscal).await
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
}

pub async fn get_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<FiscalSettingsDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(Option<Uuid>, String, Option<String>, bool, bool)> = sqlx::query_as(
        "SELECT jubilados_empresa_id, ambiente, cfop_padrao_saida, auto_emitir, enabled \
         FROM tenant_fiscal_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    let (jubilados_empresa_id, ambiente, cfop_padrao_saida, auto_emitir, enabled) =
        row.unwrap_or((None, "homologacao".to_string(), None, false, false));
    Ok(Json(FiscalSettingsDto { jubilados_empresa_id, ambiente, cfop_padrao_saida, auto_emitir, enabled }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateFiscalSettingsInput {
    pub ambiente: String,
    pub cfop_padrao_saida: Option<String>,
    pub auto_emitir: bool,
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
        "INSERT INTO tenant_fiscal_settings (tenant_id, ambiente, cfop_padrao_saida, auto_emitir) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
           ambiente = EXCLUDED.ambiente, cfop_padrao_saida = EXCLUDED.cfop_padrao_saida, \
           auto_emitir = EXCLUDED.auto_emitir, updated_at = now()::text",
    )
    .bind(&claims.tenant_id)
    .bind(&body.ambiente)
    .bind(&body.cfop_padrao_saida)
    .bind(body.auto_emitir)
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

async fn build_fiscal_items(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    order_id: &str,
) -> Result<Vec<FiscalItem>, AppError> {
    let items = orders_common::fetch_items(pool, tenant_id, order_id).await?;
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
        fiscal_items.push(FiscalItem {
            product_id: item.product_id,
            jubilados_produto_id: row.jubilados_produto_id,
            product_name: item.product_name,
            ncm: row.ncm,
            cfop: row.cfop,
            cst: row.cst,
            csosn: row.csosn,
            cest: row.cest,
            origem: row.origem,
            unidade_fiscal: row.unidade_fiscal,
            ean: row.ean,
            cclass_trib: row.cclass_trib,
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
         ON CONFLICT (order_id) WHERE status NOT IN ('rejeitada', 'cancelada') DO NOTHING \
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
        .emitir(kind, empresa_id, &ambiente, "1", cfop_padrao.as_deref().unwrap_or("5102"), &order_id, &resolved_items)
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
         ON CONFLICT (order_id) WHERE status NOT IN ('rejeitada', 'cancelada') DO NOTHING \
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
        .emitir(kind, empresa_id, &ambiente, "1", cfop_padrao.as_deref().unwrap_or("5102"), order_id, &resolved)
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
