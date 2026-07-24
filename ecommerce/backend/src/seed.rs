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

/// Tenant DEMO, separado e isolado do seed acima de propósito — usado
/// pela plataforma Rodoletas em /demo (POST /demo/tokens, ver
/// routes/demo.rs) pra deixar um visitante logar nas telas REAIS de
/// admin/motoboy com dados fake, sem tocar em nenhum tenant de verdade
/// (o de cima, "sunset-tabas", é uma loja real — nunca deve ser
/// alcançável por um endpoint público). Roda sempre (não só quando o
/// banco está vazio), checando pelo slug — assim continua existindo
/// mesmo depois que `seed_if_empty` já rodou uma vez e passou a pular.
pub async fn seed_demo_tenant(pool: &PgPool) -> anyhow::Result<()> {
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM tenants WHERE slug = 'loja-demo'")
        .fetch_optional(pool)
        .await?;
    if existing.is_some() {
        tracing::info!("demo tenant already present, skipping");
        return Ok(());
    }

    tracing::info!("seeding demo tenant for /demo...");

    let org_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO organizations (id, name, email) VALUES ($1, 'Loja Demo', 'demo@rodoletas.app')")
        .bind(&org_id)
        .execute(pool)
        .await?;

    let tenant_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO tenants (id, organization_id, slug, name, status, whatsapp_instance, pickup_address) \
         VALUES ($1, $2, 'loja-demo', 'Loja Demo', 'ativo', 'loja-demo', 'Rua Demo, 123 - Centro')",
    )
    .bind(&tenant_id)
    .bind(&org_id)
    .execute(pool)
    .await?;

    // Premium: todo recurso de admin funciona ao explorar a demo,
    // independente de qual "plano" o visitante escolheu em /demo no
    // Rodoletas — a diferenciação por plano ali é só nos BOTÕES
    // (quais áreas ficam habilitadas), não uma restrição de verdade
    // nesta conta demo compartilhada (gating de verdade por plano no
    // frontend do admin é trabalho futuro, ver README-TENANCY.md).
    sqlx::query("INSERT INTO subscriptions (id, tenant_id, plan_id, status) VALUES ($1, $2, 'plan_premium', 'active')")
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .execute(pool)
        .await?;

    let admin_id = Uuid::new_v4().to_string();
    let admin_hash = hash_password("demo-nao-usar-login-por-senha").expect("hash demo admin password");
    sqlx::query("INSERT INTO admins (id, tenant_id, email, password_hash, name) VALUES ($1, $2, 'demo-admin@rodoletas.app', $3, 'Admin (demo)')")
        .bind(&admin_id)
        .bind(&tenant_id)
        .bind(&admin_hash)
        .execute(pool)
        .await?;

    let motoboy_id = Uuid::new_v4().to_string();
    let motoboy_hash = hash_password("demo-nao-usar-login-por-senha").expect("hash demo motoboy password");
    sqlx::query(
        "INSERT INTO motoboys (id, tenant_id, name, phone, email, password_hash, active) \
         VALUES ($1, $2, 'Motoboy (demo)', '83999998888', 'demo-motoboy@rodoletas.app', $3, 1)",
    )
    .bind(&motoboy_id)
    .bind(&tenant_id)
    .bind(&motoboy_hash)
    .execute(pool)
    .await?;

    let categories = ["Pizzas", "Bebidas", "Sobremesas"];
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

    let products: [(&str, &str, f64, i64, usize); 6] = [
        ("Pizza Margherita", "Molho de tomate, mussarela e manjericão", 42.9, 40, 0),
        ("Pizza Calabresa", "Calabresa fatiada, cebola e azeitona", 44.9, 35, 0),
        ("Refrigerante 2L", "Gelado, várias opções", 12.0, 60, 1),
        ("Água Mineral", "Sem gás, 500ml", 4.5, 80, 1),
        ("Petit Gateau", "Com sorvete de creme", 18.9, 20, 2),
        ("Pudim de Leite", "Fatia individual", 9.9, 25, 2),
    ];
    let mut product_ids = Vec::new();
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
        product_ids.push((id, name, price));
    }

    sqlx::query("INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) VALUES ($1, 1.5, -7.1195, -34.8450)")
        .bind(&tenant_id)
        .execute(pool)
        .await?;

    let customer_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO customers (id, tenant_id, name, whatsapp) VALUES ($1, $2, 'Cliente Demo', '5583999997777')")
        .bind(&customer_id)
        .bind(&tenant_id)
        .execute(pool)
        .await?;

    // Um pedido em cada etapa do fluxo, pra /admin/pedidos e a fila do
    // motoboy não aparecerem vazios na demo.
    let orders: [(&str, &str, &str, Option<&str>); 5] = [
        ("pendente", "entrega", "pix", None),
        ("montando_pedido", "entrega", "pix", None),
        ("pedido_pronto", "entrega", "dinheiro", None),
        ("em_rota_de_entrega", "entrega", "dinheiro", Some("motoboy")),
        ("concluido", "retirada", "pix", None),
    ];
    for (i, (status, delivery_type, payment_method, assign_motoboy)) in orders.iter().enumerate() {
        let order_id = Uuid::new_v4().to_string();
        let (product_id, product_name, price) = &product_ids[i % product_ids.len()];
        let total = *price * 2.0;
        let payment_status = if *payment_method == "pix" && *status != "pendente" { "pago" } else { "pendente" };
        let motoboy_bind: Option<&str> = if assign_motoboy.is_some() { Some(motoboy_id.as_str()) } else { None };

        sqlx::query(
            "INSERT INTO orders (id, tenant_id, customer_id, customer_name, customer_whatsapp, delivery_type, \
             neighborhood, address, payment_method, payment_status, status, shipping_price, total, motoboy_id) \
             VALUES ($1, $2, $3, 'Cliente Demo', '5583999997777', $4, 'Centro', 'Rua Demo, 456', $5, $6, $7, 5.0, $8, $9)",
        )
        .bind(&order_id)
        .bind(&tenant_id)
        .bind(&customer_id)
        .bind(delivery_type)
        .bind(payment_method)
        .bind(payment_status)
        .bind(status)
        .bind(total)
        .bind(motoboy_bind)
        .execute(pool)
        .await?;

        sqlx::query(
            "INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name, unit_price, quantity) \
             VALUES ($1, $2, $3, $4, $5, $6, 2)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&order_id)
        .bind(product_id)
        .bind(product_name)
        .bind(price)
        .execute(pool)
        .await?;
    }

    tracing::info!("demo tenant seeded (slug=loja-demo)");
    Ok(())
}
