use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
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
        if let sqlx::Error::Database(db_err) = &e {
            if db_err.code().as_deref() == Some("22P02") {
                return AppError::BadRequest("identificador inválido".to_string());
            }
        }
        tracing::error!("db error: {e}");
        AppError::Internal("erro ao acessar o banco — tente de novo".to_string())
    }
}
