use axum::{extract::Path, extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::mercadopago;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct NovaAssinatura {
    pub loja_nome: String,
    pub responsavel_nome: String,
    pub whatsapp: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct AssinaturaCriada {
    pub id: String,
    pub checkout_url: String,
}

/// Cria o registro do lojista + a assinatura recorrente no Mercado Pago, e
/// devolve o link de checkout hospedado pra onde o front redireciona.
pub async fn criar_assinatura(
    State(state): State<AppState>,
    Json(body): Json<NovaAssinatura>,
) -> Result<Json<AssinaturaCriada>, AppError> {
    if body.loja_nome.trim().is_empty() || body.responsavel_nome.trim().is_empty() {
        return Err(AppError::BadRequest("nome da loja e do responsável são obrigatórios".to_string()));
    }
    if !body.email.contains('@') {
        return Err(AppError::BadRequest("e-mail inválido".to_string()));
    }

    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO subscribers (id, loja_nome, responsavel_nome, whatsapp, email, valor_mensal, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pendente')",
    )
    .bind(&id)
    .bind(body.loja_nome.trim())
    .bind(body.responsavel_nome.trim())
    .bind(body.whatsapp.trim())
    .bind(body.email.trim())
    .bind(state.valor_padrao)
    .execute(&state.pool)
    .await?;

    let reason = format!("Assinatura ufersin — {}", body.loja_nome.trim());
    let sub = mercadopago::create_subscription(&state, &reason, body.email.trim(), state.valor_padrao, &id).await?;

    sqlx::query("UPDATE subscribers SET mp_preapproval_id = $1, updated_at = now() WHERE id = $2")
        .bind(&sub.preapproval_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    Ok(Json(AssinaturaCriada { id, checkout_url: sub.init_point }))
}

#[derive(Debug, Serialize)]
pub struct StatusAssinatura {
    pub status: String,
}

/// O front chama isso em polling depois de redirecionar o lojista pro
/// checkout — quando o Mercado Pago confirma a autorização, o status muda
/// de "pendente" pra "ativo" (consultado ao vivo na API deles, não fica
/// esperando webhook).
pub async fn status_assinatura(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StatusAssinatura>, AppError> {
    let row: Option<(Option<String>, String)> =
        sqlx::query_as("SELECT mp_preapproval_id, status FROM subscribers WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

    let (preapproval_id, status_atual) = row.ok_or_else(|| AppError::NotFound("assinatura não encontrada".to_string()))?;

    let Some(preapproval_id) = preapproval_id else {
        return Ok(Json(StatusAssinatura { status: status_atual }));
    };

    let mp_status = mercadopago::get_subscription_status(&state, &preapproval_id).await?;
    let novo_status = match mp_status.as_str() {
        "authorized" => "ativo",
        "paused" => "pausado",
        "cancelled" => "cancelado",
        _ => "pendente",
    };

    if novo_status != status_atual {
        sqlx::query("UPDATE subscribers SET status = $1, updated_at = now() WHERE id = $2")
            .bind(novo_status)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }

    Ok(Json(StatusAssinatura { status: novo_status.to_string() }))
}
