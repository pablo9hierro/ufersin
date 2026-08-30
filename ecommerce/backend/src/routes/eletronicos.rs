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
use axum::http::StatusCode;
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
    /// Soma dos serviços de catálogo escolhidos no wizard da vitrine --
    /// estimativa, o valor final ainda depende do diagnóstico.
    pub estimated_quote_value: Option<f64>,
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
    pub discount_percent: Option<i32>,
    pub payment_methods: Option<serde_json::Value>,
    pub estimated_quote_value: Option<f64>,
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

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CredentialDto {
    pub kind: String,
    pub value: String,
}

/// Senha do cliente (PIN/padrão) pro aparelho -- nunca exposta em endpoint
/// público, só admin autenticado do próprio tenant.
pub async fn get_credential(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(request_id): Path<String>,
) -> Result<Json<Option<CredentialDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<CredentialDto> = sqlx::query_as(
        "SELECT kind, value FROM eletronicos.service_request_credentials \
         WHERE tenant_id = $1 AND service_request_id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct SetCredentialInput {
    pub kind: String,
    pub value: String,
}

pub async fn set_credential(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(request_id): Path<String>,
    Json(input): Json<SetCredentialInput>,
) -> Result<Json<CredentialDto>, AppError> {
    if input.kind != "pin" && input.kind != "pattern" {
        return Err(AppError::BadRequest("kind precisa ser 'pin' ou 'pattern'".to_string()));
    }
    if input.value.trim().is_empty() {
        return Err(AppError::BadRequest("value não pode ser vazio".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.service_request_credentials (id, service_request_id, tenant_id, kind, value) \
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4) \
         ON CONFLICT (service_request_id) DO UPDATE SET kind = $3, value = $4, updated_at = now()",
    )
    .bind(&request_id)
    .bind(&claims.tenant_id)
    .bind(&input.kind)
    .bind(&input.value)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(CredentialDto { kind: input.kind, value: input.value }))
}

// ============================================================================
// Diagnóstico físico (aguardando_diagnostico -> diagnostico_enviado/in_progress)
// -- port de DiagnosticSection.tsx do vrtech.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DiagnosticDto {
    pub id: String,
    pub services_selected: serde_json::Value,
    pub notes: Option<String>,
    pub pdf_url: Option<String>,
    pub quote_confirmed: Option<f64>,
    pub media_urls: Vec<String>,
    pub finalized: bool,
}

const DIAG_COLUMNS: &str =
    "id::text, services_selected, notes, pdf_url, quote_confirmed::float8, media_urls, finalized";

pub async fn get_diagnostic(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(request_id): Path<String>,
) -> Result<Json<Option<DiagnosticDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<DiagnosticDto> = sqlx::query_as(&format!(
        "SELECT {DIAG_COLUMNS} FROM eletronicos.service_diagnostics \
         WHERE tenant_id = $1 AND service_request_id = $2::uuid \
         ORDER BY created_at DESC LIMIT 1"
    ))
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct SaveDiagnosticInput {
    pub services_selected: serde_json::Value,
    pub notes: Option<String>,
    pub pdf_url: Option<String>,
    pub quote_confirmed: Option<f64>,
    pub media_urls: Vec<String>,
    pub finalized: bool,
}

/// Salva (upsert por service_request_id, sem UNIQUE constraint na tabela
/// real -- então checa manualmente) o diagnóstico. Quando `finalized=true`,
/// também decide e aplica o próximo status: orçamento real <= estimado ->
/// avança sozinho pro reparo (in_progress); maior -> fica em
/// diagnostico_enviado esperando aprovação do cliente. Mesma regra de
/// decideQuoteOutcome do vrtech. O aviso por WhatsApp já sai sozinho (ver
/// update_service_request_status), não precisa disparar aqui de novo.
pub async fn save_diagnostic(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(request_id): Path<String>,
    Json(input): Json<SaveDiagnosticInput>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let existing_id: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.service_diagnostics \
         WHERE tenant_id = $1 AND service_request_id = $2::uuid ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((id,)) = existing_id {
        sqlx::query(
            "UPDATE eletronicos.service_diagnostics \
             SET services_selected = $3, notes = $4, pdf_url = $5, quote_confirmed = $6, \
                 media_urls = $7, finalized = $8, updated_at = now() \
             WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(&input.services_selected)
        .bind(input.notes.as_deref())
        .bind(input.pdf_url.as_deref())
        .bind(input.quote_confirmed)
        .bind(&input.media_urls)
        .bind(input.finalized)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO eletronicos.service_diagnostics \
               (id, tenant_id, service_request_id, services_selected, notes, pdf_url, quote_confirmed, media_urls, finalized) \
             VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4, $5, $6, $7, $8)",
        )
        .bind(&claims.tenant_id)
        .bind(&request_id)
        .bind(&input.services_selected)
        .bind(input.notes.as_deref())
        .bind(input.pdf_url.as_deref())
        .bind(input.quote_confirmed)
        .bind(&input.media_urls)
        .bind(input.finalized)
        .execute(&mut *tx)
        .await?;
    }

    let row: ServiceRequestDto = if input.finalized {
        let estimated: Option<f64> = sqlx::query_scalar(
            "SELECT estimated_quote_value::float8 FROM eletronicos.service_requests \
             WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(&request_id)
        .fetch_one(&mut *tx)
        .await?;
        let final_value = input.quote_confirmed.unwrap_or(0.0);
        let auto_advance = estimated.is_some_and(|e| final_value <= e);
        let next_status = if auto_advance { "in_progress" } else { "diagnostico_enviado" };
        sqlx::query(
            "UPDATE eletronicos.service_requests SET status = $3, quote_value = $4 \
             WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(&request_id)
        .bind(next_status)
        .bind(final_value)
        .execute(&mut *tx)
        .await?;
        sqlx::query_as(&format!(
            "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid"
        ))
        .bind(&claims.tenant_id)
        .bind(&request_id)
        .fetch_one(&mut *tx)
        .await?
    } else {
        sqlx::query_as(&format!(
            "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid"
        ))
        .bind(&claims.tenant_id)
        .bind(&request_id)
        .fetch_one(&mut *tx)
        .await?
    };

    // Avisa por WhatsApp na transição final (mesmo template status_<status>
    // já usado em update_service_request_status) -- aqui é um caso à parte
    // porque a mudança de status acontece dentro desta mesma transação, não
    // por aquele endpoint.
    if input.finalized {
        let mut vars = std::collections::HashMap::new();
        vars.insert("nome".to_string(), row.customer_name.clone());
        vars.insert("aparelho".to_string(), row.phone_model.clone().unwrap_or_default());
        vars.insert("valor".to_string(), row.quote_value.map(|v| format!("R$ {v:.2}")).unwrap_or_default());
        let template_key = format!("status_{}", row.status);
        if let Some(message) = render_whatsapp_template(&mut *tx, &claims.tenant_id, &template_key, &vars).await? {
            let tenant = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
            let digits: String = row.customer_phone.chars().filter(char::is_ascii_digit).collect();
            crate::whatsapp::notify(&state, &tenant.whatsapp_instance, &digits, &message);
        }
    }

    tx.commit().await?;
    Ok(Json(row))
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
          diagnosis_requested, estimated_quote_value, status, source) \
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)",
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
    .bind(input.estimated_quote_value)
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
         SET status = $3, quote_value = COALESCE($4, quote_value), owner_notes = COALESCE($5, owner_notes), \
             discount_percent = COALESCE($6, discount_percent), \
             payment_methods = COALESCE($7, payment_methods), \
             estimated_quote_value = COALESCE($8, estimated_quote_value) \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&input.status)
    .bind(input.quote_value)
    .bind(input.owner_notes.as_deref())
    .bind(input.discount_percent)
    .bind(&input.payment_methods)
    .bind(input.estimated_quote_value)
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

    // Avisa o cliente por WhatsApp usando o template `status_<novo_status>`
    // (mesmo texto que o lojista edita em Template Zap) -- só dispara se
    // existir e estiver habilitado (render_whatsapp_template retorna None
    // nesses casos). Fire-and-forget, nunca bloqueia nem falha a resposta.
    let template_key = format!("status_{}", input.status);
    let mut vars = std::collections::HashMap::new();
    vars.insert("nome".to_string(), row.customer_name.clone());
    vars.insert("aparelho".to_string(), row.phone_model.clone().unwrap_or_default());
    vars.insert(
        "valor".to_string(),
        row.quote_value.map(|v| format!("R$ {v:.2}")).unwrap_or_default(),
    );
    vars.insert("endereco".to_string(), row.address_label.clone().unwrap_or_default());
    vars.insert(
        "mapa".to_string(),
        match (row.address_lat, row.address_lng) {
            (Some(lat), Some(lng)) => format!("https://www.google.com/maps/search/?api=1&query={lat},{lng}"),
            _ => String::new(),
        },
    );
    if let Some(message) = render_whatsapp_template(&mut *tx, &claims.tenant_id, &template_key, &vars).await? {
        let tenant = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
        let digits: String = row.customer_phone.chars().filter(char::is_ascii_digit).collect();
        crate::whatsapp::notify(&state, &tenant.whatsapp_instance, &digits, &message);
    }

    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct UpdateQuoteValueInput {
    pub quote_value: f64,
}

/// Atualiza so o quote_value, sem mexer no status e sem disparar o
/// template de WhatsApp `status_<status>` -- usado ao salvar a checklist
/// da OS (ServiceOrderPanel), que precisa refletir o valor somado dos
/// componentes marcados sem reenviar a mesma notificacao de status a cada
/// salvamento.
pub async fn update_quote_value(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateQuoteValueInput>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_requests SET quote_value = $3 WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.quote_value)
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
    /// Quantidade consumida da peça vinculada, na unidade abaixo -- default
    /// 1/'unidade' preserva o comportamento antigo (checklist criado antes
    /// desses campos existirem, ou item ligado a peça 'unidade'/'caixa'
    /// simples, sem completar nada).
    #[serde(default = "default_checklist_quantity")]
    pub quantity: f64,
    #[serde(default = "default_unit")]
    pub unit: String,
    pub added_at: Option<String>,
}

