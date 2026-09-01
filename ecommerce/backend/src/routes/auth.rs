use axum::extract::State;
use axum::Json;

use crate::auth::{make_token, verify_password};
use crate::error::AppError;
use crate::models::{LoginInput, LoginResponse, PhoneLoginInput};
use crate::state::AppState;
use crate::tenant::LOJA_OFFLINE_MSG;

fn normalize_slug(raw: Option<&str>) -> Option<String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty())?.to_lowercase();
    Some(s)
}

/// Espelha o JWT recém-emitido numa linha de `sessions` (schema sunset) --
/// ponte pras RPCs Postgres antigas (sunset._require_admin/_require_vendedor/
/// _require_motoboy, motoboy_start_run/active_run/financeiro/counts etc.)
/// que ainda validam por sessão opaca nessa tabela, nunca decodificando JWT.
/// Sem isso, todo esse fluxo (corrida do motoboy, financeiro) quebra pra
/// qualquer login feito depois da migração de auth pra JWT -- o login em si
/// funciona (extractors JWT-based leem o token direto), mas essas RPCs
/// específicas nunca encontram a sessão e sempre voltam vazio/erro.
/// `token` (o próprio JWT) vira a PK -- único e imprevisível o bastante pra
/// servir de session token também, `expires_at` já casa com os 7 dias do JWT.
async fn mirror_legacy_session(
    pool: &sqlx::PgPool,
    token: &str,
    tenant_id: &str,
    role: &str,
    subject_id: &str,
) {
    if let Err(e) = sqlx::query(
        "INSERT INTO sessions (token, tenant_id, role, subject_id) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (token) DO NOTHING",
    )
    .bind(token)
    .bind(tenant_id)
    .bind(role)
    .bind(subject_id)
    .execute(pool)
    .await
    {
        tracing::warn!("mirror_legacy_session failed (role={role}): {e:?}");
    }
}

async fn resolve_tenant_id(state: &AppState, slug: &str) -> Result<String, AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, status FROM tenants WHERE slug = $1")
            .bind(slug)
            .fetch_optional(&state.pool)
            .await?;
    let Some((id, status)) = row else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if matches!(status.as_str(), "suspenso" | "cancelado") {
        return Err(AppError::Unauthorized(LOJA_OFFLINE_MSG.to_string()));
    }
    Ok(id)
}

pub async fn admin_login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let email = input.email.trim();
    if email.is_empty() || input.password.is_empty() {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    // Achado no audit de segurança do Paulo Ferro: login sem rate limit
    // nenhum -- script podia tentar senha infinita contra a mesma conta.
    // Chave por email (não IP) pra não trancar rede compartilhada; conta
    // só as tentativas ERRADAS, sucesso zera o contador.
    let limiter_key = email.to_lowercase();
    if let Err(retry_after) = state.login_limiter.check(&limiter_key) {
        return Err(AppError::TooManyRequests(format!(
            "muitas tentativas de login — tente de novo em {retry_after} segundos"
        )));
    }

    if let Some(slug) = normalize_slug(input.tenant_slug.as_deref()) {
        let tenant_id = resolve_tenant_id(&state, &slug).await?;
        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT id, password_hash, name FROM admins WHERE tenant_id = $1 AND lower(email) = lower($2)",
        )
        .bind(&tenant_id)
        .bind(email)
        .fetch_optional(&state.pool)
        .await?;

        let Some((id, hash, name)) = row else {
            state.login_limiter.record_failure(&limiter_key);
            return Err(AppError::Unauthorized("invalid credentials".to_string()));
        };
        if !verify_password(&input.password, &hash) {
            state.login_limiter.record_failure(&limiter_key);
            return Err(AppError::Unauthorized("invalid credentials".to_string()));
        }
        state.login_limiter.reset(&limiter_key);

        let token = make_token(&state.jwt_secret, &id, &tenant_id, "admin", &name);
        mirror_legacy_session(&state.pool, &token, &tenant_id, "admin", &id).await;
        return Ok(Json(LoginResponse {
            token,
            name,
            tenant_slug: slug,
        }));
    }

    // No slug: resolve tenant from credentials. Password is verified before
    // any tenant is chosen so a wrong password never leaks store membership.
    let rows: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT a.id, a.password_hash, a.name, a.tenant_id, t.slug, t.status
         FROM admins a
         INNER JOIN tenants t ON t.id = a.tenant_id
         WHERE lower(a.email) = lower($1)",
    )
    .bind(email)
    .fetch_all(&state.pool)
    .await?;

    let mut matches: Vec<(String, String, String, String)> = Vec::new();
    let mut offline_only = false;
    for (id, hash, name, tenant_id, slug, status) in rows {
        if !verify_password(&input.password, &hash) {
            continue;
        }
        if matches!(status.as_str(), "suspenso" | "cancelado") {
            offline_only = true;
            continue;
        }
        matches.push((id, name, tenant_id, slug));
    }

    match matches.len() {
        0 if offline_only => Err(AppError::Unauthorized(LOJA_OFFLINE_MSG.to_string())),
        0 => {
            state.login_limiter.record_failure(&limiter_key);
            Err(AppError::Unauthorized("invalid credentials".to_string()))
        }
        1 => {
            state.login_limiter.reset(&limiter_key);
            let (id, name, tenant_id, slug) = matches.remove(0);
            let token = make_token(&state.jwt_secret, &id, &tenant_id, "admin", &name);
            mirror_legacy_session(&state.pool, &token, &tenant_id, "admin", &id).await;
            Ok(Json(LoginResponse {
                token,
                name,
                tenant_slug: slug,
            }))
        }
        _ => Err(AppError::Unauthorized(
            "mais de uma loja para este e-mail — use o link do painel Resolutoo".to_string(),
        )),
    }
}

