//! Admin: Mercado Pago Point/POS. Reaproveita o token OAuth já sincronizado
//! em `tenants.plataforma_credenciais` (mesmo de Pix/Cartão) -- ver
//! `tenant::mp_access_token()`/`mp_user_id()`. Atrás de
//! `Feature::MercadoPagoPoint` (beta, só por feature_flags).

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{AdminUser, PdvUser};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::point::{client as point_client, employee_can_use_pos, EmployeeRef, PointOrderStatus};
use crate::state::AppState;
use crate::tenant;

async fn require_beta(pool: &sqlx::PgPool, tenant_id: &str) -> Result<(), AppError> {
    features::require_feature(pool, tenant_id, Feature::MercadoPagoPoint).await
}

async fn access_token(state: &AppState, tenant_id: &str) -> Result<(String, tenant::TenantPayment), AppError> {
    let payment = tenant::load_tenant_payment(&state.pool, tenant_id).await?;
    let token = payment.mp_access_token().map(str::to_string).ok_or_else(|| {
        AppError::BadRequest(
            "Esta loja não tem Mercado Pago conectado — conecte em Meu Plano → Financeiro antes de usar o Point."
                .to_string(),
        )
    })?;
    Ok((token, payment))
}

// ---------- Stores ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StoreDto {
    pub id: String,
    pub mp_store_id: String,
    pub name: String,
    pub address: Option<String>,
    pub status: String,
}

pub async fn list_stores(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<StoreDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<StoreDto> = sqlx::query_as(
        "SELECT id, mp_store_id, name, address, status FROM mp_point_stores WHERE tenant_id = $1 ORDER BY created_at",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct SyncStoreInput {
    pub name: String,
    pub address: String,
}

/// Cria (ou reaproveita, se já existir com o mesmo nome) a Store na conta
/// Mercado Pago do tenant e espelha localmente.
pub async fn sync_store(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<SyncStoreInput>,
) -> Result<Json<StoreDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let (token, payment) = access_token(&state, &claims.tenant_id).await?;
    let user_id = payment.mp_user_id().ok_or_else(|| {
        AppError::Internal("conexão Mercado Pago sem user_id salvo -- reconecte em Meu Plano".to_string())
    })?;

    let existing = point_client::list_stores(&state, &token, &user_id)
        .await?
        .into_iter()
        .find(|s| s.name.as_deref() == Some(input.name.as_str()));
    let mp_store = match existing {
        Some(s) => s,
        None => point_client::create_store(&state, &token, &user_id, &input.name, &input.address).await?,
    };

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO mp_point_stores (id, tenant_id, mp_store_id, name, address) VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (tenant_id, mp_store_id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, \
           updated_at = now()::text \
         RETURNING id",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&mp_store.id)
    .bind(&input.name)
    .bind(&input.address)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(StoreDto {
        id,
        mp_store_id: mp_store.id,
        name: input.name,
        address: Some(input.address),
        status: "active".to_string(),
    }))
}

// ---------- POS ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PosDto {
    pub id: String,
    pub store_id: Option<String>,
    pub mp_pos_id: Option<String>,
    pub external_pos_id: String,
    pub name: String,
    pub status: String,
    pub terminal_id: Option<String>,
}

