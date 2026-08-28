use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        // Erro real achado pelo Paulo Ferro (teste de injeção): um id
        // malformado (não-UUID) num `Path(id)` que a query casta com
        // `::uuid` vira erro do Postgres (22P02 invalid_text_representation),
        // que caía direto como 500 "erro ao acessar o banco" -- resposta
        // errada pra um erro de INPUT do cliente. Mapeado pra 400 aqui,
        // uma vez só, cobre todo endpoint que faz esse cast, não só o que
        // foi pego no teste.
        // Achado no mesmo teste: nome duplicado em stock_items (UNIQUE
        // tenant_id+name) também caía como 500 genérico em vez de um 409
        // dizendo que já existe -- mesma ideia, mapeado uma vez só pra
        // cobrir qualquer UNIQUE violation.
        if let sqlx::Error::Database(db_err) = &e {
            match db_err.code().as_deref() {
                Some("22P02") => return AppError::BadRequest("identificador inválido".to_string()),
                Some("23505") => return AppError::Conflict("já existe um registro com esse valor".to_string()),
                _ => {}
            }
        }
        tracing::error!("db error: {e}");
        AppError::Internal("erro ao acessar o banco — tente de novo".to_string())
    }
}
