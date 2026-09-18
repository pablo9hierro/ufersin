//! Auto-cadastro de motoboy/vendedor via convite (link + código) mandado por
//! WhatsApp. Isolado de propósito do OTP de CLIENTE (`routes::eletronicos`,
//! `public::request_customer_login_code`) -- tabela própria
//! (`employee_invites`), nunca compartilha código/tabela com aquele fluxo.

use axum::extract::{Path, State};
use axum::Json;
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{hash_password, make_token, AdminUser, StaffUser};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::routes::auth::mirror_legacy_session;
use crate::state::AppState;
use crate::tenant;

fn digits_only(raw: &str) -> String {
    raw.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn gen_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteInput {
    pub role: String,
    pub target_phone: String,
    #[serde(default)]
    pub auto_enviar: bool,
}

#[derive(Debug, Serialize)]
pub struct CreateInviteResponse {
    pub token: String,
    pub code: String,
    pub invite_url: String,
    pub whatsapp_message: String,
    pub enviado: bool,
}

fn build_invite_message(role: &str, slug: &str, token: &str, code: &str) -> (String, String) {
    let papel = if role == "motoboy" { "motoboy" } else { "vendedor" };
    // Mesmo padrão de base hardcoded já usado pra outros links públicos
    // (ver `routes::public::sitemap`) -- não existe campo de config
    // `frontend_url` no AppState hoje. `/loja` é obrigatório: o motor de
    // e-commerce (onde essa rota React vive) é embutido sob esse prefixo no
    // build da plataforma (ver ufersin/frontend/scripts/embed-loja-demo.sh,
    // base=/loja/) -- sem o prefixo o link cai na landing Rodoletas (raiz do
    // domínio), não no app real, e a tela fica em branco.
    let url = format!("https://resolutoo.com/loja/convite-funcionario/{token}");
    let msg = format!(
        "Você foi convidado(a) pra trabalhar como {papel} na loja *{slug}*!\n\n\
         Pra completar seu cadastro, acesse:\n{url}\n\n\
         Código de confirmação: *{code}*\n\
         (Ele vale por 24 horas.)"
    );
    (url, msg)
}

/// POST /api/admin/employee-invites -- lojista gera um convite pra motoboy ou
/// vendedor. Telefone é obrigatório (funcionário sem WhatsApp não é um caso
/// suportado). `auto_enviar` dispara a mensagem via Evolution API; o link e o
/// código sempre voltam na resposta também, pro lojista copiar manualmente se
/// preferir (ou se o envio automático falhar).
pub async fn create_invite(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreateInviteInput>,
) -> Result<Json<CreateInviteResponse>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;

    if input.role != "motoboy" && input.role != "vendedor" {
        return Err(AppError::BadRequest("role deve ser motoboy ou vendedor".to_string()));
    }
    let mut phone = digits_only(&input.target_phone);
    if phone.len() < 8 {
        return Err(AppError::BadRequest("telefone inválido".to_string()));
    }
    // Evolution API espera DDI+DDD+número (ex: 5527999998888). Números
    // digitados sem o 55 (caso comum de copiar/colar local) precisam do
    // prefixo, senão o envio falha silenciosamente (whatsapp::notify é
    // fire-and-forget e só loga um warn, nunca propaga erro pra cá).
    if phone.len() <= 11 {
        phone = format!("55{phone}");
    }

    let tenant = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let slug: (String,) = sqlx::query_as("SELECT slug FROM tenants WHERE id = $1")
        .bind(&claims.tenant_id)
        .fetch_one(&state.pool)
        .await?;

    let token = Uuid::new_v4().to_string();
    let code = gen_code();
    let id = Uuid::new_v4().to_string();

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    sqlx::query(
        "INSERT INTO employee_invites \
         (id, tenant_id, role, token, code, target_phone, created_by, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, (now() + interval '24 hours')::text)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.role)
    .bind(&token)
    .bind(&code)
    .bind(&phone)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await?;

    let papel = if input.role == "motoboy" { "motoboy" } else { "vendedor" };
    sqlx::query(
        "INSERT INTO employee_notifications (id, tenant_id, audience, audience_id, message) \
         VALUES ($1, $2, 'admin', NULL, $3)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(format!("Convite de {papel} gerado para o telefone {phone}."))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let (invite_url, whatsapp_message) = build_invite_message(&input.role, &slug.0, &token, &code);

    let enviado = if input.auto_enviar {
        crate::whatsapp::notify_sequential(&state, &tenant.whatsapp_instance, &phone, &whatsapp_message).await
    } else {
        false
    };

    Ok(Json(CreateInviteResponse { token, code, invite_url, whatsapp_message, enviado }))
}

#[derive(Debug, Serialize)]
pub struct InviteStatusResponse {
    pub role: String,
    pub tenant_slug: String,
    pub expired: bool,
}

/// GET /api/public/employee-invites/{token} -- sem auth (o funcionário ainda
/// não tem conta). Só o suficiente pra montar a tela certa, nunca dado
/// sensível.
pub async fn get_invite_public(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<InviteStatusResponse>, AppError> {
    let row: Option<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT ei.role, t.slug, ei.expires_at, ei.used_at \
         FROM employee_invites ei JOIN tenants t ON t.id = ei.tenant_id \
         WHERE ei.token = $1",
    )
    .bind(&token)
    .fetch_optional(&state.pool)
    .await?;

    let Some((role, tenant_slug, expires_at, used_at)) = row else {
        return Err(AppError::NotFound("convite não encontrado".to_string()));
    };
    let expired = used_at.is_some() || is_past(&expires_at);
    Ok(Json(InviteStatusResponse { role, tenant_slug, expired }))
}

fn is_past(text_timestamp: &str) -> bool {
    // Timestamps deste projeto são TEXT (ver convenção em `motoboys`/
    // `vendedores`); comparar como texto ISO-8601 funciona porque
    // `now()::text` do Postgres já vem em ordem lexicográfica crescente.
    text_timestamp < chrono::Utc::now().to_rfc3339().as_str()
}

#[derive(Debug, Deserialize)]
pub struct CompleteInviteInput {
    pub code: String,
    pub name: String,
    pub phone: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct CompleteInviteResponse {
    pub token: String,
    pub name: String,
    pub tenant_slug: String,
    pub role: String,
}

/// POST /api/public/employee-invites/{token}/complete -- sem auth. Confirma
/// o código de 6 dígitos e cria o cadastro de verdade (motoboys/vendedores),
/// já devolvendo um JWT pra logar automaticamente, mesmo formato do login
/// normal (`LoginResponse`-like, mas com `role` também pro front saber pra
/// qual store gravar a sessão).
pub async fn complete_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(input): Json<CompleteInviteInput>,
) -> Result<Json<CompleteInviteResponse>, AppError> {
    if input.password.len() < 6 {
        return Err(AppError::BadRequest("senha deve ter no mínimo 6 caracteres".to_string()));
    }
    let phone = digits_only(&input.phone);
    if phone.len() < 8 {
        return Err(AppError::BadRequest("telefone inválido".to_string()));
    }

    let mut tx = state.pool.begin().await?;
    let invite: Option<(String, String, String, String, String, i32, i32)> = sqlx::query_as(
        "SELECT id, tenant_id, role, code, expires_at, attempts, max_attempts \
         FROM employee_invites WHERE token = $1 AND used_at IS NULL FOR UPDATE",
    )
    .bind(&token)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((invite_id, tenant_id, role, real_code, expires_at, attempts, max_attempts)) = invite else {
        return Err(AppError::Unauthorized("convite inválido ou já usado".to_string()));
    };
    if is_past(&expires_at) {
        return Err(AppError::Unauthorized("convite expirado".to_string()));
    }
    if attempts >= max_attempts {
        return Err(AppError::Unauthorized("convite bloqueado — muitas tentativas".to_string()));
    }
    if input.code.trim() != real_code {
        sqlx::query("UPDATE employee_invites SET attempts = attempts + 1 WHERE id = $1")
            .bind(&invite_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(AppError::Unauthorized("código inválido".to_string()));
    }

    let slug: (String,) = sqlx::query_as("SELECT slug FROM tenants WHERE id = $1")
        .bind(&tenant_id)
        .fetch_one(&mut *tx)
        .await?;

    let hash = hash_password(&input.password)?;
    let employee_id = Uuid::new_v4().to_string();

    let insert_result = if role == "motoboy" {
        sqlx::query(
            "INSERT INTO motoboys (id, tenant_id, name, phone, password_hash, active) \
             VALUES ($1, $2, $3, $4, $5, 1)",
        )
        .bind(&employee_id)
        .bind(&tenant_id)
        .bind(input.name.trim())
        .bind(&phone)
        .bind(&hash)
        .execute(&mut *tx)
        .await
    } else {
        // commission_percent mínimo de 1% -- mesma regra de create_vendedor
        // (routes/admin.rs), padrão inicial até o lojista ajustar depois.
        sqlx::query(
            "INSERT INTO vendedores \
             (id, tenant_id, name, phone, password_hash, active, commission_active, commission_percent) \
             VALUES ($1, $2, $3, $4, $5, 1, 1, 1.0)",
        )
        .bind(&employee_id)
        .bind(&tenant_id)
        .bind(input.name.trim())
        .bind(&phone)
        .bind(&hash)
        .execute(&mut *tx)
        .await
    };
    insert_result.map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("telefone já cadastrado nessa loja".to_string())
        }
        other => other.into(),
    })?;

    sqlx::query(
        "UPDATE employee_invites SET used_at = now()::text, created_employee_id = $1 WHERE id = $2",
    )
    .bind(&employee_id)
    .bind(&invite_id)
    .execute(&mut *tx)
    .await?;

    let papel = if role == "motoboy" { "motoboy" } else { "vendedor" };
    sqlx::query(
        "INSERT INTO employee_notifications (id, tenant_id, audience, audience_id, message) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(&role)
    .bind(&employee_id)
    .bind(format!("Bem-vindo(a), {}! Seu cadastro como {papel} foi concluído.", input.name.trim()))
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO employee_notifications (id, tenant_id, audience, audience_id, message) \
         VALUES ($1, $2, 'admin', NULL, $3)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(format!("{} se cadastrou como {papel}.", input.name.trim()))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let jwt = make_token(&state.jwt_secret, &employee_id, &tenant_id, &role, input.name.trim());
    mirror_legacy_session(&state.pool, &jwt, &tenant_id, &role, &employee_id).await;

    Ok(Json(CompleteInviteResponse { token: jwt, name: input.name.trim().to_string(), tenant_slug: slug.0, role }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EmployeeNotificationDto {
    pub id: String,
    pub message: String,
    pub created_at: String,
}

/// GET /api/admin/employee-notifications -- últimos avisos pro lojista
/// (convite gerado, funcionário cadastrado). Últimos 7 dias, sem
/// marcar-lido no primeiro corte (mesmo espírito do PayrollBell atual).
pub async fn admin_notifications(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<EmployeeNotificationDto>>, AppError> {
    let rows: Vec<EmployeeNotificationDto> = sqlx::query_as(
        "SELECT id, message, created_at FROM employee_notifications \
         WHERE tenant_id = $1 AND audience = 'admin' AND created_at > (now() - interval '7 days')::text \
         ORDER BY created_at DESC LIMIT 10",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// GET /api/staff/employee-notifications -- avisos pro próprio funcionário
/// (ex: boas-vindas). `StaffUser` aceita motoboy ou vendedor, filtra pelo
/// papel+id de quem está logado.
pub async fn staff_notifications(
    State(state): State<AppState>,
    StaffUser(claims): StaffUser,
) -> Result<Json<Vec<EmployeeNotificationDto>>, AppError> {
    let rows: Vec<EmployeeNotificationDto> = sqlx::query_as(
        "SELECT id, message, created_at FROM employee_notifications \
         WHERE tenant_id = $1 AND audience = $2 AND audience_id = $3 \
         AND created_at > (now() - interval '7 days')::text \
         ORDER BY created_at DESC LIMIT 10",
    )
    .bind(&claims.tenant_id)
    .bind(&claims.role)
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}
