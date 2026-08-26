//! Vertical "eletronicos" (assistência técnica) — handlers pro schema
//! `eletronicos.*` (ver migrations/0022_eletronicos_module.sql + a
//! migration de paridade aplicada na migração do tenant vrtech). Schema
//! separado do público (produtos/pedidos compartilhados), então toda query
//! aqui qualifica `eletronicos.<tabela>` explicitamente — nunca confia no
//! search_path default do pool.
//!
//! Fase 4.1 do plano de migração: CRUD + fluxo de status de
//! service_requests. As demais entidades (service_orders/checklist, PDV,
//! agenda, templates, assistente IA) entram em fases seguintes — ver
//! docs/bugs/registry.yaml pro estado atual desta migração.

use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::error::AppError;
use crate::state::AppState;
use crate::tenant;

const VALID_STATUSES: &[&str] = &[
    "pending",
    "aguardando_diagnostico",
    "diagnostico_enviado",
    "accepted",
    "rejected",
    "retirada_local",
    "em_busca",
    "in_progress",
    "completed",
    "em_pagamento",
    "delivered",
    "finished",
    "cancelled",
];

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServiceRequestDto {
    pub id: String,
    pub created_at: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub customer_email: Option<String>,
    pub phone_model: Option<String>,
    pub problem_description: Option<String>,
    pub image_url: Option<String>,
    pub address_cep: Option<String>,
    pub address_street: Option<String>,
    pub address_number: Option<String>,
    pub address_reference: Option<String>,
    pub address_neighborhood: Option<String>,
    pub address_city: Option<String>,
    pub address_state: Option<String>,
    pub address_lat: Option<f64>,
    pub address_lng: Option<f64>,
    pub address_label: Option<String>,
    pub status: String,
    pub quote_value: Option<f64>,
    pub estimated_quote_value: Option<f64>,
    pub owner_notes: Option<String>,
    pub discount_percent: Option<i32>,
    pub payment_methods: serde_json::Value,
    pub self_pickup: bool,
    pub shipping_price: Option<f64>,
    pub diagnosis_requested: bool,
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateServiceRequestInput {
    pub customer_name: String,
    pub customer_phone: String,
    pub customer_email: Option<String>,
    pub phone_model: Option<String>,
    pub problem_description: Option<String>,
    pub image_url: Option<String>,
    pub self_pickup: bool,
    pub address_cep: Option<String>,
    pub address_street: Option<String>,
    pub address_number: Option<String>,
    pub address_reference: Option<String>,
    pub address_neighborhood: Option<String>,
    pub address_city: Option<String>,
    pub address_state: Option<String>,
    pub address_lat: Option<f64>,
    pub address_lng: Option<f64>,
    pub diagnosis_requested: Option<bool>,
    /// pending (padrão) = fluxo normal de aceite; sunset/PDV entram como
    /// 'accepted' (orçamento já acordado no balcão) — mesma semântica do
    /// vrtech (ver ensureServiceRequestForAppointment no código antigo).
    pub status: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatusInput {
    pub status: String,
    pub quote_value: Option<f64>,
    pub owner_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub status: Option<String>,
}

fn validate_status(status: &str) -> Result<(), AppError> {
    if VALID_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "status inválido: {status} (aceitos: {})",
            VALID_STATUSES.join(", ")
        )))
    }
}

const SELECT_COLUMNS: &str = "id::text, created_at::text, customer_name, customer_phone, customer_email, \
    phone_model, problem_description, image_url, address_cep, address_street, address_number, \
    address_reference, address_neighborhood, address_city, address_state, address_lat, address_lng, \
    address_label, status, quote_value::float8, estimated_quote_value::float8, owner_notes, discount_percent, \
    payment_methods, self_pickup, shipping_price::float8, diagnosis_requested, source";

pub async fn list_service_requests(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<ServiceRequestDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ServiceRequestDto> = if let Some(status) = q.status.as_deref() {
        validate_status(status)?;
        sqlx::query_as(&format!(
            "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests \
             WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC"
        ))
        .bind(&claims.tenant_id)
        .bind(status)
        .fetch_all(&mut *tx)
        .await?
    } else {
        sqlx::query_as(&format!(
            "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests \
             WHERE tenant_id = $1 ORDER BY created_at DESC"
        ))
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn get_service_request(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<ServiceRequestDto> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    row.map(Json)
        .ok_or_else(|| AppError::NotFound("solicitação não encontrada".to_string()))
}

pub async fn create_service_request(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateServiceRequestInput>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row = insert_service_request(&mut tx, &claims.tenant_id, input, "admin_dashboard").await?;
    tx.commit().await?;
    Ok(Json(row))
}

/// Compartilhado pelo admin (`create_service_request`, tenant vem do JWT) e
/// pela vitrine pública (`create_service_request_public`, tenant vem do
/// slug na URL) -- mesma validação e INSERT nos dois casos, só a origem do
/// `tenant_id` e o `source` padrão mudam.
async fn insert_service_request(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    input: CreateServiceRequestInput,
    default_source: &str,
) -> Result<ServiceRequestDto, AppError> {
    if input.customer_name.trim().is_empty() {
        return Err(AppError::BadRequest("nome do cliente é obrigatório".to_string()));
    }
    if input.customer_phone.trim().is_empty() {
        return Err(AppError::BadRequest("telefone do cliente é obrigatório".to_string()));
    }
    // Coleta (self_pickup=false) exige endereço real -- mesma regra que já
    // valia no vrtech (o motoboy precisa saber onde ir).
    if !input.self_pickup && input.address_lat.is_none() {
        return Err(AppError::BadRequest(
            "endereço (address_lat/address_lng) é obrigatório quando não é retirada pelo cliente".to_string(),
        ));
    }
    let status = input.status.as_deref().unwrap_or("pending");
    validate_status(status)?;

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO eletronicos.service_requests \
         (id, tenant_id, customer_name, customer_phone, customer_email, phone_model, problem_description, \
          image_url, self_pickup, address_cep, address_street, address_number, address_reference, \
          address_neighborhood, address_city, address_state, address_lat, address_lng, \
          diagnosis_requested, status, source) \
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(input.customer_name.trim())
    .bind(input.customer_phone.trim())
    .bind(input.customer_email.as_deref())
    .bind(input.phone_model.as_deref())
    .bind(input.problem_description.as_deref())
    .bind(input.image_url.as_deref())
    .bind(input.self_pickup)
    .bind(input.address_cep.as_deref())
    .bind(input.address_street.as_deref())
    .bind(input.address_number.as_deref())
    .bind(input.address_reference.as_deref())
    .bind(input.address_neighborhood.as_deref())
    .bind(input.address_city.as_deref())
    .bind(input.address_state.as_deref())
    .bind(input.address_lat)
    .bind(input.address_lng)
    .bind(input.diagnosis_requested.unwrap_or(false))
    .bind(status)
    .bind(input.source.as_deref().unwrap_or(default_source))
    .execute(&mut *tx)
    .await?;

    let row: ServiceRequestDto = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    Ok(row)
}

/// Vitrine pública -- cliente cria a solicitação sozinho (formulário de
/// triagem em /loja/eletronica-loja), sem login. Tenant resolvido pelo slug
/// da URL, nunca por JWT. `status`/`source` do input são ignorados aqui
/// (cliente não decide isso) -- sempre entra como 'pending'/'site'.
pub async fn create_service_request_public(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(mut input): Json<CreateServiceRequestInput>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    input.status = None;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let row = insert_service_request(&mut tx, &store.id, input, "site").await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn update_service_request_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateStatusInput>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    validate_status(&input.status)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_requests \
         SET status = $3, quote_value = COALESCE($4, quote_value), owner_notes = COALESCE($5, owner_notes) \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&input.status)
    .bind(input.quote_value)
    .bind(input.owner_notes.as_deref())
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("solicitação não encontrada".to_string()));
    }
    let row: ServiceRequestDto = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

