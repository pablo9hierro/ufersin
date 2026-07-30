use crate::auth::hash_password;
use crate::state::AppState;

/// Assinante de demonstração, pronto pra logar — sem isso, testar o
/// dashboard em localhost exigia repetir cadastro + pagamento (mock) +
/// onboarding toda vez só pra ter algo pra olhar. `slug`/`tenant_id`
/// apontam pro tenant "loja-demo" que o motor de e-commerce já semeia
/// sozinho (ver ecommerce/backend/src/seed.rs), então "Entrar no painel
/// da loja" no dashboard também funciona. Idempotente — só insere se o
/// e-mail ainda não existir.
pub const DEMO_EMAIL: &str = "demo@rodoletas.app";
pub const DEMO_PASSWORD: &str = "demo1234";

pub async fn seed_demo_subscriber(state: &AppState) -> anyhow::Result<()> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM subscribers WHERE lower(email) = lower($1)")
        .bind(DEMO_EMAIL)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_some() {
        return Ok(());
    }

    let hash = hash_password(DEMO_PASSWORD).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    sqlx::query(
        "INSERT INTO subscribers
            (loja_nome, responsavel_nome, whatsapp, email, valor_mensal, status,
             password_hash, email_verified, plan_code, gateway,
             categoria, endereco, cor_principal, slug, onboarding_status, tenant_id)
         VALUES
            ($1, $2, $3, $4, $5, 'ativo',
             $6, true, $7, 'mercadopago',
             $8, $9, $10, $11, 'provisionado', $12)",
    )
    .bind("Loja Demo")
    .bind("Visitante Demo")
    .bind("5583999990000")
    .bind(DEMO_EMAIL)
    .bind(250.0_f64)
    .bind(&hash)
    .bind("management")
    .bind("Pizzaria")
    .bind("Rua Exemplo, 123 - Centro")
    .bind("#d5aa45")
    .bind("loja-demo")
    .bind("loja-demo-tenant")
    .execute(&state.pool)
    .await?;

    tracing::info!("[seed] assinante de demonstração criado — email: {DEMO_EMAIL}  senha: {DEMO_PASSWORD}");
    Ok(())
}