pub async fn list_pos(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<PosDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<PosDto> = sqlx::query_as(
        "SELECT id, store_id, mp_pos_id, external_pos_id, name, status, terminal_id \
         FROM mp_point_pos WHERE tenant_id = $1 ORDER BY created_at",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreatePosInput {
    pub name: String,
    pub store_id: String,
}

pub async fn create_pos(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreatePosInput>,
) -> Result<Json<PosDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;

    let store: Option<(String,)> = sqlx::query_as(
        "SELECT mp_store_id FROM mp_point_stores WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&input.store_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((mp_store_id,)) = store else {
        return Err(AppError::BadRequest("loja (store) não encontrada".to_string()));
    };

    // external_pos_id gerado aqui, único por tenant -- é o que garante
    // idempotência do lado da Mercado Pago numa nova tentativa.
    let external_pos_id = Uuid::new_v4().to_string();
    let mp_pos = point_client::create_pos(&state, &token, &input.name, &external_pos_id, &mp_store_id).await?;

    let id = Uuid::new_v4().to_string();
    let row: PosDto = sqlx::query_as(
        "INSERT INTO mp_point_pos (id, tenant_id, store_id, mp_pos_id, external_pos_id, name) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, store_id, mp_pos_id, external_pos_id, name, status, terminal_id",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.store_id)
    .bind(mp_pos.id.to_string())
    .bind(&external_pos_id)
    .bind(&input.name)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

pub async fn delete_pos(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;
    let pos: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT mp_pos_id FROM mp_point_pos WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((Some(mp_pos_id),)) = pos else {
        return Err(AppError::NotFound("caixa (POS) não encontrado".to_string()));
    };
    point_client::delete_pos(&state, &token, &mp_pos_id).await?;
    sqlx::query("DELETE FROM mp_point_pos WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- Terminals ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TerminalDto {
    pub id: String,
    pub mp_terminal_id: String,
    pub pos_id: Option<String>,
    pub serial: Option<String>,
    pub model: Option<String>,
    pub operating_mode: Option<String>,
    pub status: Option<String>,
    pub last_synced_at: Option<String>,
}

pub async fn list_terminals(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<TerminalDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<TerminalDto> = sqlx::query_as(
        "SELECT id, mp_terminal_id, pos_id, serial, model, operating_mode, status, last_synced_at \
         FROM mp_point_terminals WHERE tenant_id = $1 ORDER BY created_at",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// Não automatiza a associação terminal↔POS (isso é feito no app oficial da
/// Mercado Pago pelo lojista/colaborador) -- só espelha o estado atual.
pub async fn sync_terminals(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<TerminalDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;
    let terminals = point_client::list_terminals(&state, &token).await?;

    for t in &terminals {
        let Some(mp_terminal_id) = &t.id else { continue };
        let pos_id: Option<(String,)> = if let Some(ext) = &t.external_pos_id {
            sqlx::query_as("SELECT id FROM mp_point_pos WHERE tenant_id = $1 AND external_pos_id = $2")
                .bind(&claims.tenant_id)
                .bind(ext)
                .fetch_optional(&state.pool)
                .await?
        } else {
            None
        };
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO mp_point_terminals (id, tenant_id, mp_terminal_id, pos_id, operating_mode, last_synced_at) \
             VALUES ($1, $2, $3, $4, $5, now()::text) \
             ON CONFLICT (tenant_id, mp_terminal_id) DO UPDATE SET \
               pos_id = EXCLUDED.pos_id, operating_mode = EXCLUDED.operating_mode, \
               last_synced_at = now()::text, updated_at = now()::text",
        )
        .bind(&id)
        .bind(&claims.tenant_id)
        .bind(mp_terminal_id)
        .bind(pos_id.map(|(p,)| p))
        .bind(&t.operating_mode)
        .execute(&state.pool)
        .await?;
    }

    list_terminals(State(state), AdminUser(claims)).await
}

// ---------- Funcionário × POS ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EmployeePosDto {
    pub pos_id: String,
    pub is_default: bool,
}

pub async fn get_employee_pos(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Path((employee_role, employee_id)): Path<(String, String)>,
) -> Result<Json<Vec<EmployeePosDto>>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<EmployeePosDto> = sqlx::query_as(
        "SELECT pos_id, is_default FROM mp_point_employee_pos \
         WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3",
    )
    .bind(&claims.tenant_id)
    .bind(&employee_role)
    .bind(&employee_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct SetEmployeePosInput {
    pub pos_ids: Vec<String>,
    pub default_pos_id: Option<String>,
}

/// Só admin configura a associação -- o próprio funcionário nunca escolhe
/// quais POS pode usar.
pub async fn set_employee_pos(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path((employee_role, employee_id)): Path<(String, String)>,
    Json(input): Json<SetEmployeePosInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM mp_point_employee_pos WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3")
        .bind(&claims.tenant_id)
        .bind(&employee_role)
        .bind(&employee_id)
        .execute(&mut *tx)
        .await?;
    for pos_id in &input.pos_ids {
        let is_default = input.default_pos_id.as_deref() == Some(pos_id.as_str());
        sqlx::query(
            "INSERT INTO mp_point_employee_pos (id, tenant_id, employee_role, employee_id, pos_id, is_default) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&claims.tenant_id)
        .bind(&employee_role)
        .bind(&employee_id)
        .bind(pos_id)
        .bind(is_default)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- Point Tap ----------
//
// Point Tap NÃO é POS físico -- é o funcionário usando o próprio app
// Mercado Pago, com o acesso de colaborador da conta do negócio. O
// Resolutoo nunca guarda senha/login do Mercado Pago aqui, nunca cria um
// "operador Tap" por API (não existe endpoint público oficial pra isso) --
// só guarda a flag interna + o e-mail usado no convite oficial, pra saber
// quem está habilitado e orientar o convite. Endpoint dedicado (em vez de
// somar campos no UPDATE grande de vendedor já existente) -- mais fácil de
// auditar, sem risco de bind posicional errado numa query com 8+ campos.

#[derive(Debug, Deserialize)]
pub struct SetPointTapInput {
    pub enabled: bool,
    #[serde(default)]
    pub invite_email: Option<String>,
}

pub async fn set_vendedor_point_tap(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(vendedor_id): Path<String>,
    Json(input): Json<SetPointTapInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query(
        "UPDATE vendedores SET point_tap_enabled = $1, point_tap_invite_email = $2 WHERE tenant_id = $3 AND id = $4",
    )
    .bind(input.enabled)
    .bind(&input.invite_email)
    .bind(&claims.tenant_id)
    .bind(&vendedor_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("vendedor not found".to_string()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- Orders (cobrança) ----------

#[derive(Debug, Deserialize)]
pub struct CreatePointOrderInput {
    pub pos_id: String,
    pub amount: f64,
    #[serde(default)]
    pub comanda_id: Option<String>,
    #[serde(default)]
    pub order_id: Option<String>,
    /// Referência única gerada pelo FRONTEND (ex: uuid local) -- garante que
    /// um duplo-clique no botão "Cobrar" nunca cria duas cobranças, mesmo
    /// antes da resposta da primeira chegar.
    pub idempotency_ref: String,
}

#[derive(Debug, Serialize)]
pub struct PointOrderDto {
    pub id: String,
    pub status: String,
}

pub async fn create_order(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Json(input): Json<CreatePointOrderInput>,
) -> Result<Json<PointOrderDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    if input.amount <= 0.0 {
        return Err(AppError::BadRequest("amount deve ser maior que zero".to_string()));
    }

    let pos: Option<(String, String)> = sqlx::query_as(
        "SELECT external_pos_id, tenant_id FROM mp_point_pos WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&input.pos_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((external_pos_id, _)) = pos else {
        return Err(AppError::BadRequest("O caixa (POS) selecionado não pertence a esta loja.".to_string()));
    };

    // Nunca confia no pos_id do frontend pra autorização -- revalida
    // employee -> POS permitido (admin sempre passa).
    let employee = EmployeeRef { role: claims.role.clone(), id: claims.sub.clone() };
    if employee.role != "admin" {
        let allowed: Vec<(String,)> = sqlx::query_as(
            "SELECT pos_id FROM mp_point_employee_pos WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3",
        )
        .bind(&claims.tenant_id)
        .bind(&employee.role)
        .bind(&employee.id)
        .fetch_all(&state.pool)
        .await?;
        let allowed_ids: Vec<String> = allowed.into_iter().map(|(p,)| p).collect();
        if !employee_can_use_pos(&employee, &allowed_ids, &input.pos_id) {
            return Err(AppError::Forbidden(
                "Você não tem permissão para usar este caixa (POS).".to_string(),
            ));
        }
    }

    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;

    // Idempotência local: nunca duas Point Orders ativas pra mesma
    // referência, mesmo padrão de fiscal_documents/deliveries.
    let id = Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO mp_point_orders \
           (id, tenant_id, pos_id, order_id, comanda_id, employee_role, employee_id, amount, status, external_reference) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'created', $9) \
         ON CONFLICT (external_reference) WHERE status NOT IN ('canceled', 'rejected', 'failed') DO NOTHING \
         RETURNING id",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.pos_id)
    .bind(&input.order_id)
    .bind(&input.comanda_id)
    .bind(&employee.role)
    .bind(&employee.id)
    .bind(input.amount)
    .bind(&input.idempotency_ref)
    .fetch_optional(&state.pool)
    .await?;
    let Some((id,)) = inserted else {
        return Err(AppError::Conflict("Já existe uma cobrança em andamento para esta referência.".to_string()));
    };

    let result = point_client::create_order(
        &state,
        &token,
        &external_pos_id,
        input.amount,
        &input.idempotency_ref,
        "Cobrança Resolutoo",
    )
    .await;

    let (status, mp_order_id) = match &result {
        Ok(r) => (PointOrderStatus::from_mp_status(r.status.as_deref().unwrap_or("created")), Some(r.id.clone())),
        Err(_) => (PointOrderStatus::Failed, None),
    };
    sqlx::query(
        "UPDATE mp_point_orders SET status = $1, mp_order_id = $2, updated_at = now()::text WHERE id = $3",
    )
    .bind(status.as_str())
    .bind(&mp_order_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    match result {
        Ok(_) => Ok(Json(PointOrderDto { id, status: status.as_str().to_string() })),
        Err(e) => Err(e),
    }
}

pub async fn get_order(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Path(id): Path<String>,
) -> Result<Json<PointOrderDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM mp_point_orders WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((status,)) = row else {
        return Err(AppError::NotFound("cobrança não encontrada".to_string()));
    };
    Ok(Json(PointOrderDto { id, status }))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT mp_order_id FROM mp_point_orders WHERE tenant_id = $1 AND id = $2 AND status IN ('created', 'pending', 'in_process')",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((Some(mp_order_id),)) = row else {
        return Err(AppError::NotFound("Não existe cobrança pendente para cancelar neste registro.".to_string()));
    };
    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;
    point_client::cancel_order(&state, &token, &mp_order_id).await?;
    sqlx::query("UPDATE mp_point_orders SET status = 'canceled', updated_at = now()::text WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- Cobrança Point escopada por pedido (order_id) ----------
//
// Mesmo padrão de fiscal.rs (GET/emitir/cancelar por order_id) -- usado por
// AdminPedidos.tsx pra cobrar via maquininha um pedido específico, sem o
// admin precisar saber o id interno da mp_point_order.

#[derive(Debug, Serialize)]
pub struct OrderPointDto {
    pub id: String,
    pub status: String,
}

pub async fn get_order_point(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<OrderPointDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, status FROM mp_point_orders WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&claims.tenant_id)
    .bind(&order_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((id, status)) = row else {
        return Err(AppError::NotFound("nenhuma cobrança Point pra este pedido".to_string()));
    };
    Ok(Json(OrderPointDto { id, status }))
}

#[derive(Debug, Deserialize)]
pub struct ChargeOrderPointInput {
    pub pos_id: String,
}

pub async fn charge_order_point(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Path(order_id): Path<String>,
    Json(input): Json<ChargeOrderPointInput>,
) -> Result<Json<OrderPointDto>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;

    let order: Option<(f64,)> = sqlx::query_as("SELECT total FROM orders WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&order_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((amount,)) = order else {
        return Err(AppError::NotFound("pedido não encontrado".to_string()));
    };

    let pos: Option<(String,)> = sqlx::query_as(
        "SELECT external_pos_id FROM mp_point_pos WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&input.pos_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((external_pos_id,)) = pos else {
        return Err(AppError::BadRequest("O caixa (POS) selecionado não pertence a esta loja.".to_string()));
    };

    let employee = EmployeeRef { role: claims.role.clone(), id: claims.sub.clone() };
    if employee.role != "admin" {
        let allowed: Vec<(String,)> = sqlx::query_as(
            "SELECT pos_id FROM mp_point_employee_pos WHERE tenant_id = $1 AND employee_role = $2 AND employee_id = $3",
        )
        .bind(&claims.tenant_id)
        .bind(&employee.role)
        .bind(&employee.id)
        .fetch_all(&state.pool)
        .await?;
        let allowed_ids: Vec<String> = allowed.into_iter().map(|(p,)| p).collect();
        if !employee_can_use_pos(&employee, &allowed_ids, &input.pos_id) {
            return Err(AppError::Forbidden("Você não tem permissão para usar este caixa (POS).".to_string()));
        }
    }

    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;

    // idempotency_ref = o próprio order_id -- nunca duas cobranças ativas
    // pro mesmo pedido, mesmo padrão de fiscal_documents/deliveries.
    let id = Uuid::new_v4().to_string();
    let inserted: Option<(String,)> = sqlx::query_as(
        "INSERT INTO mp_point_orders \
           (id, tenant_id, pos_id, order_id, employee_role, employee_id, amount, status, external_reference) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $4) \
         ON CONFLICT (external_reference) WHERE status NOT IN ('canceled', 'rejected', 'failed') DO NOTHING \
         RETURNING id",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.pos_id)
    .bind(&order_id)
    .bind(&employee.role)
    .bind(&employee.id)
    .bind(amount)
    .fetch_optional(&state.pool)
    .await?;
    let Some((id,)) = inserted else {
        return Err(AppError::Conflict("Já existe uma cobrança em andamento para este pedido.".to_string()));
    };

    let result = point_client::create_order(&state, &token, &external_pos_id, amount, &order_id, "Cobrança Resolutoo").await;
    let (status, mp_order_id) = match &result {
        Ok(r) => (PointOrderStatus::from_mp_status(r.status.as_deref().unwrap_or("created")), Some(r.id.clone())),
        Err(_) => (PointOrderStatus::Failed, None),
    };
    sqlx::query("UPDATE mp_point_orders SET status = $1, mp_order_id = $2, updated_at = now()::text WHERE id = $3")
        .bind(status.as_str())
        .bind(&mp_order_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    match result {
        Ok(_) => Ok(Json(OrderPointDto { id, status: status.as_str().to_string() })),
        Err(e) => Err(e),
    }
}

pub async fn cancel_order_point(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(order_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_beta(&state.pool, &claims.tenant_id).await?;
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, mp_order_id FROM mp_point_orders \
         WHERE tenant_id = $1 AND order_id = $2 AND status IN ('created', 'pending', 'in_process')",
    )
    .bind(&claims.tenant_id)
    .bind(&order_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((id, Some(mp_order_id))) = row else {
        return Err(AppError::NotFound("Não existe cobrança Point pendente pra cancelar neste pedido.".to_string()));
    };
    let (token, _payment) = access_token(&state, &claims.tenant_id).await?;
    point_client::cancel_order(&state, &token, &mp_order_id).await?;
    sqlx::query("UPDATE mp_point_orders SET status = 'canceled', updated_at = now()::text WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