fn digits_only(raw: &str) -> String {
    raw.chars().filter(|c| c.is_ascii_digit()).collect()
}

/// Nunca deixa telefone vazio/curto casar com uma conta cujo `phone` esteja
/// NULL/vazio no banco (`regexp_replace('', ...)` também vira "") -- login
/// de funcionário exige um número de verdade.
fn require_valid_phone(digits: &str) -> Result<(), AppError> {
    if digits.len() < 8 {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }
    Ok(())
}

pub async fn motoboy_login(
    State(state): State<AppState>,
    Json(input): Json<PhoneLoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let slug = normalize_slug(input.tenant_slug.as_deref()).ok_or_else(|| {
        AppError::Unauthorized("invalid credentials".to_string())
    })?;
    let tenant_id = resolve_tenant_id(&state, &slug).await?;
    let phone = digits_only(&input.phone);
    require_valid_phone(&phone)?;

    let row: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, password_hash, name, active FROM motoboys \
         WHERE tenant_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2",
    )
    .bind(&tenant_id)
    .bind(&phone)
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, hash, name, active)) = row else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if active == 0 || !verify_password(&input.password, &hash) {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    let token = make_token(&state.jwt_secret, &id, &tenant_id, "motoboy", &name);
    mirror_legacy_session(&state.pool, &token, &tenant_id, "motoboy", &id).await;
    Ok(Json(LoginResponse {
        token,
        name,
        tenant_slug: slug,
    }))
}

/// BUG-020: o frontend chamava a RPC legada `resolutoo.vendedor_login`
/// (schema antigo, single-tenant, tabela `resolutoo.vendedores` -- nada a
/// ver com a `vendedores` tenant-scoped de verdade) -- login de vendedor
/// nunca bateu com o cadastro real. Mesmo padrão de motoboy_login acima.
pub async fn vendedor_login(
    State(state): State<AppState>,
    Json(input): Json<PhoneLoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let slug = normalize_slug(input.tenant_slug.as_deref()).ok_or_else(|| {
        AppError::Unauthorized("invalid credentials".to_string())
    })?;
    let tenant_id = resolve_tenant_id(&state, &slug).await?;
    let phone = digits_only(&input.phone);
    require_valid_phone(&phone)?;

    let row: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, password_hash, name, active FROM vendedores \
         WHERE tenant_id = $1 AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2",
    )
    .bind(&tenant_id)
    .bind(&phone)
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, hash, name, active)) = row else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if active == 0 || !verify_password(&input.password, &hash) {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    let token = make_token(&state.jwt_secret, &id, &tenant_id, "vendedor", &name);
    mirror_legacy_session(&state.pool, &token, &tenant_id, "vendedor", &id).await;
    Ok(Json(LoginResponse {
        token,
        name,
        tenant_slug: slug,
    }))
}

/// Cozinha ganha conta própria (`cozinha_users`) em vez de reaproveitar a
/// credencial do admin -- login unificado em /funcionarios/login tenta
/// motoboy/vendedor/cozinha em sequência com a mesma credencial e identifica
/// sozinho qual bateu. Mesmo padrão de motoboy_login/vendedor_login acima.
pub async fn cozinha_login(
    State(state): State<AppState>,
    Json(input): Json<PhoneLoginInput>,
) -> Result<Json<LoginResponse>, AppError> {
    let slug = normalize_slug(input.tenant_slug.as_deref()).ok_or_else(|| {
        AppError::Unauthorized("invalid credentials".to_string())
    })?;
    let tenant_id = resolve_tenant_id(&state, &slug).await?;
    let phone = digits_only(&input.phone);
    require_valid_phone(&phone)?;

    let row: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, password_hash, name, active FROM cozinha_users \
         WHERE tenant_id = $1 AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2",
    )
    .bind(&tenant_id)
    .bind(&phone)
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, hash, name, active)) = row else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if active == 0 || !verify_password(&input.password, &hash) {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    let token = make_token(&state.jwt_secret, &id, &tenant_id, "cozinha", &name);
    Ok(Json(LoginResponse {
        token,
        name,
        tenant_slug: slug,
    }))
}
