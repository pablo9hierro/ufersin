use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::hash_password;

/// Seeds one demo tenant ("Sunset Tabas", same data the single-tenant
/// version always seeded) on a Premium subscription — Premium so every
/// feature-gated endpoint is reachable out of the box in local dev,
/// matching "the exact same system as before, just SaaS-ready" rather than
/// a locked-down trial. Plans/features/roles/permissions themselves are
/// seeded by migrations/0005_tenancy.sql (catalog data, not per-tenant).
pub async fn seed_if_empty(pool: &PgPool) -> anyhow::Result<()> {
    let admin_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM admins")
        .fetch_one(pool)
        .await?;

    if admin_count.0 > 0 {
        tracing::info!("seed data already present, skipping");
        return Ok(());
    }

    tracing::info!("seeding initial data...");

    // Organization + Tenant
    let org_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO organizations (id, name, email) VALUES ($1, $2, $3)")
        .bind(&org_id)
        .bind("Sunset Tabas")
        .bind("contato@sunsettabas.com")
        .execute(pool)
        .await?;

    let tenant_id = Uuid::new_v4().to_string();
    let evolution_instance = std::env::var("SEED_EVOLUTION_INSTANCE").unwrap_or_else(|_| "sunset".to_string());
    let pickup_address = std::env::var("SEED_STORE_PICKUP_ADDRESS")
        .unwrap_or_else(|_| "combine o endereço pelo WhatsApp da loja".to_string());
    sqlx::query(
        "INSERT INTO tenants (id, organization_id, slug, name, status, whatsapp_instance, pickup_address) \
         VALUES ($1, $2, $3, $4, 'ativo', $5, $6)",
    )
    .bind(&tenant_id)
    .bind(&org_id)
    .bind("sunset-tabas")
    .bind("Sunset Tabas")
    .bind(&evolution_instance)
    .bind(&pickup_address)
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO subscriptions (id, tenant_id, plan_id, status) VALUES ($1, $2, 'plan_premium', 'active')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .execute(pool)
    .await?;

    // Admin
    let admin_id = Uuid::new_v4().to_string();
    let admin_password = "admin123";
    let admin_hash = hash_password(admin_password).expect("hash admin password");
    sqlx::query(
        "INSERT INTO admins (id, tenant_id, email, password_hash, name) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&admin_id)
    .bind(&tenant_id)
    .bind("admin@sonset.com")
    .bind(&admin_hash)
    .bind("Admin Sunset Tabas")
    .execute(pool)
    .await?;

    // Motoboy
    let motoboy_id = Uuid::new_v4().to_string();
    let motoboy_password = "motoboy123";
    let motoboy_hash = hash_password(motoboy_password).expect("hash motoboy password");
    sqlx::query(
        "INSERT INTO motoboys (id, tenant_id, name, phone, email, password_hash, active) \
         VALUES ($1, $2, $3, $4, $5, $6, 1)",
    )
    .bind(&motoboy_id)
    .bind(&tenant_id)
    .bind("Motoboy Teste")
    .bind("83999990000")
    .bind("motoboy@sonset.com")
    .bind(&motoboy_hash)
    .execute(pool)
    .await?;

    // Categories
    let categories = ["Bebidas", "Lanches", "Sobremesas"];
    let mut category_ids = Vec::new();
    for name in categories {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, $3)")
            .bind(&id)
            .bind(&tenant_id)
            .bind(name)
            .execute(pool)
            .await?;
        category_ids.push(id);
    }

    // Products: (name, description, price, quantity, category index)
    let products: [(&str, &str, f64, i64, usize); 6] = [
        ("Refrigerante Lata", "Refrigerante gelado 350ml", 6.0, 50, 0),
        ("Suco Natural", "Suco de frutas da estação 500ml", 8.5, 30, 0),
        ("Sanduíche Natural", "Pão integral, frango desfiado e salada", 14.9, 20, 1),
        ("Hambúrguer Artesanal", "Pão brioche, carne 180g, queijo e molho da casa", 24.9, 15, 1),
        ("Pudim de Leite", "Fatia individual de pudim caseiro", 9.9, 25, 2),
        ("Brownie com Sorvete", "Brownie de chocolate com bola de sorvete", 12.9, 18, 2),
    ];

    for (name, description, price, quantity, cat_idx) in products {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active) \
             VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 1)",
        )
        .bind(&id)
        .bind(&tenant_id)
        .bind(name)
        .bind(description)
        .bind(price)
        .bind(quantity)
        .bind(&category_ids[cat_idx])
        .execute(pool)
        .await?;
    }

    // shipping_settings — needed by routes/motoboy.rs's route optimization;
    // same default store coordinates the single-tenant version hardcoded
    // (see the old supabase/sunset_shipping_by_distance.sql).
    sqlx::query(
        "INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) VALUES ($1, 1.5, -7.1746, -34.8576)",
    )
    .bind(&tenant_id)
    .execute(pool)
    .await?;

    println!("========================================");
    println!(" Sunset Tabas backend — seeded credentials");
    println!("----------------------------------------");
    println!(" Tenant slug: sunset-tabas");
    println!(" Admin:    admin@sonset.com / {admin_password}");
    println!(" Motoboy:  motoboy@sonset.com / {motoboy_password}");
    println!("========================================");

    Ok(())
}
