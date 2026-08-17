//! Proteção de custo da demo pública: limite de mensagens por sessão
//! anônima (gerada no browser) e por IP, numa janela de tempo — sem isso,
//! qualquer visitante da internet pode gerar custo ilimitado de API de LLM
//! numa rota sem autenticação. `session_id` sozinho é descartável (basta
//! abrir aba anônima nova), por isso o teto por IP é o reforço real.

use chrono::{Duration, Utc};
use sqlx::PgPool;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub per_session: i32,
    pub per_ip: i32,
    pub window_minutes: i64,
}

impl RateLimitConfig {
    pub fn from_env() -> Self {
        let per_session = std::env::var("DEMO_RATE_LIMIT_PER_SESSION")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(15);
        let per_ip = std::env::var("DEMO_RATE_LIMIT_PER_IP")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);
        let window_minutes = std::env::var("DEMO_RATE_LIMIT_WINDOW_MINUTES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);
        Self { per_session, per_ip, window_minutes }
    }
}

/// Verifica os dois limites e, se dentro deles, incrementa o contador da
/// sessão. Chamado ANTES de gastar a chamada de LLM — uma tentativa
/// bloqueada nunca chega a custar nada.
pub async fn check_and_increment(
    pool: &PgPool,
    cfg: &RateLimitConfig,
    session_id: &str,
    kind: &str,
    client_ip: &str,
) -> Result<(), AppError> {
    let window_start = Utc::now() - Duration::minutes(cfg.window_minutes);

    let ip_count: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(message_count), 0) FROM platform_demo_assistant_usage \
         WHERE client_ip = $1 AND window_start >= $2",
    )
    .bind(client_ip)
    .bind(window_start)
    .fetch_one(pool)
    .await?;
    if ip_count >= i64::from(cfg.per_ip) {
        return Err(AppError::TooManyRequests(
            "Muitas mensagens vindas deste endereço nos últimos instantes — tente de novo mais tarde."
                .to_string(),
        ));
    }

    let row: Option<(i32, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT message_count, window_start FROM platform_demo_assistant_usage \
         WHERE session_id = $1 AND kind = $2",
    )
    .bind(session_id)
    .bind(kind)
    .fetch_optional(pool)
    .await?;

    let expired = row.as_ref().map(|(_, ws)| *ws < window_start).unwrap_or(true);

    if expired {
        sqlx::query(
            "INSERT INTO platform_demo_assistant_usage (session_id, kind, client_ip, window_start, message_count, updated_at) \
             VALUES ($1, $2, $3, now(), 1, now()) \
             ON CONFLICT (session_id, kind) DO UPDATE SET \
               client_ip = EXCLUDED.client_ip, window_start = now(), message_count = 1, updated_at = now()",
        )
        .bind(session_id)
        .bind(kind)
        .bind(client_ip)
        .execute(pool)
        .await?;
        return Ok(());
    }

    let (count, _) = row.expect("checked above: not expired implies row exists");
    if count >= cfg.per_session {
        return Err(AppError::TooManyRequests(format!(
            "Você atingiu o limite de {} mensagens desta demonstração. Tente de novo em até {} minutos.",
            cfg.per_session, cfg.window_minutes
        )));
    }

    sqlx::query(
        "UPDATE platform_demo_assistant_usage SET message_count = message_count + 1, \
         client_ip = $3, updated_at = now() WHERE session_id = $1 AND kind = $2",
    )
    .bind(session_id)
    .bind(kind)
    .bind(client_ip)
    .execute(pool)
    .await?;

    Ok(())
}