fn default_checklist_quantity() -> f64 {
    1.0
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

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ClosedServiceOrderDto {
    pub id: String,
    pub request_id: String,
    pub closed_at: Option<String>,
    pub final_value: Option<f64>,
    pub customer_name: String,
    pub customer_phone: String,
    pub phone_model: Option<String>,
    pub payment_methods: serde_json::Value,
    pub shipping_price: Option<f64>,
}

/// Ordens de serviço já fechadas (com valor final) -- alimenta a aba
/// "Manutenção" de Relatórios (RelatoriosClient.tsx do vrtech). Só as
/// fechadas importam pra faturamento; em aberto não teve valor cobrado
/// ainda.
pub async fn list_closed_service_orders(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<ClosedServiceOrderDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ClosedServiceOrderDto> = sqlx::query_as(
        "SELECT so.id::text, so.request_id::text, so.closed_at::text, so.final_value::float8, \
                sr.customer_name, sr.customer_phone, sr.phone_model, sr.payment_methods, sr.shipping_price::float8 \
         FROM eletronicos.service_orders so \
         JOIN eletronicos.service_requests sr ON sr.id = so.request_id AND sr.tenant_id = so.tenant_id \
         WHERE so.tenant_id = $1 AND so.closed_at IS NOT NULL AND so.final_value IS NOT NULL \
         ORDER BY so.closed_at DESC",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

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
            // Achado no audit: antes fixo em "1 unidade" mesmo pra peça ERP
            // formulação (ex: pasta térmica em g) -- agora respeita a
            // quantidade/unidade completadas no checklist, convertidas pra
            // unidade real da peça (convert_stock_unit rejeita família
            // incompatível, nunca deduz errado silenciosamente).
            if let Some(stock_item_id) = &item.stock_item_id {
                let stock_unit: Option<String> = sqlx::query_scalar(
                    "SELECT unit FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid",
                )
                .bind(&claims.tenant_id)
                .bind(stock_item_id)
                .fetch_optional(&mut *tx)
                .await?;
                let Some(stock_unit) = stock_unit else {
                    return Err(AppError::BadRequest("peça de estoque não encontrada".to_string()));
                };
                let delta = convert_stock_unit(item.quantity.max(0.0), &item.unit, &stock_unit)?;
                sqlx::query(
                    "INSERT INTO eletronicos.stock_movements \
                     (id, tenant_id, item_id, type, quantity, unit) \
                     VALUES ($1::uuid, $2, $3::uuid, 'saida', $4, $5)",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&claims.tenant_id)
                .bind(stock_item_id)
                .bind(delta)
                .bind(&stock_unit)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "UPDATE eletronicos.stock_items SET quantity = quantity - $3, updated_at = now() \
                     WHERE tenant_id = $1 AND id = $2::uuid",
                )
                .bind(&claims.tenant_id)
                .bind(stock_item_id)
                .bind(delta)
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

// ============================================================================
// Config de frete (coleta/entrega) -- port de shipping_settings do vrtech,
// aqui por tenant em vez de single-row global.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ShippingSettingsDto {
    pub price_per_km: f64,
    pub minutes_per_km: f64,
    pub store_lat: Option<f64>,
    pub store_lng: Option<f64>,
    pub store_address: Option<String>,
    pub max_km: Option<f64>,
    pub cobrar_coleta: bool,
    pub cobrar_entrega: bool,
}

const SHIPPING_COLUMNS: &str = "price_per_km::float8, minutes_per_km::float8, store_lat, store_lng, \
    store_address, max_km::float8, cobrar_coleta, cobrar_entrega";

pub async fn get_shipping_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<ShippingSettingsDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query("INSERT INTO eletronicos.shipping_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING")
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
    let row: ShippingSettingsDto = sqlx::query_as(&format!(
        "SELECT {SHIPPING_COLUMNS} FROM eletronicos.shipping_settings WHERE tenant_id = $1"
    ))
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct UpdateShippingSettingsInput {
    pub price_per_km: f64,
    pub minutes_per_km: f64,
    pub store_lat: Option<f64>,
    pub store_lng: Option<f64>,
    pub store_address: String,
    pub max_km: Option<f64>,
    pub cobrar_coleta: bool,
    pub cobrar_entrega: bool,
}

pub async fn update_shipping_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<UpdateShippingSettingsInput>,
) -> Result<Json<ShippingSettingsDto>, AppError> {
    if input.price_per_km < 0.0 {
        return Err(AppError::BadRequest("preço por km não pode ser negativo".to_string()));
    }
    if input.store_address.trim().is_empty() {
        return Err(AppError::BadRequest("informe o endereço da loja".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.shipping_settings \
           (tenant_id, price_per_km, minutes_per_km, store_lat, store_lng, store_address, max_km, cobrar_coleta, cobrar_entrega) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
           price_per_km = $2, minutes_per_km = $3, store_lat = $4, store_lng = $5, \
           store_address = $6, max_km = $7, cobrar_coleta = $8, cobrar_entrega = $9",
    )
    .bind(&claims.tenant_id)
    .bind(input.price_per_km)
    .bind(input.minutes_per_km)
    .bind(input.store_lat)
    .bind(input.store_lng)
    .bind(input.store_address.trim())
    .bind(input.max_km)
    .bind(input.cobrar_coleta)
    .bind(input.cobrar_entrega)
    .execute(&mut *tx)
    .await?;
    let row: ShippingSettingsDto = sqlx::query_as(&format!(
        "SELECT {SHIPPING_COLUMNS} FROM eletronicos.shipping_settings WHERE tenant_id = $1"
    ))
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

// ============================================================================
// Localização ao vivo do lojista/técnico -- mapa de trajetória (loja/técnico
// -> endereço do cliente) no dashboard admin E em /consultar do cliente
// quando a solicitação está em deslocamento. Port do conceito de
// driver_location do vrtech (uma linha 'default' por tenant -- loja de
// técnico só, sem frota de motoboys) + push periódico via
// navigator.geolocation.watchPosition no browser do lojista logado.
// ============================================================================

#[derive(Debug, Serialize)]
pub struct DriverLocationDto {
    pub lat: f64,
    pub lng: f64,
    /// None quando é o fallback (endereço fixo da loja, ninguém enviou GPS
    /// ainda/recente) -- Some quando é posição real ao vivo.
    pub updated_at: Option<String>,
    /// false = fallback (endereço fixo da loja). O mapa mostra a mesma
    /// forma nos dois casos (nunca fica sem A pra mostrar), só o rótulo
    /// muda ("ao vivo" vs "endereço da loja").
    pub is_live: bool,
}

/// Localização mais recente do tenant: linha real em driver_location (se
/// existir) -- senão o endereço fixo da loja (shipping_settings), pra
/// nunca deixar o mapa sem ponto A. Mesmo mecanismo do LiveTrackingMap
/// real original: ele nunca teve GPS ao vivo de verdade em produção, só
/// usava a loja fixa -- ao vivo é aditivo aqui, não substitui esse
/// fallback quando ainda não tem fix nenhum.
async fn resolve_driver_location(tx: &mut sqlx::PgConnection, tenant_id: &str) -> Result<Option<DriverLocationDto>, AppError> {
    // "Viva" só se atualizada nos últimos 10 minutos -- evita mostrar um
    // pino parado de horas atrás (browser fechado/sem sinal) como se fosse
    // ao vivo; cai pro fallback da loja nesse caso.
    let live: Option<(f64, f64, String)> = sqlx::query_as(
        "SELECT lat, lng, updated_at::text FROM eletronicos.driver_location \
         WHERE tenant_id = $1 AND id = $1 AND updated_at > now() - interval '10 minutes'",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((lat, lng, updated_at)) = live {
        return Ok(Some(DriverLocationDto { lat, lng, updated_at: Some(updated_at), is_live: true }));
    }
    let store: Option<(Option<f64>, Option<f64>)> =
        sqlx::query_as("SELECT store_lat, store_lng FROM eletronicos.shipping_settings WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some((Some(lat), Some(lng))) = store {
        return Ok(Some(DriverLocationDto { lat, lng, updated_at: None, is_live: false }));
    }
    Ok(None)
}

#[derive(Debug, Deserialize)]
pub struct UpdateDriverLocationInput {
    pub lat: f64,
    pub lng: f64,
}

pub async fn update_driver_location(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<UpdateDriverLocationInput>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    // `id` é a PK sozinha nessa tabela (mirror de um schema single-tenant
    // original, nunca migrado pra composite key) -- usar tenant_id como id
    // em vez do literal 'default' evita colisão entre tenants (loja de
    // técnico só, uma linha por tenant já basta).
    sqlx::query(
        "INSERT INTO eletronicos.driver_location (id, tenant_id, lat, lng, updated_at) \
         VALUES ($1, $1, $2, $3, now()) \
         ON CONFLICT (id) DO UPDATE SET lat = $2, lng = $3, updated_at = now()",
    )
    .bind(&claims.tenant_id)
    .bind(input.lat)
    .bind(input.lng)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_driver_location_admin(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Option<DriverLocationDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = resolve_driver_location(&mut tx, &claims.tenant_id).await?;
    tx.commit().await?;
    Ok(Json(result))
}

/// Público -- usado em /consultar (cliente acompanhando a própria
/// solicitação) e reaproveitado pelo próprio mapa do admin (mesma
/// resposta, não expõe nada sensível: só lat/lng/hora).
pub async fn get_driver_location_public(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Option<DriverLocationDto>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let result = resolve_driver_location(&mut tx, &store.id).await?;
    tx.commit().await?;
    Ok(Json(result))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AgendaSettingsDto {
    pub appointment_ai_enabled: bool,
    pub default_duration_minutes: i32,
    pub lead_time_minutes: i32,
    pub max_advance_days: i32,
    pub buffer_minutes: i32,
}

/// Executa um INSERT idempotente (guardado por `WHERE NOT EXISTS`) na sua
/// PRÓPRIA transação curta -- a página de agenda faz polling, então duas
/// requisições concorrentes podem passar pela checagem `NOT EXISTS` ao
/// mesmo tempo e uma delas esbarra num unique_violation real ao inserir.
/// Rodar isolado (não dentro da transação principal do handler) evita que
/// esse erro aborte a transação inteira -- um erro de unique_violation aqui
/// só significa "a outra requisição já inseriu", segue o fluxo normal.
async fn seed_idempotent(pool: &sqlx::PgPool, tenant_id: &str, sql: &str) -> Result<(), AppError> {
    let mut tx = tenant::tenant_tx(pool, tenant_id).await?;
    match sqlx::query(sql).bind(tenant_id).execute(&mut *tx).await {
        Ok(_) => tx.commit().await?,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            tx.rollback().await?;
        }
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

pub async fn get_agenda_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<AgendaSettingsDto>, AppError> {
    // Tenant que ainda nunca abriu a agenda (ex: ecommerce genérico recém
    // ligou "oferece serviços") não tem linha aqui -- cria com valores
    // padrão na primeira leitura em vez de 500 (essas tabelas não fazem
    // parte da migração automática do sqlx, foram provisionadas só pro
    // tenant eletrônica original).
    // migration 0039 garante as constraints UNIQUE que faltavam nessas
    // tabelas (provisionadas à mão fora do fluxo de migração) -- com elas,
    // ON CONFLICT DO NOTHING é atômico de verdade (uma corrida real entre
    // requisições concorrentes, já que a página de agenda faz polling, não
    // gera mais unique_violation nem linha fantasma).
    // `id` (a PRIMARY KEY de verdade dessa tabela) tem DEFAULT 'default' --
    // resquício de quando essa tabela guardava só a config do tenant
    // eletrônica original, uma linha só. Sem passar um `id` próprio aqui, a
    // segunda linha (deste tenant) colide no PK contra a linha 'default'
    // já existente -- ON CONFLICT (tenant_id) não pega esse conflito (é
    // noutra constraint), o INSERT falha silenciosamente e nunca semeia
    // nada. Usa o próprio tenant_id como id -- já é único.
    seed_idempotent(
        &state.pool,
        &claims.tenant_id,
        "INSERT INTO eletronicos.agenda_settings \
         (id, tenant_id, appointment_ai_enabled, default_duration_minutes, lead_time_minutes, max_advance_days, buffer_minutes) \
         VALUES ($1, $1, false, 60, 60, 30, 15) \
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .await?;
    seed_idempotent(
        &state.pool,
        &claims.tenant_id,
        "INSERT INTO eletronicos.agenda_business_hours (tenant_id, weekday, open_time, close_time) \
         SELECT $1, w, '09:00'::time, CASE WHEN w = 6 THEN '13:00'::time ELSE '18:00'::time END \
         FROM generate_series(1, 6) AS w \
         ON CONFLICT (tenant_id, weekday) DO NOTHING",
    )
    .await?;
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

#[derive(Debug, Deserialize)]
pub struct AgendaSettingsInput {
    pub appointment_ai_enabled: bool,
    pub lead_time_minutes: i32,
    pub buffer_minutes: i32,
    pub default_duration_minutes: i32,
}

pub async fn update_agenda_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<AgendaSettingsInput>,
) -> Result<Json<AgendaSettingsDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: AgendaSettingsDto = sqlx::query_as(
        "UPDATE eletronicos.agenda_settings SET appointment_ai_enabled = $2, \
         lead_time_minutes = $3, buffer_minutes = $4, default_duration_minutes = $5 \
         WHERE tenant_id = $1 \
         RETURNING appointment_ai_enabled, default_duration_minutes, lead_time_minutes, \
         max_advance_days, buffer_minutes",
    )
    .bind(&claims.tenant_id)
    .bind(input.appointment_ai_enabled)
    .bind(input.lead_time_minutes)
    .bind(input.buffer_minutes)
    .bind(input.default_duration_minutes)
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

#[derive(Debug, Deserialize)]
pub struct BusinessHoursInput {
    pub blocks: Vec<BusinessHourBlockInput>,
}

#[derive(Debug, Deserialize)]
pub struct BusinessHourBlockInput {
    pub weekday: i32,
    pub open_time: String,
    pub close_time: String,
}

pub async fn update_business_hours(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<BusinessHoursInput>,
) -> Result<Json<Vec<BusinessHourDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query("DELETE FROM eletronicos.agenda_business_hours WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
    for block in &input.blocks {
        sqlx::query(
            "INSERT INTO eletronicos.agenda_business_hours (tenant_id, weekday, open_time, close_time) \
             VALUES ($1, $2, $3::time, $4::time)",
        )
        .bind(&claims.tenant_id)
        .bind(block.weekday)
        .bind(&block.open_time)
        .bind(&block.close_time)
        .execute(&mut *tx)
        .await?;
    }
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

const MIN_JUSTIFICATION_LENGTH: usize = 20;

fn fmt_store_dt(dt: DateTime<chrono::FixedOffset>) -> String {
    dt.format("%d/%m às %H:%M").to_string()
}

fn build_cancellation_message(customer_name: &str, service_label: &str, starts_at: DateTime<chrono::FixedOffset>, justification: &str) -> String {
    format!(
        "Olá, {customer_name}! Informamos que seu atendimento foi cancelado.\n\n\
         Serviço: {service_label}\nHorário original: {}\n\nMotivo: {}\n\n\
         Pedimos desculpas pelo transtorno. Se quiser, respondemos aqui mesmo pra encontrar um novo horário.",
        fmt_store_dt(starts_at),
        justification.trim()
    )
}

fn build_reschedule_message(
    customer_name: &str,
    service_label: &str,
    previous_starts_at: DateTime<chrono::FixedOffset>,
    new_starts_at: DateTime<chrono::FixedOffset>,
    justification: &str,
) -> String {
    format!(
        "Olá, {customer_name}! Precisamos alterar o horário do seu atendimento.\n\n\
         Serviço: {service_label}\nHorário anterior: {}\nNovo horário: {}\n\nMotivo: {}\n\n\
         Pedimos desculpas pelo transtorno. Se o novo horário não funcionar pra você, é só responder aqui que a gente encontra outro.",
        fmt_store_dt(previous_starts_at),
        fmt_store_dt(new_starts_at),
        justification.trim()
    )
}

#[derive(Debug, Deserialize)]
pub struct CancelAppointmentInput {
    pub justification: Option<String>,
    pub use_default_message: Option<bool>,
    pub custom_message: Option<String>,
}

pub async fn cancel_appointment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CancelAppointmentInput>,
) -> Result<Json<AppointmentDto>, AppError> {
    let justification = input.justification.clone().unwrap_or_default();
    if justification.trim().len() < MIN_JUSTIFICATION_LENGTH {
        return Err(AppError::BadRequest(format!(
            "justificativa precisa ter pelo menos {MIN_JUSTIFICATION_LENGTH} caracteres"
        )));
    }
    let use_default = input.use_default_message.unwrap_or(true);
    let custom = input.custom_message.clone().unwrap_or_default();
    if !use_default && custom.trim().len() < 10 {
        return Err(AppError::BadRequest("mensagem personalizada precisa ter pelo menos 10 caracteres".to_string()));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let before: Option<(String, String, DateTime<chrono::FixedOffset>)> = sqlx::query_as(
        "SELECT customer_name, service_label, starts_at FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND id = $2::uuid AND status = 'agendado'",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((customer_name, service_label, starts_at)) = before else {
        return Err(AppError::NotFound("agendamento não encontrado ou já não está mais ativo".to_string()));
    };

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
    .bind(justification.trim())
    .execute(&mut *tx)
    .await?;
    let row: AppointmentDto = sqlx::query_as(&format!(
        "SELECT {APPT_COLUMNS} FROM eletronicos.appointments WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    // Mensagem personalizada substitui o template inteiro, literal --
    // a justificativa (ou a mensagem customizada) nunca passa por
    // reescrita, mesma garantia do vrtech original.
    let tenant = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let text = if !use_default {
        custom.trim().to_string()
    } else {
        let mut vars = std::collections::HashMap::new();
        vars.insert("nome".to_string(), customer_name.clone());
        vars.insert("servico".to_string(), service_label.clone());
        vars.insert("motivo".to_string(), justification.trim().to_string());
        vars.insert("loja".to_string(), tenant.name.clone());
        vars.insert("endereco".to_string(), tenant.pickup_address.clone());
        render_whatsapp_template(&mut *tx, &claims.tenant_id, "appointment_cancelled", &vars)
            .await?
            .unwrap_or_else(|| build_cancellation_message(&customer_name, &service_label, starts_at, &justification))
    };
    let digits: String = row.customer_phone.chars().filter(char::is_ascii_digit).collect();
    crate::whatsapp::notify(&state, &tenant.whatsapp_instance, &digits, &text);

    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AppointmentEventDto {
    pub id: String,
    pub appointment_id: String,
    pub action: String,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub justification: Option<String>,
    pub previous_starts_at: Option<DateTime<chrono::FixedOffset>>,
    pub previous_ends_at: Option<DateTime<chrono::FixedOffset>>,
    pub new_starts_at: Option<DateTime<chrono::FixedOffset>>,
    pub new_ends_at: Option<DateTime<chrono::FixedOffset>>,
    pub created_at: DateTime<chrono::FixedOffset>,
}

/// Histórico de eventos do agendamento -- port do painel "Detalhes do
/// agendamento" (DetailDialog) real, que mostra a timeline completa.
pub async fn list_appointment_events(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<Vec<AppointmentEventDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<AppointmentEventDto> = sqlx::query_as(
        "SELECT id::text, appointment_id::text, action, actor_type, actor_id, justification, \
         previous_starts_at, previous_ends_at, new_starts_at, new_ends_at, created_at \
         FROM eletronicos.appointment_events WHERE tenant_id = $1 AND appointment_id = $2::uuid \
         ORDER BY created_at",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct RescheduleAppointmentInput {
    pub data: String,
    pub horario: String,
    pub justification: String,
    pub use_default_message: Option<bool>,
    pub custom_message: Option<String>,
    pub duration_minutes: Option<i32>,
}

pub async fn reschedule_appointment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<RescheduleAppointmentInput>,
) -> Result<Json<AppointmentDto>, AppError> {
    if input.justification.trim().len() < MIN_JUSTIFICATION_LENGTH {
        return Err(AppError::BadRequest(format!(
            "justificativa precisa ter pelo menos {MIN_JUSTIFICATION_LENGTH} caracteres"
        )));
    }
    let use_default = input.use_default_message.unwrap_or(true);
    let custom = input.custom_message.clone().unwrap_or_default();
    if !use_default && custom.trim().len() < 10 {
        return Err(AppError::BadRequest("mensagem personalizada precisa ter pelo menos 10 caracteres".to_string()));
    }
    let naive_date = parse_date_time(&input.data, &input.horario)?;
    let naive_time = NaiveTime::parse_from_str(&input.horario, "%H:%M").unwrap();
    let naive_dt = naive_date.and_time(naive_time);

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let before: Option<(String, String, String, DateTime<chrono::FixedOffset>, DateTime<chrono::FixedOffset>)> = sqlx::query_as(
        "SELECT customer_name, service_label, customer_phone, starts_at, ends_at FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND id = $2::uuid AND status = 'agendado'",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((customer_name, service_label, customer_phone, prev_starts_at, prev_ends_at)) = before else {
        return Err(AppError::NotFound("agendamento não encontrado ou já não está mais ativo".to_string()));
    };

    let settings: AgendaSettingsDto = sqlx::query_as(
        "SELECT appointment_ai_enabled, default_duration_minutes, lead_time_minutes, \
         max_advance_days, buffer_minutes FROM eletronicos.agenda_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    let duration = input
        .duration_minutes
        .unwrap_or_else(|| (prev_ends_at - prev_starts_at).num_minutes() as i32);
    if duration <= 0 {
        return Err(AppError::BadRequest("duração precisa ser maior que zero".to_string()));
    }

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
        "SELECT open_time, close_time FROM eletronicos.agenda_business_hours WHERE tenant_id = $1 AND weekday = $2",
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
        return Err(AppError::BadRequest(format!("fora do horário de funcionamento ({open_time}-{close_time})")));
    }

    let buffer = ChronoDuration::minutes(settings.buffer_minutes as i64);
    let window_start = starts_at - buffer;
    let window_end = ends_at + buffer;

    // Exclui o próprio agendamento do conflito -- ele está se movendo, não
    // colidindo consigo mesmo no horário antigo.
    let conflict: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND status = 'agendado' AND id <> $4::uuid \
           AND starts_at < $3 AND ends_at > $2 LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(window_start)
    .bind(window_end)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    if conflict.is_some() {
        return Err(AppError::BadRequest(
            "esse horário já está ocupado por outro agendamento (respeitando o intervalo mínimo entre atendimentos)".to_string(),
        ));
    }
    let blocked: Option<(String,)> = sqlx::query_as(
        "SELECT id::text FROM eletronicos.agenda_blocks WHERE tenant_id = $1 AND starts_at < $3 AND ends_at > $2 LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(window_start)
    .bind(window_end)
    .fetch_optional(&mut *tx)
    .await?;
    if blocked.is_some() {
        return Err(AppError::BadRequest("esse horário está bloqueado pela loja".to_string()));
    }

    sqlx::query(
        "UPDATE eletronicos.appointments SET starts_at = $3, ends_at = $4, status = 'remarcado', updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(starts_at)
    .bind(ends_at)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO eletronicos.appointment_events \
         (id, tenant_id, appointment_id, action, actor_type, justification, previous_starts_at, previous_ends_at, new_starts_at, new_ends_at) \
         VALUES ($1::uuid, $2, $3::uuid, 'rescheduled', 'admin', $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.justification.trim())
    .bind(prev_starts_at)
    .bind(prev_ends_at)
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

    let tenant = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let text = if !use_default {
        custom.trim().to_string()
    } else {
        let mut vars = std::collections::HashMap::new();
        vars.insert("nome".to_string(), customer_name.clone());
        vars.insert("servico".to_string(), service_label.clone());
        vars.insert("data_hora".to_string(), fmt_store_dt(starts_at));
        vars.insert("horario_anterior".to_string(), fmt_store_dt(prev_starts_at));
        vars.insert("motivo".to_string(), input.justification.trim().to_string());
        vars.insert("loja".to_string(), tenant.name.clone());
        vars.insert("endereco".to_string(), tenant.pickup_address.clone());
        render_whatsapp_template(&mut *tx, &claims.tenant_id, "appointment_rescheduled", &vars)
            .await?
            .unwrap_or_else(|| build_reschedule_message(&customer_name, &service_label, prev_starts_at, starts_at, &input.justification))
    };
    let digits: String = customer_phone.chars().filter(char::is_ascii_digit).collect();
    crate::whatsapp::notify(&state, &tenant.whatsapp_instance, &digits, &text);

    tx.commit().await?;
    Ok(Json(row))
}

pub async fn complete_appointment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<AppointmentDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.appointments SET status = 'concluido', updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid AND status IN ('agendado','remarcado')",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("agendamento não encontrado ou já não está mais ativo".to_string()));
    }
    sqlx::query(
        "INSERT INTO eletronicos.appointment_events (id, tenant_id, appointment_id, action, actor_type) \
         VALUES ($1::uuid, $2, $3::uuid, 'completed', 'admin')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
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
// Grade de disponibilidade do dia + bloqueios -- port de agenda/slots.ts +
// agenda_blocks do vrtech.
// ============================================================================

#[derive(Debug, Serialize)]
pub struct DaySlotDto {
    pub starts_at: String,
    pub ends_at: String,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DayQuery {
    pub date: String,
}

pub async fn get_agenda_day(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<DayQuery>,
) -> Result<Json<Vec<DaySlotDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let naive_date = NaiveDate::parse_from_str(&q.date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("data inválida, use AAAA-MM-DD".to_string()))?;

    let settings: AgendaSettingsDto = sqlx::query_as(
        "SELECT appointment_ai_enabled, default_duration_minutes, lead_time_minutes, \
         max_advance_days, buffer_minutes FROM eletronicos.agenda_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;

    let brasilia = chrono::FixedOffset::west_opt(3 * 3600).expect("offset válido");
    let weekday_num = match naive_date.weekday() {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    };
    let hours: Option<(NaiveTime, NaiveTime)> = sqlx::query_as(
        "SELECT open_time, close_time FROM eletronicos.agenda_business_hours WHERE tenant_id = $1 AND weekday = $2",
    )
    .bind(&claims.tenant_id)
    .bind(weekday_num)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((open_time, close_time)) = hours else {
        tx.commit().await?;
        return Ok(Json(vec![]));
    };

    let duration = ChronoDuration::minutes(settings.default_duration_minutes as i64);
    let step = ChronoDuration::minutes(15);
    let buffer = ChronoDuration::minutes(settings.buffer_minutes as i64);
    let now = Utc::now().with_timezone(&brasilia);
    let lead = ChronoDuration::minutes(settings.lead_time_minutes as i64);

    let day_start = brasilia.from_local_datetime(&naive_date.and_time(open_time)).single().unwrap();
    let day_end = brasilia.from_local_datetime(&naive_date.and_time(close_time)).single().unwrap();

    let appts: Vec<(DateTime<chrono::FixedOffset>, DateTime<chrono::FixedOffset>)> = sqlx::query_as(
        "SELECT starts_at, ends_at FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND status IN ('agendado','remarcado') AND starts_at < $3 AND ends_at > $2",
    )
    .bind(&claims.tenant_id)
    .bind(day_start)
    .bind(day_end)
    .fetch_all(&mut *tx)
    .await?;
    let blocks: Vec<(DateTime<chrono::FixedOffset>, DateTime<chrono::FixedOffset>)> = sqlx::query_as(
        "SELECT starts_at, ends_at FROM eletronicos.agenda_blocks \
         WHERE tenant_id = $1 AND starts_at < $3 AND ends_at > $2",
    )
    .bind(&claims.tenant_id)
    .bind(day_start)
    .bind(day_end)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let mut slots = Vec::new();
    let mut cursor = day_start;
    while cursor + duration <= day_end {
        let slot_end = cursor + duration;
        let window_start = cursor - buffer;
        let window_end = slot_end + buffer;
        let reason = if cursor < now + lead {
            Some("muito_em_cima")
        } else if blocks.iter().any(|(s, e)| *s < window_end && *e > window_start) {
            Some("bloqueado")
        } else if appts.iter().any(|(s, e)| *s < window_end && *e > window_start) {
            Some("ocupado")
        } else {
            None
        };
        slots.push(DaySlotDto {
            starts_at: cursor.to_rfc3339(),
            ends_at: slot_end.to_rfc3339(),
            available: reason.is_none(),
            reason: reason.map(str::to_string),
        });
        cursor += step;
    }

    Ok(Json(slots))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AgendaBlockDto {
    pub id: String,
    pub starts_at: String,
    pub ends_at: String,
    pub reason: Option<String>,
}

const BLOCK_COLUMNS: &str = "id::text, starts_at::text, ends_at::text, reason";

pub async fn list_agenda_blocks(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<DayQuery>,
) -> Result<Json<Vec<AgendaBlockDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let naive_date = NaiveDate::parse_from_str(&q.date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("data inválida, use AAAA-MM-DD".to_string()))?;
    let brasilia = chrono::FixedOffset::west_opt(3 * 3600).expect("offset válido");
    let day_start = brasilia.from_local_datetime(&naive_date.and_hms_opt(0, 0, 0).unwrap()).single().unwrap();
    let day_end = day_start + ChronoDuration::days(1);
    let rows: Vec<AgendaBlockDto> = sqlx::query_as(&format!(
        "SELECT {BLOCK_COLUMNS} FROM eletronicos.agenda_blocks \
         WHERE tenant_id = $1 AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at"
    ))
    .bind(&claims.tenant_id)
    .bind(day_start)
    .bind(day_end)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateAgendaBlockInput {
    pub data: String,
    pub hora_inicio: String,
    pub hora_fim: String,
    pub motivo: String,
}

pub async fn create_agenda_block(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateAgendaBlockInput>,
) -> Result<Json<AgendaBlockDto>, AppError> {
    if input.motivo.trim().len() < 10 {
        return Err(AppError::BadRequest("motivo precisa ter pelo menos 10 caracteres".to_string()));
    }
    let naive_date = NaiveDate::parse_from_str(&input.data, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("data inválida, use AAAA-MM-DD".to_string()))?;
    let start_time = NaiveTime::parse_from_str(&input.hora_inicio, "%H:%M")
        .map_err(|_| AppError::BadRequest("horário de início inválido".to_string()))?;
    let end_time = NaiveTime::parse_from_str(&input.hora_fim, "%H:%M")
        .map_err(|_| AppError::BadRequest("horário de fim inválido".to_string()))?;
    if end_time <= start_time {
        return Err(AppError::BadRequest("horário de fim precisa ser depois do início".to_string()));
    }
    let brasilia = chrono::FixedOffset::west_opt(3 * 3600).expect("offset válido");
    let starts_at = brasilia.from_local_datetime(&naive_date.and_time(start_time)).single().unwrap();
    let ends_at = brasilia.from_local_datetime(&naive_date.and_time(end_time)).single().unwrap();

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO eletronicos.agenda_blocks (id, tenant_id, starts_at, ends_at, reason, created_by) \
         VALUES ($1::uuid, $2, $3, $4, $5, 'admin')",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(starts_at)
    .bind(ends_at)
    .bind(input.motivo.trim())
    .execute(&mut *tx)
    .await?;
    let row: AgendaBlockDto = sqlx::query_as(&format!(
        "SELECT {BLOCK_COLUMNS} FROM eletronicos.agenda_blocks WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn delete_agenda_block(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let deleted = sqlx::query("DELETE FROM eletronicos.agenda_blocks WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("bloqueio não encontrado".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
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
    /// 'manual' (padrão) = `price` é o custo de 1 unidade, edição direta.
    /// 'erp_formulation' = insumo cadastrado em lote (ex: 100g por R$100,
    /// custo por unidade de medida = price/quantity) -- usado quando um
    /// serviço declara consumo parcial dele (`service_catalog_item_parts.
    /// unit`), custo do serviço vem da conversão, nunca editável direto.
    pub origin_type: String,
}

const STOCK_COLUMNS: &str = "id::text, name, unit, quantity::float8, price::float8, warranty_days, \
     units_per_box::float8, low_stock_threshold::float8, origin_type";

/// Família de unidade de medida -- só converte dentro da mesma família
/// (massa: g/kg; volume: ml/l; comprimento: cm/m). Discretas (unidade,
/// caixa, par, pacote, rolo) cada uma é a própria família, sem conversão
/// possível entre si -- errado por design (proibido cadastrar em metros e
/// completar em gramas, por exemplo).
fn unit_family(unit: &str) -> Result<(&'static str, f64), AppError> {
    match unit {
        "g" => Ok(("massa", 1.0)),
        "kg" => Ok(("massa", 1000.0)),
        "ml" => Ok(("volume", 1.0)),
        "l" => Ok(("volume", 1000.0)),
        "cm" => Ok(("comprimento", 1.0)),
        "m" => Ok(("comprimento", 100.0)),
        "unidade" => Ok(("unidade", 1.0)),
        "caixa" => Ok(("caixa", 1.0)),
        "par" => Ok(("par", 1.0)),
        "pacote" => Ok(("pacote", 1.0)),
        "rolo" => Ok(("rolo", 1.0)),
        other => Err(AppError::BadRequest(format!("unidade de medida inválida: {other}"))),
    }
}

/// Converte `qty` de `from` pra `to` -- erro claro se as unidades não são
/// da mesma família (nunca trunca/adivinha silenciosamente).
fn convert_stock_unit(qty: f64, from: &str, to: &str) -> Result<f64, AppError> {
    let (from_family, from_factor) = unit_family(from)?;
    let (to_family, to_factor) = unit_family(to)?;
    if from_family != to_family {
        return Err(AppError::BadRequest(format!(
            "unidade incompatível: \"{from}\" não é conversível pra \"{to}\""
        )));
    }
    Ok(qty * from_factor / to_factor)
}

/// Grava um evento no feed de atividade de estoque (visto em Relatórios) --
/// best-effort, nunca deixa a ação principal falhar por causa do log.
/// Port de src/lib/stockActivityLog.ts::logStockEvent.
async fn log_stock_event(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    entity_type: &str,
    entity_id: &str,
    entity_name: &str,
    event_type: &str,
) -> Result<(), sqlx::Error> {
    // entity_id é `uuid` na tabela (não text) -- BUG REAL achado pelo Paulo
    // Ferro: sem o cast ::uuid aqui, o bind de string falha silenciosamente
    // e ABORTA a transação inteira no Postgres; como o erro era descartado
    // (`let _ =`) e log_stock_event roda ANTES do tx.commit(), o commit()
    // numa transação já abortada faz um ROLLBACK implícito e retorna OK pro
    // Rust -- o handler respondia 200 com dado que nunca foi de fato salvo
    // (create/update/delete/entrada/saída de estoque inteiros perdidos em
    // silêncio). Agora propaga o erro (nunca mais silencioso) E corrige o
    // cast (nunca mais deveria falhar em operação normal).
    sqlx::query(
        "INSERT INTO eletronicos.stock_activity_log (tenant_id, entity_type, entity_id, entity_name, event_type) \
         VALUES ($1, $2, $3::uuid, $4, $5)",
    )
    .bind(tenant_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(entity_name)
    .bind(event_type)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Compara quantidade anterior/nova contra o threshold e retorna o evento de
/// transição (se houver) -- só loga low_stock/out_of_stock quando o item
/// CRUZA o limiar. Port de stockActivityLog.ts::stockTransitionEvent.
fn stock_transition_event(prev_quantity: f64, next_quantity: f64, threshold: Option<f64>) -> Option<&'static str> {
    let was_out = prev_quantity <= 0.0;
    let is_out = next_quantity <= 0.0;
    if is_out && !was_out {
        return Some("out_of_stock");
    }
    if let Some(threshold) = threshold {
        let was_low = prev_quantity > 0.0 && prev_quantity <= threshold;
        let is_low = next_quantity > 0.0 && next_quantity <= threshold;
        if is_low && !was_low {
            return Some("low_stock");
        }
    }
    None
}

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
    #[serde(default)]
    pub origin_type: Option<String>,
}

pub async fn create_stock_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateStockItemInput>,
) -> Result<Json<StockItemDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let origin_type = input.origin_type.as_deref().unwrap_or("manual");
    if origin_type != "manual" && origin_type != "erp_formulation" {
        return Err(AppError::BadRequest("origin_type inválido".to_string()));
    }
    let id = Uuid::new_v4().to_string();
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.stock_items \
         (id, tenant_id, name, unit, quantity, price, warranty_days, units_per_box, low_stock_threshold, origin_type) \
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
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
    .bind(origin_type)
    .execute(&mut *tx)
    .await?;
    let row: StockItemDto = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, "created").await?;
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
    let before: Option<StockItemDto> = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(before) = before else {
        return Err(AppError::NotFound("item de estoque não encontrado".to_string()));
    };
    // Achado pelo Paulo Ferro (teste de race): NÃO fazer UPDATE direto de
    // quantity aqui -- eletronicos.stock_movements tem o trigger
    // trg_elt_apply_stock_movement, que já aplica o delta em stock_items
    // sozinho a cada INSERT. Fazer os dois (UPDATE direto + INSERT que
    // dispara o trigger) contava a entrada/saída EM DOBRO (bug real: pedir
    // +1 virava +2 na quantidade).
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
    log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, "stock_updated").await?;
    if let Some(evt) = stock_transition_event(before.quantity, row.quantity, row.low_stock_threshold) {
        log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, evt).await?;
    }
    tx.commit().await?;
    Ok(Json(row))
}

/// Edicao completa do item (nome/quantidade/unidade/custo/garantia/
/// alerta) -- port de EstoqueTab.tsx::handleSaveEdit. Diferente de
/// stock_entry (so soma), aqui o valor final e definido diretamente.
pub async fn update_stock_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CreateStockItemInput>,
) -> Result<Json<StockItemDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let before: Option<StockItemDto> = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(before) = before else {
        return Err(AppError::NotFound("item de estoque não encontrado".to_string()));
    };
    sqlx::query(
        "UPDATE eletronicos.stock_items SET name = $3, unit = $4, quantity = $5, price = $6, \
         warranty_days = $7, units_per_box = $8, low_stock_threshold = $9, updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
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
    log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, "updated").await?;
    if let Some(evt) = stock_transition_event(before.quantity, row.quantity, row.low_stock_threshold) {
        log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, evt).await?;
    }
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn delete_stock_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let existing: Option<(String,)> = sqlx::query_as("SELECT name FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((name,)) = existing else {
        return Err(AppError::NotFound("item de estoque não encontrado".to_string()));
    };
    sqlx::query("DELETE FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &name, "deleted").await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Saída manual de estoque (uso/perda fora de uma venda/OS) -- port de
/// EstoqueTab.tsx::handleRegisterExit. Nunca deixa a quantidade negativa.
pub async fn stock_exit(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<StockEntryInput>,
) -> Result<Json<StockItemDto>, AppError> {
    if input.quantity <= 0.0 {
        return Err(AppError::BadRequest("quantidade precisa ser maior que zero".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let before: Option<StockItemDto> = sqlx::query_as(&format!(
        "SELECT {STOCK_COLUMNS} FROM eletronicos.stock_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(before) = before else {
        return Err(AppError::NotFound("item de estoque não encontrado".to_string()));
    };
    if input.quantity > before.quantity {
        return Err(AppError::BadRequest("quantidade maior que o estoque disponível".to_string()));
    }
    // Mesmo bug de stock_entry (achado pelo Paulo Ferro): não fazer UPDATE
    // direto aqui -- o trigger trg_elt_apply_stock_movement já aplica o
    // delta a partir do INSERT em stock_movements. UPDATE direto + trigger
    // juntos descontava a saída em dobro.
    sqlx::query(
        "INSERT INTO eletronicos.stock_movements (id, tenant_id, item_id, type, quantity, unit) \
         SELECT $1::uuid, $2, $3::uuid, 'saida', $4, unit FROM eletronicos.stock_items WHERE tenant_id = $2 AND id = $3::uuid",
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
    log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, "stock_updated").await?;
    if let Some(evt) = stock_transition_event(before.quantity, row.quantity, row.low_stock_threshold) {
        log_stock_event(&mut tx, &claims.tenant_id, "stock_item", &id, &row.name, evt).await?;
    }
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StockActivityLogDto {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub entity_name: String,
    pub event_type: String,
    pub created_at: String,
}

pub async fn list_stock_activity_log(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<StockActivityLogDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<StockActivityLogDto> = sqlx::query_as(
        "SELECT id::text, entity_type, entity_id::text, entity_name, event_type, created_at::text \
         FROM eletronicos.stock_activity_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ErrorLogDto {
    pub id: String,
    pub source: String,
    pub level: String,
    pub message: String,
    pub route: Option<String>,
    pub resolved: bool,
    pub created_at: String,
}

pub async fn list_error_log(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<ErrorLogDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ErrorLogDto> = sqlx::query_as(
        "SELECT id::text, source, level, message, route, resolved, created_at::text \
         FROM eletronicos.error_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct ClientErrorInput {
    pub message: String,
    pub route: Option<String>,
}

/// Captura de erro JS não tratado no painel eletrônica (source='client') --
/// port parcial de logError() do vrtech. Fontes 'middleware'/'api'/'webhook'
/// exigiriam um hook de erro central em todo o backend da plataforma
/// (fora do escopo desta vertical) -- tabela já preparada pra isso depois.
pub async fn report_client_error(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<ClientErrorInput>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO eletronicos.error_log (tenant_id, source, message, route) VALUES ($1, 'client', $2, $3)",
    )
    .bind(&claims.tenant_id)
    .bind(&input.message)
    .bind(&input.route)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn resolve_error_log(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.error_log SET resolved = true WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("erro não encontrado".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StockMovementDto {
    pub id: String,
    pub item_id: String,
    pub item_name: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub quantity: f64,
    pub unit: String,
    pub moved_at: String,
}

/// Últimas movimentações (entrada/saída) -- port da lista no fim de
/// EstoqueTab.tsx real.
pub async fn list_stock_movements(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<StockMovementDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<StockMovementDto> = sqlx::query_as(
        "SELECT m.id::text, m.item_id::text, s.name AS item_name, m.type, m.quantity::float8, m.unit, m.moved_at::text \
         FROM eletronicos.stock_movements m \
         LEFT JOIN eletronicos.stock_items s ON s.id = m.item_id AND s.tenant_id = m.tenant_id \
         WHERE m.tenant_id = $1 ORDER BY m.moved_at DESC LIMIT 50",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
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

/// Cancela uma venda ainda aberta (sem pagamento confirmado) -- devolve
/// eventuais itens de estoque decrementados na hora (peças avulsas).
pub async fn cancel_pdv_sale(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let sale: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM eletronicos.pdv_sales WHERE tenant_id = $1 AND id = $2::uuid AND status = 'aberta'",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    if sale.is_none() {
        return Err(AppError::NotFound("venda não encontrada ou já concluída".to_string()));
    }
    let deducted: Vec<(String, f64)> = sqlx::query_as(
        "SELECT stock_item_id::text, quantity::float8 FROM eletronicos.pdv_sale_items \
         WHERE tenant_id = $1 AND sale_id = $2::uuid AND stock_deducted = true AND stock_item_id IS NOT NULL",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_all(&mut *tx)
    .await
    .unwrap_or_default();
    for (stock_item_id, qty) in deducted {
        sqlx::query("UPDATE eletronicos.stock_items SET quantity = quantity + $3, updated_at = now() WHERE tenant_id = $1 AND id = $2::uuid")
            .bind(&claims.tenant_id)
            .bind(&stock_item_id)
            .bind(qty)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE eletronicos.pdv_sales SET status = 'cancelada' WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
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

/// Únicas chaves que fazem sentido fora do ramo eletrônica -- eletrônica tem
/// `status_*` (diagnóstico/aparelho/garantia, amarrado a `service_requests`,
/// que só existe nessa vertical) e outras seções (entrega e coleta, PDV,
/// solicitação de serviço) que também são conceitos exclusivos daquele
/// fluxo. Ecommerce genérico só tem agendamento de serviço na vitrine.
const ECOMMERCE_TEMPLATE_KEYS: [&str; 2] = ["appointment_cancelled", "appointment_rescheduled"];

pub async fn list_whatsapp_templates(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<WhatsappTemplateDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let vertical: Option<(Option<String>,)> =
        sqlx::query_as("SELECT vertical FROM tenants WHERE id = $1")
            .bind(&claims.tenant_id)
            .fetch_optional(&mut *tx)
            .await?;
    let is_eletronicos = matches!(vertical, Some((Some(v),)) if v == "eletronicos");
    if !is_eletronicos {
        // Tenant do ramo genérico não usa o catálogo cheio de eletrônica
        // (diagnóstico/aparelho/garantia não existem aqui) -- limpa
        // qualquer linha fora do escopo de agendamento (pode ter sobrado de
        // um seed antigo/errado) e garante só os templates de agendamento,
        // com copy genérica referenciando a loja, não um domínio fixo.
        sqlx::query(
            "DELETE FROM eletronicos.whatsapp_templates \
             WHERE tenant_id = $1 AND template_key != ALL($2)",
        )
        .bind(&claims.tenant_id)
        .bind(&ECOMMERCE_TEMPLATE_KEYS[..])
        .execute(&mut *tx)
        .await?;
        // As 2 linhas de agendamento sobrevivem ao DELETE acima mesmo se o
        // conteúdo ainda vier do seed antigo de eletrônica (ex: menciona
        // "vrtech" hardcoded) -- reseta pra copy genérica quando isso
        // acontece, mesmo texto/variáveis do INSERT abaixo.
        sqlx::query(
            "UPDATE eletronicos.whatsapp_templates SET \
             content = 'Olá /nome, seu agendamento de /servico na /loja foi cancelado. Motivo: /motivo', \
             required_variables = ARRAY['nome','servico','motivo','loja'], \
             available_variables = ARRAY['nome','servico','motivo','loja','endereco'] \
             WHERE tenant_id = $1 AND template_key = 'appointment_cancelled' AND content ILIKE '%vrtech%'",
        )
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE eletronicos.whatsapp_templates SET \
             content = 'Olá /nome, seu agendamento na /loja foi remarcado de /horario_anterior para /data_hora. Motivo: /motivo', \
             required_variables = ARRAY['nome','data_hora','horario_anterior','motivo','loja'], \
             available_variables = ARRAY['nome','data_hora','horario_anterior','motivo','loja','endereco'] \
             WHERE tenant_id = $1 AND template_key = 'appointment_rescheduled' AND content ILIKE '%vrtech%'",
        )
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        // INSERT isolado na própria transação curta (mesmo motivo de
        // `seed_idempotent`): a página pode disparar chamadas concorrentes,
        // e um unique_violation aqui não pode abortar a transação de leitura
        // que vem a seguir.
        seed_idempotent(
            &state.pool,
            &claims.tenant_id,
            "INSERT INTO eletronicos.whatsapp_templates \
             (id, tenant_id, template_key, section, label, description, content, required_variables, available_variables, editable, enabled, sort_order) \
             VALUES \
             (gen_random_uuid(), $1, 'appointment_cancelled', 'agendamento', 'Agendamento cancelado', \
              'Enviado ao cliente quando um agendamento é cancelado pelo lojista.', \
              'Olá /nome, seu agendamento de /servico na /loja foi cancelado. Motivo: /motivo', \
              ARRAY['nome','servico','motivo','loja'], ARRAY['nome','servico','motivo','loja','endereco'], true, true, 1), \
             (gen_random_uuid(), $1, 'appointment_rescheduled', 'agendamento', 'Agendamento remarcado', \
              'Enviado ao cliente quando um agendamento é remarcado pelo lojista.', \
              'Olá /nome, seu agendamento na /loja foi remarcado de /horario_anterior para /data_hora. Motivo: /motivo', \
              ARRAY['nome','data_hora','horario_anterior','motivo','loja'], ARRAY['nome','data_hora','horario_anterior','motivo','loja','endereco'], true, true, 2) \
             ON CONFLICT (tenant_id, template_key) DO NOTHING",
        )
        .await?;
        tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    }
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

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConsultarDiagnosticDto {
    pub pdf_url: Option<String>,
    pub finalized: bool,
}

#[derive(Debug, Serialize)]
pub struct ConsultarServiceRequestDto {
    #[serde(flatten)]
    pub request: ServiceRequestDto,
    pub service_order: Option<ServiceOrderDto>,
    pub diagnostic: Option<ConsultarDiagnosticDto>,
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

async fn fetch_unified_by_phone(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    digits: &str,
) -> Result<ConsultarResponse, AppError> {
    // customer_phone é gravado como o cliente digitou/o formulário mandou --
    // às vezes com formatação "(83) 98751-6699", às vezes só dígitos. A
    // busca sempre normaliza os dois lados (regexp_replace tira tudo que
    // não é dígito) pra nunca depender de como aquele registro específico
    // foi salvo -- achado real testando o gate de OTP em produção: a busca
    // exata contra a coluna crua nunca batia pra telefone com formatação.
    let requests: Vec<ServiceRequestDto> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests \
         WHERE tenant_id = $1 AND regexp_replace(customer_phone, '\\D', '', 'g') = $2 AND status <> 'cancelled' \
         ORDER BY created_at DESC LIMIT 10"
    ))
    .bind(tenant_id)
    .bind(digits)
    .fetch_all(&mut *tx)
    .await?;

    let mut out = Vec::with_capacity(requests.len());
    for request in requests {
        let service_order: Option<ServiceOrderDto> = sqlx::query_as(&format!(
            "SELECT {SO_COLUMNS} FROM eletronicos.service_orders WHERE tenant_id = $1 AND request_id = $2::uuid"
        ))
        .bind(tenant_id)
        .bind(&request.id)
        .fetch_optional(&mut *tx)
        .await?;
        let diagnostic: Option<ConsultarDiagnosticDto> = sqlx::query_as(
            "SELECT pdf_url, finalized FROM eletronicos.service_diagnostics WHERE tenant_id = $1 AND service_request_id = $2::uuid",
        )
        .bind(tenant_id)
        .bind(&request.id)
        .fetch_optional(&mut *tx)
        .await?;
        out.push(ConsultarServiceRequestDto { request, service_order, diagnostic });
    }

    let appointments: Vec<AppointmentDto> = sqlx::query_as(&format!(
        "SELECT {APPT_COLUMNS} FROM eletronicos.appointments \
         WHERE tenant_id = $1 AND regexp_replace(customer_phone, '\\D', '', 'g') = $2 AND status = 'agendado' \
         ORDER BY starts_at ASC"
    ))
    .bind(tenant_id)
    .bind(digits)
    .fetch_all(&mut *tx)
    .await?;

    Ok(ConsultarResponse { requests: out, appointments })
}

fn has_any_attendance(r: &ConsultarResponse) -> bool {
    !r.requests.is_empty() || !r.appointments.is_empty()
}

#[derive(Debug, Deserialize)]
pub struct OtpCheckInput {
    pub phone: String,
    #[serde(default)]
    pub send: bool,
}

#[derive(Debug, Serialize)]
pub struct OtpCheckResponse {
    pub found: bool,
    pub sent: bool,
}

/// `send=false`: só confere se existe atendimento pra esse telefone (não
/// gera/manda código -- evita spam de WhatsApp a cada dígito digitado).
/// `send=true`: gera um código de 3 dígitos novo (invalida os anteriores),
/// manda por WhatsApp. Nunca retorna o código na resposta HTTP.
pub async fn consultar_otp_check(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<OtpCheckInput>,
) -> Result<Json<OtpCheckResponse>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let digits = digits_only(&input.phone);
    if digits.len() < 8 {
        return Err(AppError::BadRequest("telefone inválido".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let unified = fetch_unified_by_phone(&mut tx, &store.id, &digits).await?;
    if !has_any_attendance(&unified) {
        tx.commit().await?;
        return Ok(Json(OtpCheckResponse { found: false, sent: false }));
    }
    if !input.send {
        tx.commit().await?;
        return Ok(Json(OtpCheckResponse { found: true, sent: false }));
    }

    let code = format!("{:03}", rand::random::<u16>() % 1000);
    sqlx::query(
        "INSERT INTO eletronicos.consultation_otps (id, tenant_id, phone_digits, code, expires_at, max_attempts) \
         VALUES ($1::uuid, $2, $3, $4, now() + interval '10 minutes', 5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&store.id)
    .bind(&digits)
    .bind(&code)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let tenant = tenant::load_tenant(&state.pool, &store.id).await?;
    let text = format!("Seu código de acesso é *{code}*\n\nEle vale por 10 minutos.");
    crate::whatsapp::notify(&state, &tenant.whatsapp_instance, &digits, &text);

    Ok(Json(OtpCheckResponse { found: true, sent: true }))
}

#[derive(Debug, Deserialize)]
pub struct OtpVerifyInput {
    pub phone: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct OtpVerifyResponse {
    pub valid: bool,
    #[serde(flatten)]
    pub data: Option<ConsultarResponse>,
}

pub async fn consultar_otp_verify(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<OtpVerifyInput>,
) -> Result<Json<OtpVerifyResponse>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let digits = digits_only(&input.phone);
    if digits.len() < 8 || input.code.trim().is_empty() {
        return Err(AppError::BadRequest("telefone e código são obrigatórios".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;

    let row: Option<(String, String, i32, i32)> = sqlx::query_as(
        "SELECT id::text, code, attempts, max_attempts FROM eletronicos.consultation_otps \
         WHERE tenant_id = $1 AND phone_digits = $2 AND used_at IS NULL AND expires_at > now() \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&store.id)
    .bind(&digits)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((otp_id, real_code, attempts, max_attempts)) = row else {
        tx.commit().await?;
        return Ok(Json(OtpVerifyResponse { valid: false, data: None }));
    };
    if attempts >= max_attempts {
        tx.commit().await?;
        return Ok(Json(OtpVerifyResponse { valid: false, data: None }));
    }
    sqlx::query("UPDATE eletronicos.consultation_otps SET attempts = attempts + 1 WHERE id = $1::uuid")
        .bind(&otp_id)
        .execute(&mut *tx)
        .await?;

    if real_code != input.code.trim() {
        tx.commit().await?;
        return Ok(Json(OtpVerifyResponse { valid: false, data: None }));
    }
    sqlx::query("UPDATE eletronicos.consultation_otps SET used_at = now() WHERE id = $1::uuid")
        .bind(&otp_id)
        .execute(&mut *tx)
        .await?;

    let unified = fetch_unified_by_phone(&mut tx, &store.id, &digits).await?;
    tx.commit().await?;
    Ok(Json(OtpVerifyResponse { valid: true, data: Some(unified) }))
}

#[derive(Debug, Deserialize)]
pub struct ConsultarCancelInput {
    pub id: String,
    pub phone: String,
}

/// Cliente cancela a própria solicitação pela vitrine (só quando ainda
/// está "pending" -- port de ConsultarView.tsx::confirmCancel). Sem
/// login: o telefone precisa bater com o dono da solicitação, mesma
/// checagem de posse usada no restante do fluxo /consultar.
pub async fn consultar_cancel(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<ConsultarCancelInput>,
) -> Result<Json<ServiceRequestDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let digits = digits_only(&input.phone);
    if digits.len() < 8 {
        return Err(AppError::BadRequest("telefone inválido".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_requests SET status = 'cancelled' \
         WHERE tenant_id = $1 AND id = $2::uuid AND status = 'pending' \
           AND regexp_replace(customer_phone, '\\D', '', 'g') = $3",
    )
    .bind(&store.id)
    .bind(&input.id)
    .bind(&digits)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("solicitação não encontrada ou não pode mais ser cancelada".to_string()));
    }
    let row: ServiceRequestDto = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM eletronicos.service_requests WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&store.id)
    .bind(&input.id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize)]
pub struct MercadoPagoStatusDto {
    pub connected: bool,
    pub credenciais_mask: Option<String>,
}

/// Status (só leitura) da conexão Mercado Pago do tenant -- port da parte
/// visual de MercadoPagoSection.tsx. Conectar/desconectar (fluxo OAuth
/// completo) fica de fora por ora: a conta é vinculada pela sessão de
/// plataforma do Resolutoo (ufersin-api), que esse painel (login próprio
/// via ecommerce-api) não compartilha -- gap disclosed, não arriscar
/// mexer em credencial de pagamento sem essa ponte de sessão existir.
pub async fn get_mercadopago_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<MercadoPagoStatusDto>, AppError> {
    let payment = tenant::load_tenant_payment(&state.pool, &claims.tenant_id).await?;
    let token = payment.mp_access_token();
    let connected = token.is_some();
    let mask = token.map(|t| {
        let tail = if t.len() > 4 { &t[t.len() - 4..] } else { t };
        format!("•••• {tail}")
    });
    Ok(Json(MercadoPagoStatusDto { connected, credenciais_mask: mask }))
}

// ============================================================================
// Upload de mídia -- fase 4.9
//
// vrtech original fazia upload direto do browser pro Supabase Storage
// (confiando em RLS) -- aqui passa pelo backend, mesmo padrao de
// admin::upload_product_image (chave de servico nunca sai do servidor).
// Prefixo `eletronicos/<tenant_id>/` no mesmo bucket ja usado por produtos
// (`sunset-products`, ja existe e ja tem permissao publica configurada) --
// nao precisa de bucket novo.
// ============================================================================

const MAX_UPLOAD_BYTES: usize = 8 * 1024 * 1024;

async fn read_upload_field(
    multipart: &mut axum::extract::Multipart,
    allow_pdf: bool,
) -> Result<(String, Vec<u8>), AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("upload inválido: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let is_pdf = content_type == "application/pdf";
        if !content_type.starts_with("image/") && !content_type.starts_with("video/") && !(allow_pdf && is_pdf) {
            return Err(AppError::BadRequest(format!("tipo de arquivo não aceito: {content_type}")));
        }
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("upload inválido: {e}")))?;
        if bytes.len() > MAX_UPLOAD_BYTES {
            return Err(AppError::BadRequest("arquivo maior que 8MB".to_string()));
        }
        let ext = if is_pdf { "pdf" } else { crate::storage::extension_for(&content_type) };
        return Ok((format!("{content_type}\0{ext}"), bytes.to_vec()));
    }
    Err(AppError::BadRequest("campo 'file' ausente no upload".to_string()))
}

/// Vitrine pública -- foto do aparelho/problema anexada no formulário de
/// solicitação, sem login. Tenant resolvido pelo slug da URL.
pub async fn upload_public_media(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let (meta, bytes) = read_upload_field(&mut multipart, false).await?;
    let (content_type, ext) = meta.split_once('\0').expect("meta sempre tem separador");
    let filename = format!("eletronicos/{}/{}.{ext}", store.id, Uuid::new_v4());
    let url = crate::storage::upload_image(&state, &filename, content_type, bytes).await?;
    Ok(Json(serde_json::json!({ "url": url })))
}

/// Admin -- fotos de checklist/diagnóstico ou o PDF gerado da OS.
pub async fn upload_admin_media(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let (meta, bytes) = read_upload_field(&mut multipart, true).await?;
    let (content_type, ext) = meta.split_once('\0').expect("meta sempre tem separador");
    let filename = format!("eletronicos/{}/{}.{ext}", claims.tenant_id, Uuid::new_v4());
    let url = crate::storage::upload_image(&state, &filename, content_type, bytes).await?;
    Ok(Json(serde_json::json!({ "url": url })))
}

#[derive(Debug, Deserialize)]
pub struct SetServiceOrderPdfInput {
    pub pdf_url: String,
}

pub async fn set_service_order_pdf(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<SetServiceOrderPdfInput>,
) -> Result<Json<ServiceOrderDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_orders SET pdf_url = $3, updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&input.pdf_url)
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

// ============================================================================
// Catalogo de servicos (vitrine publica) -- fase 4.10
//
// Porta o wizard tipo->marca->modelo->servico do ServiceRequestForm.tsx do
// vrtech: categorias == "marcas" (cada uma amarrada a um device_type),
// itens == servicos de reparo (por modelo, ou universais quando
// model_name e' null). Publico/sem login, mesmo padrao dos outros
// endpoints da vitrine.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CatalogItemDto {
    pub id: String,
    pub category_id: String,
    pub model_name: Option<String>,
    pub repair_type: String,
    pub price: f64,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub tags: Vec<String>,
}

/// Categoria pro catálogo PÚBLICO -- diferente de AdminCatalogCategoryDto:
/// mantém `image_url` (banner decorativo atrás do nome da marca na vitrine
/// de serviços, ex. EletronicaCatalogoServico.tsx -- feature própria, já
/// com banners reais cadastrados). O que o audit pediu pra remover foi só
/// o campo de imagem do FORM DE CADASTRO DE MARCA no admin (substituído
/// por ícone da marca via BrandIcon) -- não essa vitrine pública.
#[derive(Debug, Serialize)]
pub struct PublicCatalogCategoryDto {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub sort_order: i32,
    pub device_type: String,
    pub device_types: Vec<String>,
    pub image_url: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct PublicCatalogCategoryDtoBase {
    id: String,
    name: String,
    slug: String,
    sort_order: i32,
    device_type: String,
    image_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CatalogResponse {
    pub categories: Vec<PublicCatalogCategoryDto>,
    pub items: Vec<CatalogItemDto>,
    /// Modelos "de verdade" (eletronicos.catalog_models -- cadastro real de
    /// Produtos/Serviços > Aparelho/Marca/Modelo), separado de
    /// service_catalog_items.model_name: esse campo em items nem sempre é
    /// um modelo (alguns itens usam pra guardar o próprio rótulo do
    /// serviço, ex. "Reparo de Flash Motorola") -- misturar os dois no
    /// step "Qual o modelo?" do form público mostrava serviço como se
    /// fosse modelo. `models` é a fonte única de verdade pra essa etapa.
    pub models: Vec<PublicCatalogModelDto>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PublicCatalogModelDto {
    pub id: String,
    pub brand_id: String,
    pub name: String,
}

pub async fn get_public_catalog(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<CatalogResponse>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;

    let category_base: Vec<PublicCatalogCategoryDtoBase> = sqlx::query_as(
        "SELECT id::text, name, slug, sort_order, device_type, image_url \
         FROM eletronicos.service_catalog_categories \
         WHERE tenant_id = $1 AND slug NOT LIKE 'servicos-%' ORDER BY sort_order",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;
    let cat_ids: Vec<String> = category_base.iter().map(|c| c.id.clone()).collect();
    let dt_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT category_id::text, device_type FROM eletronicos.category_device_types \
         WHERE tenant_id = $1 AND category_id = ANY($2::uuid[])",
    )
    .bind(&store.id)
    .bind(&cat_ids)
    .fetch_all(&mut *tx)
    .await?;
    let mut dt_by_cat: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (cid, dt) in dt_rows {
        dt_by_cat.entry(cid).or_default().push(dt);
    }
    let categories: Vec<PublicCatalogCategoryDto> = category_base
        .into_iter()
        .map(|c| {
            let device_types = dt_by_cat.remove(&c.id).unwrap_or_else(|| vec![c.device_type.clone()]);
            PublicCatalogCategoryDto {
                id: c.id,
                name: c.name,
                slug: c.slug,
                sort_order: c.sort_order,
                device_type: c.device_type,
                device_types,
                image_url: c.image_url,
            }
        })
        .collect();

    let items: Vec<CatalogItemDto> = sqlx::query_as(
        "SELECT id::text, category_id::text, model_name, repair_type, price::float8, description, image_url, \
                COALESCE(tags, '{}') AS tags \
         FROM eletronicos.service_catalog_items \
         WHERE tenant_id = $1 AND active = true ORDER BY sort_order",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;

    let models: Vec<PublicCatalogModelDto> = sqlx::query_as(
        "SELECT id::text, brand_id::text, name FROM eletronicos.catalog_models \
         WHERE tenant_id = $1 ORDER BY sort_order, name",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(CatalogResponse { categories, items, models }))
}

// ============================================================================
// Admin do catálogo de serviços (marca/aparelho + serviços por modelo) --
// port simplificado de ProdutosClient.tsx (Serviços + Aparelho·Marca·
// Modelo do vrtech). Gap disclosed: sem o vínculo multi-select
// aparelho/marca/modelo por serviço, sem peças-de-estoque como
// dependência de custo nem custos extras avulsos (service_catalog_
// item_parts/extra_costs não usados aqui) -- cada serviço pertence a
// UMA categoria (marca) só, custo é digitado direto.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminCatalogCategoryDto {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub sort_order: i32,
    pub device_type: String,
    /// Todos os tipos de aparelho que essa marca atende -- `device_type`
    /// acima é só o primeiro (compat). Ícone de marca resolvido no
    /// frontend (Simple Icons); sem campo de imagem, removido de propósito
    /// (achado de UX: imagem livre não fazia sentido pra marca conhecida).
    pub device_types: Vec<String>,
}

const ADMIN_CAT_COLUMNS: &str = "id::text, name, slug, sort_order, device_type";

async fn attach_category_device_types(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    rows: Vec<AdminCatalogCategoryDtoBase>,
) -> Result<Vec<AdminCatalogCategoryDto>, AppError> {
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let dt_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT category_id::text, device_type FROM eletronicos.category_device_types \
         WHERE tenant_id = $1 AND category_id = ANY($2::uuid[])",
    )
    .bind(tenant_id)
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let mut by_cat: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (cid, dt) in dt_rows {
        by_cat.entry(cid).or_default().push(dt);
    }
    Ok(rows
        .into_iter()
        .map(|r| {
            let device_types = by_cat.remove(&r.id).unwrap_or_else(|| vec![r.device_type.clone()]);
            AdminCatalogCategoryDto {
                id: r.id,
                name: r.name,
                slug: r.slug,
                sort_order: r.sort_order,
                device_type: r.device_type,
                device_types,
            }
        })
        .collect())
}

#[derive(Debug, sqlx::FromRow)]
struct AdminCatalogCategoryDtoBase {
    id: String,
    name: String,
    slug: String,
    sort_order: i32,
    device_type: String,
}

pub async fn list_admin_categories(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<AdminCatalogCategoryDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<AdminCatalogCategoryDtoBase> = sqlx::query_as(&format!(
        "SELECT {ADMIN_CAT_COLUMNS} FROM eletronicos.service_catalog_categories WHERE tenant_id = $1 ORDER BY sort_order"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let out = attach_category_device_types(&mut *tx, &claims.tenant_id, rows).await?;
    tx.commit().await?;
    Ok(Json(out))
}

fn slugify(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[derive(Debug, Deserialize)]
pub struct SaveCategoryInput {
    pub name: String,
    pub device_types: Vec<String>,
    pub sort_order: Option<i32>,
}

async fn replace_category_device_types(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    category_id: &str,
    device_types: &[String],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM eletronicos.category_device_types WHERE tenant_id = $1 AND category_id = $2::uuid")
        .bind(tenant_id)
        .bind(category_id)
        .execute(&mut *tx)
        .await?;
    for dt in device_types {
        sqlx::query(
            "INSERT INTO eletronicos.category_device_types (tenant_id, category_id, device_type) \
             VALUES ($1, $2::uuid, $3) ON CONFLICT (category_id, device_type) DO NOTHING",
        )
        .bind(tenant_id)
        .bind(category_id)
        .bind(dt.trim())
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

pub async fn create_admin_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<SaveCategoryInput>,
) -> Result<Json<AdminCatalogCategoryDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let device_types: Vec<String> = input.device_types.into_iter().map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).collect();
    if device_types.is_empty() {
        return Err(AppError::BadRequest("selecione ao menos um tipo de aparelho".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let slug = slugify(&input.name);
    sqlx::query(
        "INSERT INTO eletronicos.service_catalog_categories (id, tenant_id, name, slug, device_type, sort_order) \
         VALUES ($1::uuid, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(input.name.trim())
    .bind(&slug)
    .bind(&device_types[0])
    .bind(input.sort_order.unwrap_or(0))
    .execute(&mut *tx)
    .await?;
    replace_category_device_types(&mut *tx, &claims.tenant_id, &id, &device_types).await?;
    let base: AdminCatalogCategoryDtoBase = sqlx::query_as(&format!(
        "SELECT {ADMIN_CAT_COLUMNS} FROM eletronicos.service_catalog_categories WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    let row = attach_category_device_types(&mut *tx, &claims.tenant_id, vec![base]).await?.remove(0);
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn update_admin_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<SaveCategoryInput>,
) -> Result<Json<AdminCatalogCategoryDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let device_types: Vec<String> = input.device_types.into_iter().map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).collect();
    if device_types.is_empty() {
        return Err(AppError::BadRequest("selecione ao menos um tipo de aparelho".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_catalog_categories \
         SET name = $3, device_type = $4, sort_order = COALESCE($5, sort_order) \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.name.trim())
    .bind(&device_types[0])
    .bind(input.sort_order)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("categoria não encontrada".to_string()));
    }
    replace_category_device_types(&mut *tx, &claims.tenant_id, &id, &device_types).await?;
    let base: AdminCatalogCategoryDtoBase = sqlx::query_as(&format!(
        "SELECT {ADMIN_CAT_COLUMNS} FROM eletronicos.service_catalog_categories WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    let row = attach_category_device_types(&mut *tx, &claims.tenant_id, vec![base]).await?.remove(0);
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn delete_admin_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let deleted = sqlx::query("DELETE FROM eletronicos.service_catalog_categories WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("categoria não encontrada".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminCatalogItemDto {
    pub id: String,
    pub category_id: String,
    pub model_name: Option<String>,
    pub repair_type: String,
    pub price: f64,
    pub cost_price: f64,
    pub duration_minutes: i32,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub tags: Vec<String>,
    pub active: bool,
    pub sort_order: i32,
}

const ADMIN_ITEM_COLUMNS: &str = "id::text, category_id::text, model_name, repair_type, price::float8, \
    cost_price::float8, duration_minutes, description, image_url, COALESCE(tags, '{}') AS tags, active, sort_order";

pub async fn list_admin_catalog_items(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<AdminCatalogItemDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<AdminCatalogItemDto> = sqlx::query_as(&format!(
        "SELECT {ADMIN_ITEM_COLUMNS} FROM eletronicos.service_catalog_items WHERE tenant_id = $1 ORDER BY sort_order"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct SaveCatalogItemInput {
    pub category_id: String,
    pub model_name: Option<String>,
    pub repair_type: String,
    pub price: f64,
    pub cost_price: Option<f64>,
    pub duration_minutes: Option<i32>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub tags: Option<Vec<String>>,
    pub active: Option<bool>,
    pub sort_order: Option<i32>,
}

pub async fn create_admin_catalog_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<SaveCatalogItemInput>,
) -> Result<Json<AdminCatalogItemDto>, AppError> {
    if input.repair_type.trim().is_empty() {
        return Err(AppError::BadRequest("tipo de reparo é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO eletronicos.service_catalog_items \
           (id, tenant_id, category_id, model_name, repair_type, price, cost_price, duration_minutes, \
            description, image_url, tags, active, sort_order) \
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.category_id)
    .bind(input.model_name.as_deref())
    .bind(input.repair_type.trim())
    .bind(input.price)
    .bind(input.cost_price.unwrap_or(0.0))
    .bind(input.duration_minutes.unwrap_or(60))
    .bind(input.description.as_deref())
    .bind(input.image_url.as_deref())
    .bind(input.tags.unwrap_or_default())
    .bind(input.active.unwrap_or(true))
    .bind(input.sort_order.unwrap_or(0))
    .execute(&mut *tx)
    .await?;
    let row: AdminCatalogItemDto = sqlx::query_as(&format!(
        "SELECT {ADMIN_ITEM_COLUMNS} FROM eletronicos.service_catalog_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn update_admin_catalog_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<SaveCatalogItemInput>,
) -> Result<Json<AdminCatalogItemDto>, AppError> {
    if input.repair_type.trim().is_empty() {
        return Err(AppError::BadRequest("tipo de reparo é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query(
        "UPDATE eletronicos.service_catalog_items \
         SET category_id = $3::uuid, model_name = $4, repair_type = $5, price = $6, cost_price = $7, \
             duration_minutes = $8, description = $9, image_url = $10, tags = $11, \
             active = COALESCE($12, active), sort_order = COALESCE($13, sort_order), updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&input.category_id)
    .bind(input.model_name.as_deref())
    .bind(input.repair_type.trim())
    .bind(input.price)
    .bind(input.cost_price.unwrap_or(0.0))
    .bind(input.duration_minutes.unwrap_or(60))
    .bind(input.description.as_deref())
    .bind(input.image_url.as_deref())
    .bind(input.tags.unwrap_or_default())
    .bind(input.active)
    .bind(input.sort_order)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("serviço não encontrado".to_string()));
    }
    let row: AdminCatalogItemDto = sqlx::query_as(&format!(
        "SELECT {ADMIN_ITEM_COLUMNS} FROM eletronicos.service_catalog_items WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn delete_admin_catalog_item(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let deleted = sqlx::query("DELETE FROM eletronicos.service_catalog_items WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("serviço não encontrado".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Aparelho (device_types) / Modelo (catalog_models) e vínculos multi-select
// de serviço -- port de ServicosTab.tsx do vrtech: um serviço pode se
// aplicar a múltiplos aparelhos/marcas/modelos, ter peças de estoque como
// dependência de custo (service_catalog_item_parts) e custos avulsos
// (service_catalog_item_extra_costs). Tabelas já existiam no schema
// mirror, só faltavam os endpoints admin.
// ============================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DeviceTypeDto {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub icon_key: String,
    pub sort_order: i32,
}

const DEVICE_TYPE_COLUMNS: &str = "id::text, name, slug, icon_key, sort_order";

pub async fn list_device_types(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<DeviceTypeDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<DeviceTypeDto> = sqlx::query_as(&format!(
        "SELECT {DEVICE_TYPE_COLUMNS} FROM eletronicos.device_types WHERE tenant_id = $1 ORDER BY sort_order"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateDeviceTypeInput {
    pub name: String,
}

pub async fn create_device_type(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateDeviceTypeInput>,
) -> Result<Json<DeviceTypeDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let count: (i64,) = sqlx::query_as("SELECT count(*) FROM eletronicos.device_types WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO eletronicos.device_types (id, tenant_id, name, slug, icon_key, sort_order) \
         VALUES ($1::uuid, $2, $3, $4, 'generic', $5)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(input.name.trim())
    .bind(slugify(&input.name))
    .bind(count.0 as i32)
    .execute(&mut *tx)
    .await?;
    let row: DeviceTypeDto = sqlx::query_as(&format!(
        "SELECT {DEVICE_TYPE_COLUMNS} FROM eletronicos.device_types WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CatalogModelDto {
    pub id: String,
    pub brand_id: String,
    pub name: String,
    pub sort_order: i32,
}

const CATALOG_MODEL_COLUMNS: &str = "id::text, brand_id::text, name, sort_order";

pub async fn list_catalog_models(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<CatalogModelDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<CatalogModelDto> = sqlx::query_as(&format!(
        "SELECT {CATALOG_MODEL_COLUMNS} FROM eletronicos.catalog_models WHERE tenant_id = $1 ORDER BY sort_order"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateCatalogModelInput {
    pub brand_id: String,
    pub name: String,
}

pub async fn create_catalog_model(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateCatalogModelInput>,
) -> Result<Json<CatalogModelDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let count: (i64,) = sqlx::query_as("SELECT count(*) FROM eletronicos.catalog_models WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO eletronicos.catalog_models (id, tenant_id, brand_id, name, sort_order) \
         VALUES ($1::uuid, $2, $3::uuid, $4, $5)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.brand_id)
    .bind(input.name.trim())
    .bind(count.0 as i32)
    .execute(&mut *tx)
    .await?;
    let row: CatalogModelDto = sqlx::query_as(&format!(
        "SELECT {CATALOG_MODEL_COLUMNS} FROM eletronicos.catalog_models WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn update_device_type(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CreateDeviceTypeInput>,
) -> Result<Json<DeviceTypeDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query("UPDATE eletronicos.device_types SET name = $3 WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(input.name.trim())
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("aparelho não encontrado".to_string()));
    }
    let row: DeviceTypeDto = sqlx::query_as(&format!(
        "SELECT {DEVICE_TYPE_COLUMNS} FROM eletronicos.device_types WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn delete_device_type(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let deleted = sqlx::query("DELETE FROM eletronicos.device_types WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("aparelho não encontrado".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_catalog_model(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CreateCatalogModelInput>,
) -> Result<Json<CatalogModelDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("nome é obrigatório".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let updated = sqlx::query("UPDATE eletronicos.catalog_models SET name = $3, brand_id = $4::uuid WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(input.name.trim())
        .bind(&input.brand_id)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("modelo não encontrado".to_string()));
    }
    let row: CatalogModelDto = sqlx::query_as(&format!(
        "SELECT {CATALOG_MODEL_COLUMNS} FROM eletronicos.catalog_models WHERE tenant_id = $1 AND id = $2::uuid"
    ))
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

pub async fn delete_catalog_model(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let deleted = sqlx::query("DELETE FROM eletronicos.catalog_models WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("modelo não encontrado".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductDeviceLinkDto {
    pub product_id: String,
    pub device_type_id: String,
}
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductBrandLinkDto {
    pub product_id: String,
    pub brand_id: String,
}
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductModelLinkDto {
    pub product_id: String,
    pub model_id: String,
}

pub async fn list_product_devices(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ProductDeviceLinkDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProductDeviceLinkDto> = sqlx::query_as(
        "SELECT product_id::text, device_type_id::text FROM eletronicos.product_devices WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn list_product_brands(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ProductBrandLinkDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProductBrandLinkDto> = sqlx::query_as(
        "SELECT product_id::text, brand_id::text FROM eletronicos.product_brands WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn list_product_models(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ProductModelLinkDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProductModelLinkDto> = sqlx::query_as(
        "SELECT product_id::text, model_id::text FROM eletronicos.product_models WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct SaveProductLinksInput {
    pub device_ids: Vec<String>,
    pub brand_ids: Vec<String>,
    pub model_ids: Vec<String>,
}

/// Substitui os vínculos multi-select (aparelho/marca/modelo) de um
/// produto -- mesmo padrão de save_service_item_links, mas sem peças/
/// custo (produto não tem ficha técnica). `phone_brand`/`phone_model`
/// legados na tabela `products` compartilhada ficam sincronizados a
/// partir da 1a marca/1o modelo (só quando exatamente um foi escolhido),
/// mesma regra do ProdutosTab.tsx real.
pub async fn save_product_links(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<SaveProductLinksInput>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let owner: Option<(String,)> = sqlx::query_as("SELECT id::text FROM products WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    if owner.is_none() {
        return Err(AppError::NotFound("produto não encontrado".to_string()));
    }

    let brand_name: Option<String> = if input.brand_ids.len() == 1 {
        sqlx::query_scalar("SELECT name FROM eletronicos.service_catalog_categories WHERE tenant_id = $1 AND id = $2::uuid")
            .bind(&claims.tenant_id)
            .bind(&input.brand_ids[0])
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    let model_name: Option<String> = if input.model_ids.len() == 1 {
        sqlx::query_scalar("SELECT name FROM eletronicos.catalog_models WHERE tenant_id = $1 AND id = $2::uuid")
            .bind(&claims.tenant_id)
            .bind(&input.model_ids[0])
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    sqlx::query("UPDATE products SET phone_brand = $3, phone_model = $4 WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(&brand_name)
        .bind(&model_name)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM eletronicos.product_devices WHERE tenant_id = $1 AND product_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for device_id in &input.device_ids {
        sqlx::query("INSERT INTO eletronicos.product_devices (tenant_id, product_id, device_type_id) VALUES ($1, $2::uuid, $3::uuid)")
            .bind(&claims.tenant_id)
            .bind(&id)
            .bind(device_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM eletronicos.product_brands WHERE tenant_id = $1 AND product_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for brand_id in &input.brand_ids {
        sqlx::query("INSERT INTO eletronicos.product_brands (tenant_id, product_id, brand_id) VALUES ($1, $2::uuid, $3::uuid)")
            .bind(&claims.tenant_id)
            .bind(&id)
            .bind(brand_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query("DELETE FROM eletronicos.product_models WHERE tenant_id = $1 AND product_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for model_id in &input.model_ids {
        sqlx::query("INSERT INTO eletronicos.product_models (tenant_id, product_id, model_id) VALUES ($1, $2::uuid, $3::uuid)")
            .bind(&claims.tenant_id)
            .bind(&id)
            .bind(model_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemDeviceLinkDto {
    pub service_catalog_item_id: String,
    pub device_type_id: String,
}
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemBrandLinkDto {
    pub service_catalog_item_id: String,
    pub brand_id: String,
}
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemModelLinkDto {
    pub service_catalog_item_id: String,
    pub model_id: String,
}

pub async fn list_item_devices(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ItemDeviceLinkDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ItemDeviceLinkDto> = sqlx::query_as(
        "SELECT service_catalog_item_id::text, device_type_id::text FROM eletronicos.service_item_devices WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn list_item_brands(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ItemBrandLinkDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ItemBrandLinkDto> = sqlx::query_as(
        "SELECT service_catalog_item_id::text, brand_id::text FROM eletronicos.service_item_brands WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn list_item_models(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ItemModelLinkDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ItemModelLinkDto> = sqlx::query_as(
        "SELECT service_catalog_item_id::text, model_id::text FROM eletronicos.service_item_models WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemPartDto {
    pub id: String,
    pub service_catalog_item_id: String,
    pub stock_item_id: String,
    pub quantity: f64,
    /// Unidade em que `quantity` foi completado no serviço (pode diferir da
    /// unidade da peça, desde que da mesma família -- ex: peça em kg,
    /// completo em g).
    pub unit: String,
    pub name: String,
    /// Unidade em que a peça está cadastrada no estoque.
    pub stock_unit: String,
    /// Quantidade em estoque da peça (no `stock_unit` acima) -- pra ERP
    /// formulação, custo por unidade de medida = price / stock_quantity.
    pub stock_quantity: f64,
    pub price: f64,
    pub origin_type: String,
}

pub async fn list_item_parts(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ItemPartDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ItemPartDto> = sqlx::query_as(
        "SELECT p.id::text, p.service_catalog_item_id::text, p.stock_item_id::text, p.quantity::float8, p.unit, \
         s.name, s.unit AS stock_unit, s.quantity::float8 AS stock_quantity, s.price::float8, s.origin_type \
         FROM eletronicos.service_catalog_item_parts p \
         JOIN eletronicos.stock_items s ON s.id = p.stock_item_id AND s.tenant_id = p.tenant_id \
         WHERE p.tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemExtraCostDto {
    pub id: String,
    pub service_catalog_item_id: String,
    pub name: String,
    pub value: f64,
}

pub async fn list_item_extra_costs(State(state): State<AppState>, AdminUser(claims): AdminUser) -> Result<Json<Vec<ItemExtraCostDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ItemExtraCostDto> = sqlx::query_as(
        "SELECT id::text, service_catalog_item_id::text, name, value::float8 \
         FROM eletronicos.service_catalog_item_extra_costs WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct PartInput {
    pub stock_item_id: String,
    pub quantity: f64,
    #[serde(default = "default_unit")]
    pub unit: String,
}

fn default_unit() -> String {
    "unidade".to_string()
}
#[derive(Debug, Deserialize)]
pub struct ExtraCostInput {
    pub name: String,
    pub value: f64,
}

#[derive(Debug, Deserialize)]
pub struct SaveServiceItemLinksInput {
    pub device_ids: Vec<String>,
    pub brand_ids: Vec<String>,
    pub model_ids: Vec<String>,
    pub parts: Vec<PartInput>,
    pub extra_costs: Vec<ExtraCostInput>,
}

/// Substitui os vínculos multi-select (aparelho/marca/modelo), peças e
/// custos avulsos de um serviço já existente -- espelha o `saveEditItem`
/// real (delete-all + insert-all por não ter diff incremental na UI).
/// `category_id`/`model_name` legados continuam sincronizados a partir da
/// primeira marca/modelo selecionado (compatibilidade com PDV/IA/tags).
pub async fn save_service_item_links(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<SaveServiceItemLinksInput>,
) -> Result<StatusCode, AppError> {
    if input.brand_ids.is_empty() {
        return Err(AppError::BadRequest("selecione ao menos uma marca".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let legacy_model_name: Option<String> = if input.model_ids.len() == 1 {
        sqlx::query_scalar("SELECT name FROM eletronicos.catalog_models WHERE tenant_id = $1 AND id = $2::uuid")
            .bind(&claims.tenant_id)
            .bind(&input.model_ids[0])
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    let cost_price: f64 = input.parts.iter().map(|_| 0.0).sum::<f64>();
    let _ = cost_price; // custo real calculado abaixo, após buscar preço das peças

    let updated = sqlx::query(
        "UPDATE eletronicos.service_catalog_items SET category_id = $3::uuid, model_name = $4, updated_at = now() \
         WHERE tenant_id = $1 AND id = $2::uuid",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(&input.brand_ids[0])
    .bind(&legacy_model_name)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("serviço não encontrado".to_string()));
    }

    sqlx::query("DELETE FROM eletronicos.service_item_devices WHERE tenant_id = $1 AND service_catalog_item_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for device_id in &input.device_ids {
        sqlx::query(
            "INSERT INTO eletronicos.service_item_devices (tenant_id, service_catalog_item_id, device_type_id) VALUES ($1, $2::uuid, $3::uuid)",
        )
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM eletronicos.service_item_brands WHERE tenant_id = $1 AND service_catalog_item_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for brand_id in &input.brand_ids {
        sqlx::query(
            "INSERT INTO eletronicos.service_item_brands (tenant_id, service_catalog_item_id, brand_id) VALUES ($1, $2::uuid, $3::uuid)",
        )
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(brand_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM eletronicos.service_item_models WHERE tenant_id = $1 AND service_catalog_item_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for model_id in &input.model_ids {
        sqlx::query(
            "INSERT INTO eletronicos.service_item_models (tenant_id, service_catalog_item_id, model_id) VALUES ($1, $2::uuid, $3::uuid)",
        )
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(model_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM eletronicos.service_catalog_item_parts WHERE tenant_id = $1 AND service_catalog_item_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    let mut parts_cost = 0.0f64;
    for part in &input.parts {
        let stock: Option<(f64, String, f64, String)> = sqlx::query_as(
            "SELECT price::float8, unit, quantity::float8, origin_type FROM eletronicos.stock_items \
             WHERE tenant_id = $1 AND id = $2::uuid",
        )
        .bind(&claims.tenant_id)
        .bind(&part.stock_item_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((price, stock_unit, stock_quantity, origin_type)) = stock else {
            return Err(AppError::BadRequest("peça de estoque não encontrada".to_string()));
        };
        // Proibido cadastrar/completar em unidade de família diferente da
        // registrada na peça (ex: peça em metros, serviço completando em
        // gramas) -- convert_stock_unit já rejeita isso com erro claro.
        let converted_qty = convert_stock_unit(part.quantity, &part.unit, &stock_unit)?;
        let cost_per_stock_unit = if origin_type == "erp_formulation" && stock_quantity > 0.0 {
            price / stock_quantity
        } else {
            price
        };
        parts_cost += converted_qty * cost_per_stock_unit;
        sqlx::query(
            "INSERT INTO eletronicos.service_catalog_item_parts (id, tenant_id, service_catalog_item_id, stock_item_id, quantity, unit) \
             VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(&part.stock_item_id)
        .bind(part.quantity)
        .bind(&part.unit)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("DELETE FROM eletronicos.service_catalog_item_extra_costs WHERE tenant_id = $1 AND service_catalog_item_id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    let mut extras_cost = 0.0f64;
    for extra in &input.extra_costs {
        extras_cost += extra.value;
        sqlx::query(
            "INSERT INTO eletronicos.service_catalog_item_extra_costs (id, tenant_id, service_catalog_item_id, name, value) \
             VALUES ($1::uuid, $2, $3::uuid, $4, $5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(extra.name.trim())
        .bind(extra.value)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE eletronicos.service_catalog_items SET cost_price = $3 WHERE tenant_id = $1 AND id = $2::uuid")
        .bind(&claims.tenant_id)
        .bind(&id)
        .bind(parts_cost + extras_cost)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
