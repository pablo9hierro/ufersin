//! Cliente HTTP pra API do Mercado Pago Point/POS -- mesmo padrão de
//! `mercadopago_link.rs` (erro amigável em PT-BR, nunca vaza corpo cru,
//! `X-Idempotency-Key` em toda criação). Endpoints conforme a documentação
//! oficial (Stores/POS/Terminals/Orders) -- nunca um endpoint inventado.

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

const BASE_URL: &str = "https://api.mercadopago.com";

fn friendly_error(action: &str, status: reqwest::StatusCode) -> AppError {
    match status {
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => AppError::BadRequest(
            "A conexão Mercado Pago desta loja expirou ou não tem permissão pra Point — reconecte em Meu Plano → Financeiro.".to_string(),
        ),
        reqwest::StatusCode::NOT_FOUND => {
            AppError::BadRequest(format!("Mercado Pago não encontrou o recurso ao {action}."))
        }
        reqwest::StatusCode::CONFLICT => {
            AppError::Conflict(format!("Já existe uma cobrança/registro pendente ao {action}."))
        }
        _ => AppError::BadRequest(format!("Não foi possível {action} — tente de novo em instantes.")),
    }
}

async fn handle_error(action: &str, resp: reqwest::Response) -> AppError {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    tracing::error!("mercado pago point {action} failed: {status} {text}");
    friendly_error(action, status)
}

#[derive(Debug, Deserialize)]
pub struct MpStore {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MpPos {
    pub id: i64,
    pub name: Option<String>,
    pub external_id: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MpTerminal {
    pub id: Option<String>,
    pub pos_id: Option<i64>,
    pub external_pos_id: Option<String>,
    pub operating_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MpPointOrderResult {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
}

/// `GET /users/{user_id}/stores/search` -- lista as lojas físicas já
/// cadastradas na conta Mercado Pago do tenant.
pub async fn list_stores(state: &AppState, access_token: &str, user_id: &str) -> Result<Vec<MpStore>, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_URL}/users/{user_id}/stores/search"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point list stores failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("listar as lojas", resp).await);
    }
    #[derive(Deserialize)]
    struct SearchResponse {
        results: Vec<MpStore>,
    }
    let parsed: SearchResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point stores parse error: {e}")))?;
    Ok(parsed.results)
}

/// `POST /users/{user_id}/stores` -- cria uma loja física na conta do tenant.
pub async fn create_store(
    state: &AppState,
    access_token: &str,
    user_id: &str,
    name: &str,
    address_line: &str,
) -> Result<MpStore, AppError> {
    let body = json!({
        "name": name,
        "location": { "address_line": address_line },
    });
    let resp = state
        .http
        .post(format!("{BASE_URL}/users/{user_id}/stores"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point create store failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("criar a loja", resp).await);
    }
    resp.json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point store parse error: {e}")))
}

/// `POST /v2/pos` -- cria uma caixa (POS) associada a uma store.
pub async fn create_pos(
    state: &AppState,
    access_token: &str,
    name: &str,
    external_pos_id: &str,
    store_id: &str,
) -> Result<MpPos, AppError> {
    let body = json!({
        "name": name,
        "fixed_amount": false,
        "external_store_id": store_id,
        "external_id": external_pos_id,
        "store_id": store_id,
    });
    let resp = state
        .http
        .post(format!("{BASE_URL}/v2/pos"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point create pos failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("criar o caixa (POS)", resp).await);
    }
    resp.json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point pos parse error: {e}")))
}

/// `GET /v2/pos` -- lista as caixas (POS) da conta.
pub async fn list_pos(state: &AppState, access_token: &str) -> Result<Vec<MpPos>, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_URL}/v2/pos"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point list pos failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("listar os caixas (POS)", resp).await);
    }
    #[derive(Deserialize)]
    struct PosSearchResponse {
        results: Vec<MpPos>,
    }
    let parsed: PosSearchResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point pos list parse error: {e}")))?;
    Ok(parsed.results)
}

pub async fn delete_pos(state: &AppState, access_token: &str, mp_pos_id: &str) -> Result<(), AppError> {
    let resp = state
        .http
        .delete(format!("{BASE_URL}/pos/{mp_pos_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point delete pos failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("remover o caixa (POS)", resp).await);
    }
    Ok(())
}

/// `GET /terminals/v1/list` -- lista os terminais (maquininhas) vinculados
/// à conta. A associação terminal↔POS em si é feita no APP oficial da
/// Mercado Pago pelo lojista/colaborador — nunca automatizada aqui (a doc
/// oficial confirma que essa etapa não é exposta por API de terceiro).
pub async fn list_terminals(state: &AppState, access_token: &str) -> Result<Vec<MpTerminal>, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_URL}/terminals/v1/list"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point list terminals failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("listar os terminais", resp).await);
    }
    #[derive(Deserialize)]
    struct TerminalListResponse {
        #[serde(default)]
        terminals: Vec<MpTerminal>,
    }
    let parsed: TerminalListResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point terminals parse error: {e}")))?;
    Ok(parsed.terminals)
}

/// `POST /v1/orders` -- cria a cobrança e envia pro terminal do POS
/// indicado. `external_reference` já validado como único (não-ativo
/// duplicado) pelo chamador antes desta função ser invocada.
pub async fn create_order(
    state: &AppState,
    access_token: &str,
    external_pos_id: &str,
    amount: f64,
    external_reference: &str,
    description: &str,
) -> Result<MpPointOrderResult, AppError> {
    let body = json!({
        "type": "point",
        "external_reference": external_reference,
        "transactions": {
            "payments": [{ "amount": format!("{:.2}", amount) }],
        },
        "config": {
            "point": { "terminal_id": external_pos_id },
        },
        "description": description,
    });
    let resp = state
        .http
        .post(format!("{BASE_URL}/v1/orders"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", external_reference)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point create order failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("criar a cobrança", resp).await);
    }
    resp.json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point order parse error: {e}")))
}

pub async fn get_order(state: &AppState, access_token: &str, mp_order_id: &str) -> Result<MpPointOrderResult, AppError> {
    let resp = state
        .http
        .get(format!("{BASE_URL}/v1/orders/{mp_order_id}"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point get order failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("consultar a cobrança", resp).await);
    }
    resp.json()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point order parse error: {e}")))
}

pub async fn cancel_order(state: &AppState, access_token: &str, mp_order_id: &str) -> Result<(), AppError> {
    let resp = state
        .http
        .post(format!("{BASE_URL}/v1/orders/{mp_order_id}/cancel"))
        .bearer_auth(access_token)
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("mercado pago point cancel order failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(handle_error("cancelar a cobrança", resp).await);
    }
    Ok(())
}
