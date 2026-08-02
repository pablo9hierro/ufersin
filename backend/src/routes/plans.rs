//! Planos públicos + preview de cupom (preço sempre do banco).

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::coupons;
use crate::error::AppError;
use crate::plans;
use crate::state::AppState;

pub async fn list_public(State(state): State<AppState>) -> Result<Json<Vec<plans::PlanRow>>, AppError> {
    Ok(Json(plans::list_active(&state.pool).await?))
}

#[derive(Debug, Deserialize)]
pub struct CouponPreviewInput {
    pub code: String,
    pub plano: String,
}

pub async fn coupon_preview(
    State(state): State<AppState>,
    Json(body): Json<CouponPreviewInput>,
) -> Result<Json<coupons::CouponPreview>, AppError> {
    Ok(Json(coupons::preview(&state.pool, &body.code, &body.plano).await?))
}

pub async fn list_content(
    State(state): State<AppState>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM platform_content ORDER BY key")
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(k, v)| serde_json::json!({ "key": k, "value": v }))
            .collect(),
    ))
}
