//! Mesas de restaurante (Parte 3, `tenantConfig.usa_mesas`). CRUD de
//! cadastro é admin-only; abrir/fechar comanda numa mesa é ação de qualquer
//! PDV (admin ou vendedor/garçom) -- ver `open_comanda` e o fechamento em
//! `routes::pdv::pay_comanda`, que libera a mesa na mesma transação.
//!
//! Comanda avulsa (sem mesa) não passa por nada daqui -- continua com nome
//! livre digitado, em qualquer estilo de loja (ver `routes::pdv::create_comanda`).

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{AdminUser, PdvUser};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::models::ComandaDto;
use crate::routes::pdv::load_comanda_dto;
use crate::state::AppState;
use crate::tenant;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RestaurantTableDto {
    pub id: String,
    pub numero: String,
    pub status: String,
    pub comanda_id: Option<String>,
}

const TABLE_SELECT: &str = "SELECT id, numero, status, comanda_id FROM restaurant_tables";

async fn fetch_tables(state: &AppState, tenant_id: &str) -> Result<Vec<RestaurantTableDto>, AppError> {
    let rows: Vec<RestaurantTableDto> = sqlx::query_as(&format!(
        "{TABLE_SELECT} WHERE tenant_id = $1 ORDER BY numero"
    ))
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows)
}

pub async fn list_tables(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<RestaurantTableDto>>, AppError> {
    fetch_tables(&state, &claims.tenant_id).await.map(Json)
}

/// Mesma listagem, liberada pra qualquer PDV (admin ou vendedor/garçom) --
/// precisa ver a grade de mesas pra abrir/fechar comanda, mesmo sem poder
/// cadastrar mesa nova (isso continua admin-only acima).
pub async fn list_tables_pdv(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
) -> Result<Json<Vec<RestaurantTableDto>>, AppError> {
    fetch_tables(&state, &claims.tenant_id).await.map(Json)
}

#[derive(Debug, Deserialize)]
pub struct CreateTableInput {
    pub numero: String,
}

pub async fn create_table(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateTableInput>,
) -> Result<Json<RestaurantTableDto>, AppError> {
    let numero = input.numero.trim().to_string();
    if numero.is_empty() {
        return Err(AppError::BadRequest("número da mesa é obrigatório".to_string()));
    }
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM restaurant_tables WHERE tenant_id = $1 AND numero = $2")
            .bind(&claims.tenant_id)
            .bind(&numero)
            .fetch_optional(&state.pool)
            .await?;
    if existing.is_some() {
        return Err(AppError::BadRequest(format!("já existe uma mesa {numero}")));
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO restaurant_tables (id, tenant_id, numero) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(&claims.tenant_id)
        .bind(&numero)
        .execute(&state.pool)
        .await?;
    Ok(Json(RestaurantTableDto { id, numero, status: "livre".to_string(), comanda_id: None }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateTableInput {
    pub numero: String,
}

pub async fn update_table(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateTableInput>,
) -> Result<Json<RestaurantTableDto>, AppError> {
    let numero = input.numero.trim().to_string();
    if numero.is_empty() {
        return Err(AppError::BadRequest("número da mesa é obrigatório".to_string()));
    }
    let row: Option<RestaurantTableDto> = sqlx::query_as(&format!(
        "UPDATE restaurant_tables SET numero = $1, updated_at = now() \
         WHERE tenant_id = $2 AND id = $3 \
         RETURNING id, numero, status, comanda_id"
    ))
    .bind(&numero)
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("idx_restaurant_tables_tenant_numero") {
            AppError::BadRequest(format!("já existe uma mesa {numero}"))
        } else {
            AppError::from(e)
        }
    })?;
    row.map(Json).ok_or_else(|| AppError::NotFound("mesa não encontrada".to_string()))
}

pub async fn delete_table(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = sqlx::query("DELETE FROM restaurant_tables WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("mesa não encontrada".to_string()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Abre a comanda de uma mesa: se já ocupada, devolve a comanda existente
/// (idempotente); senão cria uma comanda com **código gerado** (nunca texto
/// livre -- só comanda avulsa usa nome digitado) e marca a mesa ocupada.
pub async fn open_comanda(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Path(id): Path<String>,
) -> Result<Json<ComandaDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let table: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT status, comanda_id FROM restaurant_tables WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((status, comanda_id)) = table else {
        return Err(AppError::NotFound("mesa não encontrada".to_string()));
    };

    if status == "ocupada" {
        if let Some(comanda_id) = comanda_id {
            let dto = load_comanda_dto(&mut tx, &claims.tenant_id, &comanda_id)
                .await?
                .ok_or_else(|| AppError::Internal("mesa ocupada aponta pra comanda inexistente".to_string()))?;
            tx.commit().await?;
            return Ok(Json(dto));
        }
    }

    // Código gerado -- nunca texto livre, pra não confundir com o nome
    // digitado de uma comanda avulsa.
    let code = format!("#{}", Uuid::new_v4().simple().to_string()[..6].to_uppercase());
    let comanda_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO comandas (id, tenant_id, label, opened_by_role, opened_by_id) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&comanda_id)
    .bind(&claims.tenant_id)
    .bind(&code)
    .bind(&claims.role)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE restaurant_tables SET status = 'ocupada', comanda_id = $1, updated_at = now() \
         WHERE tenant_id = $2 AND id = $3",
    )
    .bind(&comanda_id)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    let dto = load_comanda_dto(&mut tx, &claims.tenant_id, &comanda_id)
        .await?
        .ok_or_else(|| AppError::Internal("comanda vanished after insert".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}
