use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    /// Autenticado, mas sem permissão (ex.: lojista em rota de superadmin).
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
        tracing::error!("db error: {e}");
        // Never leak raw/english sqlx messages to the UI.
        let hint = match &e {
            sqlx::Error::ColumnDecode { index, .. } => {
                format!("não foi possível ler o campo {index} — dados incompletos ou inconsistentes")
            }
            sqlx::Error::RowNotFound => "registro não encontrado".to_string(),
            sqlx::Error::Database(db) => {
                let msg = db.message().to_lowercase();
                if msg.contains("column") && (msg.contains("does not exist") || msg.contains("undefined"))
                {
                    "estrutura do banco desatualizada — tente de novo em instantes ou fale com o suporte"
                        .to_string()
                } else if msg.contains("unique") || msg.contains("duplicate") {
                    "já existe um registro com esses dados".to_string()
                } else if msg.contains("foreign key") || msg.contains("violates") {
                    "dados incompletos — finalize o cadastro da loja antes de continuar".to_string()
                } else {
                    "erro ao salvar no banco — tente de novo ou finalize o cadastro da loja".to_string()
                }
            }
            _ => "erro ao acessar o banco — tente de novo".to_string(),
        };
        AppError::Internal(hint)
    }
}