// ============================================================================
// Ordem de servico (checklist / garantia / conclusao) -- fase 4.2
// ============================================================================

/// Item do checklist da OS. `added_at` e setado pelo backend na conclusao
/// (nunca pelo cliente) -- e o que garante que reabrir uma OS e concluir de
/// novo nao cobra/decrementa estoque duas vezes pelo mesmo componente (so
/// itens SEM added_at ainda entram na conta na proxima conclusao).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChecklistItem {
    pub component: String,
    #[serde(default)]
    pub checked: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub media_urls: Vec<String>,
    pub value: Option<f64>,
    pub note: Option<String>,
    pub warranty_days: Option<i32>,
    pub stock_item_id: Option<String>,
    pub added_at: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServiceOrderDto {
    pub id: String,
    pub request_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub checklist: serde_json::Value,
    pub completed_services: Option<String>,
    pub warranty: Option<String>,
    pub final_value: Option<f64>,
    pub pdf_url: Option<String>,
    pub closed_at: Option<String>,
    pub used_parts: serde_json::Value,
}

const SO_COLUMNS: &str = "id::text, request_id::text, created_at::text, updated_at::text, checklist, \
    completed_services, warranty, final_value::float8, pdf_url, closed_at::text, used_parts";

/// Busca a OS de um atendimento, criando uma vazia na primeira vez (mesmo
/// padrao do vrtech: a OS nasce junto com o card entrando em "em reparo",
/// nao precisa de um passo de criacao separado no front).
pub async fn get_or_create_service_order(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(request_id): Path<String>,
) -> Result<Json<ServiceOrderDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let owner: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await?;
    if owner.is_none() {
        return Err(AppError::NotFound("solicitacao nao encontrada".to_string()));
    }

    let existing: Option<ServiceOrderDto> = sqlx::query_as(&format!(
        "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND request_id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await?;

    let row = if let Some(row) = existing {
        row
    } else {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO eletronicos.service_orders (id, tenant_id, request_id) VALUES ($1::uuid, $2, $3::uuid)",
        )
        .bind(&id)
        .bind(&claims.tenant_id)
        .bind(&request_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query_as(&format!(
            "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid"
        ))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct UpdateChecklistInput {
    pub checklist: Vec<ChecklistItem>,
}

/// Salva o checklist como esta (lojista marcando/desmarcando componentes,
/// anexando foto) -- nao fecha a OS nem mexe em estoque, isso so acontece
/// em `complete_service_order`.
pub async fn update_checklist(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateChecklistInput>,
) -> Result<Json<ServiceOrderDto>, AppError> {
    let checklist_json = serde_json::to_value(&input.checklist)
        .map_err(|e| AppError::BadRequest(format!("checklist invalido: {e}")))?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_orders SET checklist = $3, updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&checklist_json)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("ordem de servico nao encontrada".to_string()));
    }
    let row: ServiceOrderDto = sqlx::query_as(&format!(
        "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServiceOrderUpdateDto {
    pub id: String,
    pub service_order_id: String,
    pub created_at: String,
    pub message: Option<String>,
    pub media_urls: Vec<String>,
    pub action_type: String,
    pub component: Option<String>,
}

const SOU_COLUMNS: &str =
    "id::text, service_order_id::text, created_at::text, message, media_urls, action_type, component";

pub async fn list_service_order_updates(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<Vec<ServiceOrderUpdateDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ServiceOrderUpdateDto> = sqlx::query_as(&format!(
        "SELECT {SOU_COLUMNS} FROM eletronicos.service_order_updates \
         WHERE tenant_id = $1 AND service_order_id = $2::uuid ORDER BY created_at"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateUpdateInput {
    pub message: Option<String>,
    #[serde(default)]
    pub media_urls: Vec<String>,
    pub component: Option<String>,
}

pub async fn add_service_order_update(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CreateUpdateInput>,
) -> Result<Json<ServiceOrderUpdateDto>, AppError> {
    let owner: Option<(String,)> = {
        let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
        let row = sqlx::query_as(
            "SELECT id::text FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;
        row
    };
    if owner.is_none() {
        return Err(AppError::NotFound("ordem de servico nao encontrada".to_string()));
    }

    let new_id = Uuid::new_v4().to_string();
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.service_order_updates \
         (id, tenant_id, service_order_id, message, media_urls, action_type, component) \
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, 'update', $6)",
    )
    .bind(&new_id)
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.message.as_deref())
    .bind(&input.media_urls)
    .bind(input.component.as_deref())
    .execute(&mut *tx)
    .await?;
    let row: ServiceOrderUpdateDto = sqlx::query_as(&format!(
        "SELECT {SOU_COLUMNS} FROM eletronicos.service_order_updates WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&new_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct CompleteServiceOrderInput {
    pub checklist: Vec<ChecklistItem>,
    pub completed_services: Option<String>,
    pub shipping_price: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct CompleteServiceOrderResult {
    pub service_order: ServiceOrderDto,
    pub final_value: f64,
}

/// Conclui a OS: so itens marcados SEM `added_at` ainda entram na conta
/// (evita cobrar/decrementar de novo numa reabertura) -- mesma regra do
/// vrtech (RequestDetailModal/ServiceOrderPanel::handleSaveCompletion).
/// Decrementa estoque de verdade (stock_movements) pros itens com
/// stock_item_id, e sincroniza `service_requests.quote_value`.
pub async fn complete_service_order(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CompleteServiceOrderInput>,
) -> Result<Json<CompleteServiceOrderResult>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let existing: Option<(String, serde_json::Value)> = sqlx::query_as(
        "SELECT request_id::text, checklist FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((request_id, prev_checklist_json)) = existing else {
        return Err(AppError::NotFound("ordem de servico nao encontrada".to_string()));
    };
    let prev_checklist: Vec<ChecklistItem> =
        serde_json::from_value(prev_checklist_json).unwrap_or_default();
    let is_first_conclusion = !prev_checklist.iter().any(|i| i.added_at.is_some());

    let now = Utc::now().to_rfc3339();
    let mut updated_checklist = input.checklist.clone();
    let mut new_total = 0.0_f64;
    let mut warranty_parts = Vec::new();
    for item in updated_checklist.iter_mut() {
        if !item.checked {
            continue;
        }
        if item.added_at.is_none() {
            item.added_at = Some(now.clone());
            new_total += item.value.unwrap_or(0.0);
            // Decrementa estoque de verdade -- so pra itens realmente novos
            // desde a ultima conclusao (nunca duplica saida numa reabertura).
            if let Some(stock_item_id) = &item.stock_item_id {
                sqlx::query(
                    "INSERT INTO eletronicos.stock_movements \
                     (id, tenant_id, item_id, type, quantity, unit) \
                     VALUES ($1::uuid, $2, $3::uuid, 'saida', 1, 'unidade')",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&claims.tenant_id)
                .bind(stock_item_id)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "UPDATE eletronicos.stock_items SET quantity = quantity - 1, updated_at = now() \
                     WHERE tenant_id = $1 AND id = $2::uuid",
                )
                .bind(&claims.tenant_id)
                .bind(stock_item_id)
                .execute(&mut *tx)
                .await?;
            }
        }
        warranty_parts.push(format!(
            "{}: {}",
            item.component,
            item.warranty_days
                .map(|d| format!("{d} dias"))
                .unwrap_or_else(|| "nao informada".to_string())
        ));
    }

    // Frete de coleta so entra na 1a conclusao -- reabertura nunca duplica.
    let request_row: (bool, Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT self_pickup, shipping_price::float8, quote_value::float8 FROM eletronicos.service_requests \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .fetch_one(&mut *tx)
    .await?;
    let (self_pickup, existing_shipping, prev_quote) = request_row;
    let shipping = if is_first_conclusion && !self_pickup {
        input.shipping_price.or(existing_shipping).unwrap_or(0.0)
    } else {
        0.0
    };

    let previous_final: (Option<f64>,) =
        sqlx::query_as("SELECT final_value::float8 FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid")
            .bind(&claims.tenant_id)
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    let final_value = if is_first_conclusion {
        if updated_checklist.iter().any(|i| i.checked) {
            new_total + shipping
        } else {
            prev_quote.unwrap_or(0.0)
        }
    } else {
        previous_final.0.unwrap_or(0.0) + new_total
    };

    let warranty_summary = if warranty_parts.is_empty() {
        None
    } else {
        Some(warranty_parts.join("; "))
    };
    let checklist_json = serde_json::to_value(&updated_checklist)
        .map_err(|e| AppError::BadRequest(format!("checklist invalido: {e}")))?;

    sqlx::query(
        "UPDATE eletronicos.service_orders \
         SET checklist = $3, completed_services = $4, warranty = $5, final_value = $6, \
             closed_at = now(), updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&checklist_json)
    .bind(input.completed_services.as_deref())
    .bind(warranty_summary.as_deref())
    .bind(final_value)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE eletronicos.service_requests SET quote_value = $3 WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .bind(final_value)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO eletronicos.service_order_updates \
         (id, tenant_id, service_order_id, message, action_type) \
         VALUES ($1::uuid, $2, $3::uuid, $4, 'completed')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(format!(
        "Reparo concluido -- {}. Valor: R$ {:.2}. Garantia: {}.",
        input.completed_services.as_deref().unwrap_or("servicos realizados"),
        final_value,
        warranty_summary.as_deref().unwrap_or("nao informada")
    ))
    .execute(&mut *tx)
    .await?;

    let row: ServiceOrderDto = sqlx::query_as(&format!(
        "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(CompleteServiceOrderResult { service_order: row, final_value }))
}

/// Reabre uma OS ja concluida (permite ajustar checklist/valores de novo) --
/// nunca apaga o que ja foi cobrado/decrementado (added_at dos itens
/// antigos permanece), so limpa `closed_at` pra liberar edicao.
pub async fn reopen_service_order(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CreateUpdateInput>,
) -> Result<Json<ServiceOrderDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_orders SET closed_at = NULL, updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("ordem de servico nao encontrada".to_string()));
    }
    sqlx::query(
        "INSERT INTO eletronicos.service_order_updates \
         (id, tenant_id, service_order_id, message, action_type) \
         VALUES ($1::uuid, $2, $3::uuid, $4, 'reopened')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(format!(
        "Motivo da reabertura: {}",
        input.message.as_deref().unwrap_or("nao informado")
    ))
    .execute(&mut *tx)
    .await?;
    let row: ServiceOrderDto = sqlx::query_as(&format!(
        "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

// ============================================================================
// Agenda / appointments -- fase 4.3
// ============================================================================

use chrono::{DateTime, Datelike, Duration as ChronoDuration, NaiveDate, NaiveTime, TimeZone, Weekday};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AgendaSettingsDto {
    pub appointment_ai_enabled: bool,
    pub default_duration_minutes: i32,
    pub lead_time_minutes: i32,
    pub max_advance_days: i32,
    pub buffer_minutes: i32,
}

pub async fn get_agenda_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<AgendaSettingsDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: AgendaSettingsDto = sqlx::query_as(
        "SELECT appointment_ai_enabled, default_duration_minutes, lead_time_minutes, \
         max_advance_days, buffer_minutes FROM eletronicos.agenda_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BusinessHourDto {
    pub weekday: i32,
    pub open_time: String,
    pub close_time: String,
}

pub async fn list_business_hours(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<BusinessHourDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<BusinessHourDto> = sqlx::query_as(
        "SELECT weekday, open_time::text, close_time::text FROM eletronicos.agenda_business_hours \
         WHERE tenant_id = $1 ORDER BY weekday",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AppointmentDto {
    pub id: String,
    pub service_id: Option<String>,
    pub service_label: String,
    pub customer_name: String,
    pub customer_phone: String,
    pub starts_at: String,
    pub ends_at: String,
    pub status: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub appointment_type: String,
    pub service_request_id: Option<String>,
}

const APPT_COLUMNS: &str = "id::text, service_id::text, service_label, customer_name, customer_phone, \
    starts_at::text, ends_at::text, status, notes, created_by, appointment_type, service_request_id::text";

#[derive(Debug, Deserialize)]
pub struct ListAppointmentsQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub service_request_id: Option<String>,
}

pub async fn list_appointments(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<ListAppointmentsQuery>,
) -> Result<Json<Vec<AppointmentDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<AppointmentDto> = if let Some(rid) = &q.service_request_id {
        sqlx::query_as(&format!(
            "SELECT {APPT_COLUMNS} FROM eletronicos.appointments \
             WHERE tenant_id = $1 AND service_request_id = $2::uuid ORDER BY starts_at"
        ))
        .bind(&claims.tenant_id)
        .bind(rid)
        .fetch_all(&mut *tx)
        .await?
    } else {
        sqlx::query_as(&format!(
            "SELECT {APPT_COLUMNS} FROM eletronicos.appointments \
             WHERE tenant_id = $1 \
               AND ($2::timestamptz IS NULL OR starts_at >= $2) \
               AND ($3::timestamptz IS NULL OR starts_at <= $3) \
             ORDER BY starts_at"
        ))
        .bind(&claims.tenant_id)
        .bind(q.from.as_deref().and_then(|s| DateTime::parse_from_rfc3339(s).ok()))
        .bind(q.to.as_deref().and_then(|s| DateTime::parse_from_rfc3339(s).ok()))
        .fetch_all(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateAppointmentInput {
    pub service_label: String,
    pub service_id: Option<String>,
    pub customer_name: String,
    pub customer_phone: String,
    /// "AAAA-MM-DD"
    pub date: String,
    /// "HH:MM"
    pub time: String,
    pub duration_minutes: Option<i32>,
    pub notes: Option<String>,
    pub service_request_id: Option<String>,
    pub appointment_type: Option<String>,
}

fn parse_date_time(date: &str, time: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("data inválida, use AAAA-MM-DD".to_string()))
        .and_then(|d| {
            NaiveTime::parse_from_str(time, "%H:%M")
                .map_err(|_| AppError::BadRequest("horário inválido, use HH:MM".to_string()))?;
            Ok(d)
        })
}

/// Cria um agendamento validando: dentro do horário de funcionamento do dia
/// da semana, dentro da janela mínima/máxima configurada (lead_time /
/// max_advance_days), e sem sobrepor outro agendamento ou bloqueio (com
/// buffer_minutes de folga nas duas pontas) -- mesma regra do vrtech
/// (agenda/slots.ts), só que reimplementada aqui em Rust contra o schema
/// já migrado.
pub async fn create_appointment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateAppointmentInput>,
) -> Result<Json<AppointmentDto>, AppError> {
    if input.customer_name.trim().is_empty() || input.customer_phone.trim().is_empty() {
        return Err(AppError::BadRequest("nome e telefone do cliente são obrigatórios".to_string()));
    }
    let naive_date = parse_date_time(&input.date, &input.time)?;
    let naive_time = NaiveTime::parse_from_str(&input.time, "%H:%M").unwrap();
    let naive_dt = naive_date.and_time(naive_time);

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let settings: AgendaSettingsDto = sqlx::query_as(
        "SELECT appointment_ai_enabled, default_duration_minutes, lead_time_minutes, \
         max_advance_days, buffer_minutes FROM eletronicos.agenda_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    let duration = input.duration_minutes.unwrap_or(settings.default_duration_minutes);
    if duration <= 0 {
        return Err(AppError::BadRequest("duração precisa ser maior que zero".to_string()));
    }

    // Fuso: a loja opera em horário de Brasília (UTC-3) -- mesma referência
    // usada pelo resto do backend pra "agora"/janela de agendamento.
    let brasilia = chrono::FixedOffset::west_opt(3 * 3600).expect("offset válido");
    let starts_at = brasilia
        .from_local_datetime(&naive_dt)
        .single()
        .ok_or_else(|| AppError::BadRequest("data/hora inválida".to_string()))?;
    let ends_at = starts_at + ChronoDuration::minutes(duration as i64);
    let now = Utc::now().with_timezone(&brasilia);

    if starts_at < now + ChronoDuration::minutes(settings.lead_time_minutes as i64) {
        return Err(AppError::BadRequest(format!(
            "horário muito próximo -- é preciso agendar com pelo menos {} minutos de antecedência",
            settings.lead_time_minutes
        )));
    }
    if starts_at > now + ChronoDuration::days(settings.max_advance_days as i64) {
        return Err(AppError::BadRequest(format!(
            "a loja só agenda com até {} dia(s) de antecedência",
            settings.max_advance_days
        )));
    }

    let weekday_num = match starts_at.weekday() {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    };
    let hours: Option<(NaiveTime, NaiveTime)> = sqlx::query_as(
        "SELECT open_time, close_time FROM eletronicos.agenda_business_hours \
         WHERE tenant_id = $1 AND weekday = $2",
    )
    .bind(&claims.tenant_id)
    .bind(weekday_num)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((open_time, close_time)) = hours else {
        return Err(AppError::BadRequest("a loja não abre nesse dia da semana".to_string()));
    };
    let start_time = starts_at.time();
    let end_time = ends_at.time();
    if start_time < open_time || end_time > close_time || end_time < start_time {
        return Err(AppError::BadRequest(format!(
            "fora do horário de funcionamento ({open_time}-{close_time})"
        )));
    }

    let buffer = ChronoDuration::minutes(settings.buffer_minutes as i64);
    let window_start = starts_at - buffer;
    let window_end = ends_at + buffer;

    let conflict: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND status = 'agendado' \
           AND starts_at < $3 AND ends_at > $2 LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(window_start)
    .bind(window_end)
    .fetch_optional(&mut *tx)
    .await?;
    if conflict.is_some() {
        return Err(AppError::BadRequest(
            "esse horário já está ocupado por outro agendamento (respeitando o intervalo mínimo entre atendimentos)"
                .to_string(),
        ));
    }
    let blocked: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.agenda_blocks \
         WHERE tenant_id = $1 AND starts_at < $3 AND ends_at > $2 LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(window_start)
    .bind(window_end)
    .fetch_optional(&mut *tx)
    .await?;
    if blocked.is_some() {
        return Err(AppError::BadRequest("esse horário está bloqueado pela loja".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO eletronicos.appointments \
         (id, tenant_id, service_id, service_label, customer_name, customer_phone, starts_at, ends_at, \
          status, notes, created_by, appointment_type, service_request_id) \
         VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,'agendado',$9,$10,$11,$12::uuid)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(input.service_id.as_deref())
    .bind(input.service_label.trim())
    .bind(input.customer_name.trim())
    .bind(input.customer_phone.trim())
    .bind(starts_at)
    .bind(ends_at)
    .bind(input.notes.as_deref())
    .bind("admin")
    .bind(input.appointment_type.as_deref().unwrap_or("service"))
    .bind(input.service_request_id.as_deref())
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO eletronicos.appointment_events \
         (id, tenant_id, appointment_id, action, actor_type, new_starts_at, new_ends_at) \
         VALUES ($1::uuid, $2, $3::uuid, 'created', 'admin', $4, $5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(starts_at)
    .bind(ends_at)
    .execute(&mut *tx)
    .await?;

    let row: AppointmentDto = sqlx::query_as(&format!(
        "SELECT {APPT_COLUMNS} FROM eletronicos.appointments WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct CancelAppointmentInput {
    pub justification: Option<String>,
}

pub async fn cancel_appointment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CancelAppointmentInput>,
) -> Result<Json<AppointmentDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.appointments SET status = 'cancelado', updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid AND status = 'agendado'",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "agendamento não encontrado ou já não está mais ativo".to_string(),
        ));
    }
    sqlx::query(
        "INSERT INTO eletronicos.appointment_events \
         (id, tenant_id, appointment_id, action, actor_type, justification) \
         VALUES ($1::uuid, $2, $3::uuid, 'cancelled', 'admin', $4)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.justification.as_deref())
    .execute(&mut *tx)
    .await?;
    let row: AppointmentDto = sqlx::query_as(&format!(
        "SELECT {APPT_COLUMNS} FROM eletronicos.appointments WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

// ============================================================================
// Estoque -- fase 4.4a
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StockItemDto {
    pub id: String,
    pub name: String,
    pub unit: String,
    pub quantity: f64,
    pub price: Option<f64>,
    pub warranty_days: Option<i32>,
    pub units_per_box: Option<f64>,
    pub low_stock_threshold: Option<f64>,
}

const STOCK_COLUMNS: &str =
    "id::text, name, unit, quantity::float8, price::float8, warranty_days, units_per_box::float8, low_stock_threshold::float8";

pub async fn list_stock_items(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<StockItemDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<StockItemDto> = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 ORDER BY name"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateStockItemInput {
    pub name: String,
    pub unit: String,
    pub quantity: f64,
    pub price: Option<f64>,
    pub warranty_days: Option<i32>,
    pub units_per_box: Option<f64>,
    pub low_stock_threshold: Option<f64>,
}

pub async fn create_stock_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateStockItemInput>,
) -> Result<Json<StockItemDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let id = Uuid::new_v4().to_string();
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.stock_items \
         (id, tenant_id, name, unit, quantity, price, warranty_days, units_per_box, low_stock_threshold) \
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(input.name.trim())
    .bind(&input.unit)
    .bind(input.quantity)
    .bind(input.price)
    .bind(input.warranty_days)
    .bind(input.units_per_box)
    .bind(input.low_stock_threshold)
    .execute(&mut *tx)
    .await?;
    let row: StockItemDto = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct StockEntryInput {
    pub quantity: f64,
}

/// Entrada de estoque (compra de mais peças) -- sempre positivo, sempre
/// registrado em stock_movements pra auditoria.
pub async fn stock_entry(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<StockEntryInput>,
) -> Result<Json<StockItemDto>, AppError> {
    if input.quantity <= 0.0 {
        return Err(AppError::BadRequest("quantidade precisa ser maior que zero".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.stock_items SET quantity = quantity + $3, updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.quantity)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("item de estoque não encontrado".to_string()));
    }
    sqlx::query(
        "INSERT INTO eletronicos.stock_movements (id, tenant_id, item_id, type, quantity, unit) \
         SELECT $1::uuid, $2, $3::uuid, 'entrada', $4, unit FROM eletronicos.stock_items WHERE tenant_id = $2 AND id = $3::uuid",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.quantity)
    .execute(&mut *tx)
    .await?;
    let row: StockItemDto = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

// ============================================================================
// PDV -- fase 4.4b. A geracao/consulta de Pix reaproveita
// routes::admin::create_pdv_pix / get_pdv_pix_status (genericas, ja
// registradas, nao gravam nada -- so criam a cobranca na Mercado Pago do
// tenant). Aqui so o registro da venda/itens/pagamentos no schema
// eletronicos.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PdvSaleDto {
    pub id: String,
    pub status: String,
    pub total_value: f64,
    pub notes: Option<String>,
    pub created_at: String,
    pub concluded_at: Option<String>,
}

const SALE_COLUMNS: &str = "id::text, status, total_value::float8, notes, created_at::text, concluded_at::text";

pub async fn create_pdv_sale(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<PdvSaleDto>, AppError> {
    let id = Uuid::new_v4().to_string();
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.pdv_sales (id, tenant_id, status, total_value) VALUES ($1::uuid, $2, 'aberta', 0)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .execute(&mut *tx)
    .await?;
    let row: PdvSaleDto = sqlx::query_as(&format!(
        "SELECT {SALE_COLUMNS} FROM eletronicos.pdv_sales WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PdvSaleItemDto {
    pub id: String,
    pub sale_id: String,
    pub item_type: String,
    pub product_id: Option<String>,
    pub service_id: Option<String>,
    pub label: String,
    pub quantity: f64,
    pub unit_price: f64,
    pub stock_deducted: bool,
}

#[derive(Debug, Deserialize)]
pub struct AddSaleItemInput {
    pub item_type: String,
    pub product_id: Option<String>,
    pub service_id: Option<String>,
    pub label: String,
    pub quantity: f64,
    pub unit_price: f64,
    /// id de eletronicos.stock_items pra decrementar (peça avulsa vendida
    /// direto no balcão, fora de uma OS) -- opcional.
    pub stock_item_id: Option<String>,
}

/// Adiciona item à venda e recalcula o total. Se `stock_item_id` vier
/// preenchido, decrementa o estoque na hora (venda de balcão à vista, sem
/// passar por ordem de serviço) e registra o movimento.
pub async fn add_sale_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(sale_id): Path<String>,
    Json(input): Json<AddSaleItemInput>,
) -> Result<Json<PdvSaleDto>, AppError> {
    if input.quantity <= 0.0 {
        return Err(AppError::BadRequest("quantidade precisa ser maior que zero".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let sale: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.pdv_sales WHERE tenant_id = $1 AND id = $2::uuid AND status = 'aberta'",
    )
    .bind(&claims.tenant_id)
    .bind(&sale_id)
    .fetch_optional(&mut *tx)
    .await?;
    if sale.is_none() {
        return Err(AppError::NotFound("venda não encontrada ou já concluída".to_string()));
    }

    let item_id = Uuid::new_v4().to_string();
    let stock_deducted = input.stock_item_id.is_some();
    sqlx::query(
        "INSERT INTO eletronicos.pdv_sale_items \
         (id, tenant_id, sale_id, item_type, product_id, service_id, label, quantity, unit_price, stock_deducted) \
         VALUES ($1::uuid,$2,$3::uuid,$4,$5::uuid,$6::uuid,$7,$8,$9,$10)",
    )
    .bind(&item_id)
    .bind(&claims.tenant_id)
    .bind(&sale_id)
    .bind(&input.item_type)
    .bind(input.product_id.as_deref())
    .bind(input.service_id.as_deref())
    .bind(input.label.trim())
    .bind(input.quantity)
    .bind(input.unit_price)
    .bind(stock_deducted)
    .execute(&mut *tx)
    .await?;

    if let Some(stock_item_id) = &input.stock_item_id {
        let stock: Option<(f64,)> = sqlx::query_as(
            "SELECT quantity::float8 FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(stock_item_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((available,)) = stock else {
            return Err(AppError::BadRequest("item de estoque não encontrado".to_string()));
        };
        if available < input.quantity {
            return Err(AppError::BadRequest(format!(
                "estoque insuficiente (disponível: {available})"
            )));
        }
        sqlx::query(
            "UPDATE eletronicos.stock_items SET quantity = quantity - $3, updated_at = now() \
             WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(stock_item_id)
        .bind(input.quantity)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO eletronicos.stock_movements (id, tenant_id, item_id, type, quantity, unit) \
             SELECT $1::uuid, $2, $3::uuid, 'saida', $4, unit FROM eletronicos.stock_items WHERE tenant_id = $2 AND id = $3::uuid",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&claims.tenant_id)
        .bind(stock_item_id)
        .bind(input.quantity)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "UPDATE eletronicos.pdv_sales SET total_value = ( \
           SELECT COALESCE(SUM(quantity * unit_price), 0) FROM eletronicos.pdv_sale_items \
           WHERE tenant_id = $1 AND sale_id = $2::uuid \
         ), updated_at = now() WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&sale_id)
    .execute(&mut *tx)
    .await?;

    let row: PdvSaleDto = sqlx::query_as(&format!(
        "SELECT {SALE_COLUMNS} FROM eletronicos.pdv_sales WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&sale_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize)]
pub struct PdvSaleDetailDto {
    pub sale: PdvSaleDto,
    pub items: Vec<PdvSaleItemDto>,
    pub payments: Vec<PdvPaymentDto>,
}

pub async fn get_pdv_sale(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<PdvSaleDetailDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let sale: Option<PdvSaleDto> = sqlx::query_as(&format!(
        "SELECT {SALE_COLUMNS} FROM eletronicos.pdv_sales WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(sale) = sale else {
        return Err(AppError::NotFound("venda não encontrada".to_string()));
    };
    let items: Vec<PdvSaleItemDto> = sqlx::query_as(
        "SELECT id::text, sale_id::text, item_type, product_id::text, service_id::text, label, quantity::float8, unit_price::float8, stock_deducted \
         FROM eletronicos.pdv_sale_items WHERE tenant_id = $1 AND sale_id = $2::uuid ORDER BY id",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    let payments: Vec<PdvPaymentDto> = sqlx::query_as(&format!(
        "SELECT {PAYMENT_COLUMNS} FROM eletronicos.pdv_payments WHERE tenant_id = $1 AND sale_id = $2::uuid ORDER BY created_at"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(PdvSaleDetailDto { sale, items, payments }))
}

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct PdvPaymentDto {
    pub id: String,
    pub sale_id: String,
    pub method: String,
    pub amount: f64,
    pub status: String,
    pub installments: Option<i32>,
    pub change_amount: Option<f64>,
    pub mp_payment_id: Option<String>,
}

const PAYMENT_COLUMNS: &str =
    "id::text, sale_id::text, method, amount::float8, status, installments, change_amount::float8, mp_payment_id";

#[derive(Debug, Deserialize)]
pub struct AddPaymentInput {
    /// "pix" | "cartao" | "dinheiro"
    pub method: String,
    pub amount: f64,
    pub installments: Option<i32>,
    pub change_amount: Option<f64>,
    /// Já vem preenchido pro pix (a cobrança foi criada via
    /// /api/admin/pdv/pix antes desta chamada) -- cartão/dinheiro ficam
    /// pendentes até o endpoint de confirmação manual.
    pub mp_payment_id: Option<String>,
}

pub async fn add_payment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(sale_id): Path<String>,
    Json(input): Json<AddPaymentInput>,
) -> Result<Json<PdvSaleDetailDto>, AppError> {
    if input.amount <= 0.0 {
        return Err(AppError::BadRequest("valor precisa ser maior que zero".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    // Pix com mp_payment_id já vem "pendente" até o polling confirmar de
    // verdade (ver confirm_payment); cartão/dinheiro precisam de baixa
    // manual do lojista também -- nunca marca "pago" sozinho aqui.
    sqlx::query(
        "INSERT INTO eletronicos.pdv_payments \
         (id, tenant_id, sale_id, method, amount, status, installments, change_amount, mp_payment_id) \
         VALUES ($1::uuid,$2,$3::uuid,$4,$5,'pendente',$6,$7,$8)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&sale_id)
    .bind(&input.method)
    .bind(input.amount)
    .bind(input.installments)
    .bind(input.change_amount)
    .bind(input.mp_payment_id.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    get_pdv_sale(State(state), AdminUser(claims), Path(sale_id)).await
}

/// Confirma um pagamento (manual pra cartão/dinheiro, ou depois do polling
/// de status aprovado pro Pix) -- se a soma dos pagamentos confirmados
/// cobrir o total, fecha a venda.
pub async fn confirm_payment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path((sale_id, payment_id)): Path<(String, String)>,
) -> Result<Json<PdvSaleDetailDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.pdv_payments SET status = 'confirmado', confirmed_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid AND sale_id = $3::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&payment_id)
    .bind(&sale_id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("pagamento não encontrado".to_string()));
    }

    let sums: (Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT (SELECT total_value::float8 FROM eletronicos.pdv_sales WHERE tenant_id = $1 AND id = $2::uuid), \
                (SELECT COALESCE(SUM(amount), 0)::float8 FROM eletronicos.pdv_payments \
                 WHERE tenant_id = $1 AND sale_id = $2::uuid AND status = 'confirmado')",
    )
    .bind(&claims.tenant_id)
    .bind(&sale_id)
    .fetch_one(&mut *tx)
    .await?;
    let (total, paid) = (sums.0.unwrap_or(0.0), sums.1.unwrap_or(0.0));
    if paid + 0.01 >= total {
        sqlx::query(
            "UPDATE eletronicos.pdv_sales SET status = 'concluida', concluded_at = now(), updated_at = now() \
             WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(&sale_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    get_pdv_sale(State(state), AdminUser(claims), Path(sale_id)).await
}

// ============================================================================
// Templates WhatsApp -- fase 4.5
//
// Porta o admin de "Template Zap" do vrtech (src/app/dashboard/template-zap)
// 1:1: mesmas colunas, mesma semantica de `editable` (trava edicao de
// conteudo -- usado pelo template de link de pagamento, que e' montado pelo
// sistema) vs `enabled` (liga/desliga o disparo, independente de editable).
// O renderer (variaveis `/nome`) e' reaproveitado tanto pelo preview do
// admin quanto pelo envio de verdade feito pelo pipeline do assistente.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WhatsappTemplateDto {
    pub id: String,
    pub template_key: String,
    pub section: String,
    pub label: String,
    pub description: Option<String>,
    pub content: String,
    pub required_variables: Vec<String>,
    pub available_variables: Vec<String>,
    pub editable: bool,
    pub enabled: bool,
    pub sort_order: i32,
}

const TEMPLATE_COLUMNS: &str = "id::text, template_key, section, label, description, content, \
     required_variables, available_variables, editable, enabled, sort_order";

pub async fn list_whatsapp_templates(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<WhatsappTemplateDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<WhatsappTemplateDto> = sqlx::query_as(&format!(
        "SELECT {TEMPLATE_COLUMNS} FROM eletronicos.whatsapp_templates \
         WHERE tenant_id = $1 ORDER BY section, sort_order"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct UpdateTemplateContentInput {
    pub content: String,
}

/// Só o `content` é editável pelo admin -- as colunas de metadado (label,
/// section, variáveis) nascem via migration/seed e não têm rota de edição,
/// mesma superfície do vrtech original.
pub async fn update_whatsapp_template_content(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(key): Path<String>,
    Json(input): Json<UpdateTemplateContentInput>,
) -> Result<Json<WhatsappTemplateDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let editable: Option<bool> = sqlx::query_scalar(
        "SELECT editable FROM eletronicos.whatsapp_templates WHERE tenant_id = $1 AND template_key = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    match editable {
        None => return Err(AppError::NotFound("template não encontrado".to_string())),
        Some(false) => {
            return Err(AppError::BadRequest(
                "este template é gerado pelo sistema e não pode ser editado".to_string(),
            ))
        }
        Some(true) => {}
    }

    let missing: Vec<String> = {
        let required: Vec<String> = sqlx::query_scalar(
            "SELECT unnest(required_variables) FROM eletronicos.whatsapp_templates \
             WHERE tenant_id = $1 AND template_key = $2",
        )
        .bind(&claims.tenant_id)
        .bind(&key)
        .fetch_all(&mut *tx)
        .await?;
        required
            .into_iter()
            .filter(|v| !input.content.contains(&format!("/{v}")))
            .collect()
    };
    if !missing.is_empty() {
        return Err(AppError::BadRequest(format!(
            "faltam variáveis obrigatórias no conteúdo: {}",
            missing.iter().map(|v| format!("/{v}")).collect::<Vec<_>>().join(", ")
        )));
    }

    sqlx::query(
        "UPDATE eletronicos.whatsapp_templates SET content = $3, updated_at = now() \
         WHERE tenant_id = $1 AND template_key = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&key)
    .bind(&input.content)
    .execute(&mut *tx)
    .await?;

    let row: WhatsappTemplateDto = sqlx::query_as(&format!(
        "SELECT {TEMPLATE_COLUMNS} FROM eletronicos.whatsapp_templates \
         WHERE tenant_id = $1 AND template_key = $2"
    ))
    .bind(&claims.tenant_id)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct ToggleTemplateInput {
    pub enabled: bool,
}

pub async fn toggle_whatsapp_template(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(key): Path<String>,
    Json(input): Json<ToggleTemplateInput>,
) -> Result<Json<WhatsappTemplateDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.whatsapp_templates SET enabled = $3, updated_at = now() \
         WHERE tenant_id = $1 AND template_key = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&key)
    .bind(input.enabled)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("template não encontrado".to_string()));
    }
    let row: WhatsappTemplateDto = sqlx::query_as(&format!(
        "SELECT {TEMPLATE_COLUMNS} FROM eletronicos.whatsapp_templates \
         WHERE tenant_id = $1 AND template_key = $2"
    ))
    .bind(&claims.tenant_id)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

/// Interpola variáveis no formato `/nome` (mesma sintaxe do vrtech). Usado
/// tanto pelo preview do admin quanto pelo disparo de verdade no pipeline do
/// assistente/notificações -- porta 1:1 de `src/lib/templates/renderer.ts`.
pub fn render_template(content: &str, vars: &std::collections::HashMap<String, String>) -> String {
    let mut out = content.to_string();
    // ordena por tamanho de chave decrescente pra evitar que `/nome` capture
    // um prefixo antes de `/nome_completo` ser substituído.
    let mut keys: Vec<&String> = vars.keys().collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
    for k in keys {
        out = out.replace(&format!("/{k}"), vars.get(k).map(String::as_str).unwrap_or(""));
    }
    out
}

/// Busca o template no banco; se ausente/vazio ou desabilitado, retorna
/// `None` (chamador decide se usa fallback hardcoded ou não envia nada) --
/// mesma semântica de `isTemplateEnabled` + `renderMessage` do vrtech.
pub async fn render_whatsapp_template(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    key: &str,
    vars: &std::collections::HashMap<String, String>,
) -> Result<Option<String>, AppError> {
    let row: Option<(String, bool)> = sqlx::query_as(
        "SELECT content, enabled FROM eletronicos.whatsapp_templates \
         WHERE tenant_id = $1 AND template_key = $2",
    )
    .bind(tenant_id)
    .bind(key)
    .fetch_optional(tx)
    .await?;
    match row {
        Some((content, true)) if !content.trim().is_empty() => {
            Ok(Some(render_template(&content, vars)))
        }
        _ => Ok(None),
    }
}

// ============================================================================
// Consultar (vitrine pública) -- fase 4.6
//
// Porta `consultarAtendimentoEmAndamento` do vrtech: cliente sem login,
// informando telefone, vê o status de tudo que tem em aberto -- solicitação
// de serviço, OS/reparo em andamento, e próximos agendamentos. Nunca expõe
// dado de outro tenant nem de outro telefone (tenant vem do slug, filtro
// sempre por customer_phone = $2).
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ConsultarServiceRequestDto {
    #[serde(flatten)]
    pub request: ServiceRequestDto,
    pub service_order: Option<ServiceOrderDto>,
}

#[derive(Debug, Serialize)]
pub struct ConsultarResponse {
    pub requests: Vec<ConsultarServiceRequestDto>,
    pub appointments: Vec<AppointmentDto>,
}

/// Só telefones com dígito -- normaliza igual ao resto do módulo (WhatsApp
/// manda com formatação variável, o cadastro também).
fn digits_only(s: &str) -> String {
    s.chars().filter(char::is_ascii_digit).collect()
}

pub async fn consultar_por_telefone(
    State(state): State<AppState>,
    Path((slug, phone)): Path<(String, String)>,
) -> Result<Json<ConsultarResponse>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let digits = digits_only(&phone);
    if digits.is_empty() {
        return Err(AppError::BadRequest("telefone inválido".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;

    let requests: Vec<ServiceRequestDto> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests \
         WHERE tenant_id = $1 AND customer_phone = $2 AND status <> 'cancelled' \
         ORDER BY created_at DESC LIMIT 10"
    ))
    .bind(&store.id)
    .bind(&digits)
    .fetch_all(&mut *tx)
    .await?;

    let mut out = Vec::with_capacity(requests.len());
    for request in requests {
        let service_order: Option<ServiceOrderDto> = sqlx::query_as(&format!(
            "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND request_id = $2::uuid"
        ))
        .bind(&store.id)
        .bind(&request.id)
        .fetch_optional(&mut *tx)
        .await?;
        out.push(ConsultarServiceRequestDto { request, service_order });
    }

    let appointments: Vec<AppointmentDto> = sqlx::query_as(&format!(
        "SELECT {APPT_COLUMNS} FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND customer_phone = $2 AND status = 'agendado' \
         ORDER BY starts_at ASC"
    ))
    .bind(&store.id)
    .bind(&digits)
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(ConsultarResponse { requests: out, appointments }))
}
