use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::hash_password;

/// Seeds one demo tenant ("Resolutoo Demo") on a Premium subscription —
/// Premium so every feature-gated endpoint is reachable out of the box in
/// local dev, matching "the exact same system as before, just SaaS-ready"
/// rather than a locked-down trial. Plans/features/roles/permissions
/// themselves are seeded by migrations/0005_tenancy.sql (catalog data, not
/// per-tenant).
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
        .bind("Resolutoo Demo")
        .bind("contato@resolutoo-demo.com")
        .execute(pool)
        .await?;

    let tenant_id = Uuid::new_v4().to_string();
    let evolution_instance =
        std::env::var("SEED_EVOLUTION_INSTANCE").unwrap_or_else(|_| "resolutoo-demo".to_string());
    let pickup_address = std::env::var("SEED_STORE_PICKUP_ADDRESS")
        .unwrap_or_else(|_| "combine o endereço pelo WhatsApp da loja".to_string());
    sqlx::query(
        "INSERT INTO tenants (id, organization_id, slug, name, status, whatsapp_instance, pickup_address) \
         VALUES ($1, $2, $3, $4, 'ativo', $5, $6)",
    )
    .bind(&tenant_id)
    .bind(&org_id)
    .bind("resolutoo-demo")
    .bind("Resolutoo Demo")
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
    .bind("admin@resolutoo-demo.com")
    .bind(&admin_hash)
    .bind("Admin Resolutoo Demo")
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
    .bind("motoboy@resolutoo-demo.com")
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
    // (see the old supabase shipping-by-distance migration).
    sqlx::query(
        "INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) VALUES ($1, 1.5, -7.1746, -34.8576)",
    )
    .bind(&tenant_id)
    .execute(pool)
    .await?;

    println!("========================================");
    println!(" Resolutoo Demo backend — seeded credentials");
    println!("----------------------------------------");
    println!(" Tenant slug: resolutoo-demo");
    println!(" Admin:    admin@resolutoo-demo.com / {admin_password}");
    println!(" Motoboy:  motoboy@resolutoo-demo.com / {motoboy_password}");
    println!("========================================");

    Ok(())
}

/// Cria (se ainda não existir) organization+tenant+subscription pro slug
/// dado. Devolve o tenant_id — existente ou recém-criado — pra quem chamar
/// popular o resto. Idempotente: uma segunda chamada com o mesmo slug só
/// lê e devolve o id, nunca duplica organization/tenant/subscription.
///
/// Recebe a conexão de uma transação (não o pool) de propósito: todo o
/// resto do seed do tenant (produtos/pedidos/serviços) roda na MESMA
/// transação, ver seed_demo_ecommerce/seed_demo_eletronica — sem isso, uma
/// falha no meio do seed (rede caiu, constraint nova, etc.) deixava o
/// tenant criado mas incompleto, e a checagem "slug já existe" fazia a
/// próxima execução pular pra sempre em vez de terminar o que faltou.
async fn ensure_demo_tenant(
    conn: &mut sqlx::PgConnection,
    slug: &str,
    name: &str,
    vertical: &str,
    plan_id: &str,
) -> anyhow::Result<(String, bool)> {
    if let Some((id,)) =
        sqlx::query_as::<_, (String,)>("SELECT id FROM tenants WHERE slug = $1")
            .bind(slug)
            .fetch_optional(&mut *conn)
            .await?
    {
        return Ok((id, false));
    }

    let org_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO organizations (id, name, email) VALUES ($1, $2, $3)")
        .bind(&org_id)
        .bind(name)
        .bind(format!("demo+{slug}@resolutoo.app"))
        .execute(&mut *conn)
        .await?;

    let tenant_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO tenants (id, organization_id, slug, name, status, whatsapp_instance, pickup_address, vertical) \
         VALUES ($1, $2, $3, $4, 'ativo', $3, 'Rua Demo, 123 - Centro', $5)",
    )
    .bind(&tenant_id)
    .bind(&org_id)
    .bind(slug)
    .bind(name)
    .bind(vertical)
    .execute(&mut *conn)
    .await?;

    sqlx::query("INSERT INTO subscriptions (id, tenant_id, plan_id, status) VALUES ($1, $2, $3, 'active')")
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(plan_id)
        .execute(&mut *conn)
        .await?;

    // Horário de funcionamento padrão (seg-sáb 09h-18h, dom fechado) — sem
    // isso a tela de horário do painel demo nasce vazia.
    for day in 0..=6i16 {
        let is_open = day != 0;
        sqlx::query(
            "INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals) \
             VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, day_of_week) DO NOTHING",
        )
        .bind(&tenant_id)
        .bind(day)
        .bind(is_open)
        .bind(sqlx::types::Json(serde_json::json!([{"opens_at": "09:00", "closes_at": "18:00"}])))
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query("INSERT INTO store_status (tenant_id, manually_closed) VALUES ($1, false) ON CONFLICT (tenant_id) DO NOTHING")
        .bind(&tenant_id)
        .execute(&mut *conn)
        .await?;

    Ok((tenant_id, true))
}

/// Demo real seedada — dois tenants de verdade no mesmo Postgres
/// (`demo-ecommerce`, `demo-eletronica`), cada um com dados variados
/// cobrindo toda tela do painel (múltiplas categorias, produto/serviço
/// com e sem estoque, pedido em cada status, agendamento, motoboy/
/// vendedor de exemplo). Roda sempre (idempotente por slug — pula se o
/// tenant já existe), nunca toca em tenant real de um lojista.
///
/// Substitui o antigo `seed_demo_tenant` (slug `loja-demo`, só ecommerce)
/// e o tenant real `vrtech` que a demo pública de eletrônica reaproveitava
/// (`frontend/src/pages/DemoPlanoEletronica.tsx`) — aquilo expunha dado de
/// produção do dono como se fosse demo.
pub async fn seed_demo_tenants(pool: &PgPool) -> anyhow::Result<()> {
    seed_demo_ecommerce(pool).await?;
    seed_demo_eletronica(pool).await?;
    Ok(())
}

async fn seed_demo_ecommerce(pool: &PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let (tenant_id, created) =
        ensure_demo_tenant(&mut tx, "demo-ecommerce", "Demo Ecommerce", "ecommerce", "plan_premium").await?;
    if !created {
        tracing::info!("demo-ecommerce already seeded, skipping");
        return Ok(());
    }
    tracing::info!("seeding demo-ecommerce...");

    let admin_hash = hash_password("demo-nao-usar-login-por-senha").expect("hash demo admin password");
    sqlx::query("INSERT INTO admins (id, tenant_id, email, password_hash, name) VALUES ($1, $2, 'admin@demo-ecommerce.resolutoo.app', $3, 'Admin (demo)')")
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&admin_hash)
        .execute(&mut *tx)
        .await?;

    let motoboy_id = Uuid::new_v4().to_string();
    let staff_hash = hash_password("demo-nao-usar-login-por-senha").expect("hash demo staff password");
    sqlx::query(
        "INSERT INTO motoboys (id, tenant_id, name, phone, email, password_hash, active) \
         VALUES ($1, $2, 'Motoboy Demo', '83999998888', 'motoboy@demo-ecommerce.resolutoo.app', $3, 1)",
    )
    .bind(&motoboy_id)
    .bind(&tenant_id)
    .bind(&staff_hash)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO vendedores (id, tenant_id, name, email, password_hash, active, commission_active, commission_percent) \
         VALUES ($1, $2, 'Vendedora Demo', 'vendedor@demo-ecommerce.resolutoo.app', $3, 1, 1, 5.0)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(&staff_hash)
    .execute(&mut *tx)
    .await?;

    // Categorias variadas
    let categories = ["Pizzas", "Bebidas", "Sobremesas", "Combos"];
    let mut category_ids = Vec::new();
    for name in categories {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, $3)")
            .bind(&id)
            .bind(&tenant_id)
            .bind(name)
            .execute(&mut *tx)
            .await?;
        category_ids.push(id);
    }

    // (name, description, price, quantity — 0 = sem estoque, category idx)
    let products: [(&str, &str, f64, i64, usize); 9] = [
        ("Pizza Margherita", "Molho de tomate, mussarela e manjericão", 42.9, 40, 0),
        ("Pizza Calabresa", "Calabresa fatiada, cebola e azeitona", 44.9, 35, 0),
        ("Pizza Quatro Queijos", "Mussarela, provolone, parmesão e gorgonzola", 49.9, 0, 0),
        ("Refrigerante 2L", "Gelado, várias opções", 12.0, 60, 1),
        ("Água Mineral", "Sem gás, 500ml", 4.5, 80, 1),
        ("Suco Natural 500ml", "Feito na hora", 9.9, 0, 1),
        ("Petit Gateau", "Com sorvete de creme", 18.9, 20, 2),
        ("Pudim de Leite", "Fatia individual", 9.9, 25, 2),
        ("Combo Casal", "2 pizzas médias + refrigerante 2L", 79.9, 10, 3),
    ];
    let mut product_ids = Vec::new();
    for (name, description, price, quantity, cat_idx) in products {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active, cost_price) \
             VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 1, $8)",
        )
        .bind(&id)
        .bind(&tenant_id)
        .bind(name)
        .bind(description)
        .bind(price)
        .bind(quantity)
        .bind(&category_ids[cat_idx])
        .bind(price * 0.5)
        .execute(&mut *tx)
        .await?;
        product_ids.push((id, name.to_string(), price));
    }

    sqlx::query("INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) VALUES ($1, 1.5, -7.1195, -34.8450)")
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;

    // Cupom + promoção — pra "com/sem desconto" e a tela de marketing não
    // nascerem vazias.
    sqlx::query(
        "INSERT INTO coupons (id, tenant_id, code, discount_type, discount_value, active) \
         VALUES ($1, $2, 'DEMO10', 'percent', 10, 1)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await?;

    let customer_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO customers (id, tenant_id, name, whatsapp) VALUES ($1, $2, 'Cliente Demo', '5583999997777')")
        .bind(&customer_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;

    // Um pedido em cada status do fluxo — painel/fila do motoboy nunca vazios.
    let orders: [(&str, &str, &str, Option<&str>); 6] = [
        ("pendente", "entrega", "pix", None),
        ("montando_pedido", "entrega", "pix", None),
        ("pedido_pronto", "entrega", "dinheiro", None),
        ("em_rota_de_entrega", "entrega", "dinheiro", Some("motoboy")),
        ("concluido", "retirada", "pix", None),
        ("cancelado", "entrega", "cartao", None),
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
        .execute(&mut *tx)
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
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    tracing::info!("demo-ecommerce seeded");
    Ok(())
}

async fn seed_demo_eletronica(pool: &PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let (tenant_id, created) =
        ensure_demo_tenant(&mut tx, "demo-eletronica", "Demo Eletrônica", "eletronicos", "plan_eletronica").await?;
    if !created {
        tracing::info!("demo-eletronica already seeded, skipping");
        return Ok(());
    }
    tracing::info!("seeding demo-eletronica...");

    let admin_hash = hash_password("demo-nao-usar-login-por-senha").expect("hash demo admin password");
    sqlx::query("INSERT INTO admins (id, tenant_id, email, password_hash, name) VALUES ($1, $2, 'admin@demo-eletronica.resolutoo.app', $3, 'Admin (demo)')")
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&admin_hash)
        .execute(&mut *tx)
        .await?;

    sqlx::query("INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) VALUES ($1, 1.5, -7.1195, -34.8450)")
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;

    // Categoria pro catálogo de serviços de reparo (services.category_id)
    let category_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, 'Reparos')")
        .bind(&category_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await?;

    // Serviços de reparo variados — (nome, descrição, preço, ativo)
    let services: [(&str, &str, f64, i32); 5] = [
        ("Troca de tela", "Troca de tela original ou compatível", 189.9, 1),
        ("Troca de bateria", "Bateria nova com garantia de 90 dias", 99.9, 1),
        ("Reparo de placa (curto)", "Diagnóstico e reparo de curto na placa lógica", 249.0, 1),
        ("Limpeza interna", "Limpeza de poeira/oxidação e pasta térmica", 69.9, 1),
        ("Troca de conector de carga", "Substituição do conector de carga danificado", 129.9, 0),
    ];
    for (name, description, price, active) in services {
        sqlx::query(
            "INSERT INTO services (id, tenant_id, name, description, category_id, price, active) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(name)
        .bind(description)
        .bind(&category_id)
        .bind(price)
        .bind(active)
        .execute(&mut *tx)
        .await?;
    }

    // Peças de estoque — com e sem garantia, unidade e caixa
    let stock_items: [(&str, &str, f64, Option<f64>, Option<i32>); 5] = [
        ("Tela iPhone 12", "unidade", 12.0, Some(180.0), Some(90)),
        ("Bateria genérica Android", "unidade", 0.0, Some(45.0), None),
        ("Pasta térmica", "caixa", 3.0, Some(25.0), None),
        ("Conector de carga USB-C", "unidade", 20.0, Some(15.0), Some(30)),
        ("Tela Samsung A54", "unidade", 4.0, Some(210.0), Some(90)),
    ];
    for (name, unit, qty, price, warranty_days) in stock_items {
        sqlx::query(
            "INSERT INTO eletronicos.stock_items (tenant_id, name, unit, quantity, price, warranty_days) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&tenant_id)
        .bind(name)
        .bind(unit)
        .bind(qty)
        .bind(price)
        .bind(warranty_days)
        .execute(&mut *tx)
        .await?;
    }

    // Solicitações de serviço cobrindo todo status do Kanban do painel
    let requests: [(&str, &str, &str, &str, &str, Option<f64>); 8] = [
        ("pending", "Maria Silva", "83988887777", "iPhone 12", "Tela trincada, não toca em uma parte", None),
        ("accepted", "João Souza", "83988886666", "Samsung A54", "Não liga mais", Some(150.0)),
        ("in_progress", "Ana Costa", "83988885555", "Motorola G60", "Bateria viciada, desliga sozinho", Some(99.9)),
        ("em_pagamento", "Pedro Lima", "83988884444", "iPhone 13", "Conector de carga solto", Some(129.9)),
        ("completed", "Carla Dias", "83988883333", "Xiaomi Redmi Note 11", "Tela com manchas", Some(189.9)),
        ("delivered", "Bruno Alves", "83988882222", "iPhone 11", "Câmera embaçada", Some(140.0)),
        ("finished", "Fernanda Melo", "83988881111", "Samsung S21", "Não carrega", Some(99.9)),
        ("rejected", "Diego Rocha", "83988880000", "iPhone 8", "Aparelho furtado — sem nota fiscal", None),
    ];
    for (status, name, phone, model, problem, quote) in requests {
        sqlx::query(
            "INSERT INTO eletronicos.service_requests \
             (tenant_id, customer_name, customer_phone, customer_email, phone_model, problem_description, \
              status, quote_value, self_pickup, payment_methods) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, '[\"pix\", \"dinheiro\"]'::jsonb)",
        )
        .bind(&tenant_id)
        .bind(name)
        .bind(phone)
        .bind(format!("{}@example.com", name.to_lowercase().replace(' ', ".")))
        .bind(model)
        .bind(problem)
        .bind(status)
        .bind(quote)
        .execute(&mut *tx)
        .await?;
    }

    // Agendamentos — passado, hoje e futuro, em status variados
    let appointments: [(&str, &str, &str, &str, i64); 4] = [
        ("Maria Silva", "83988887777", "Consulta de diagnóstico", "agendado", 2),
        ("João Souza", "83988886666", "Retirada de aparelho", "agendado", -1),
        ("Ana Costa", "83988885555", "Orçamento presencial", "concluido", -5),
        ("Pedro Lima", "83988884444", "Reagendado", "cancelado", 5),
    ];
    for (name, phone, reason, status, days_offset) in appointments {
        sqlx::query(
            "INSERT INTO service_appointments (id, tenant_id, customer_phone, customer_name, scheduled_at, reason, status) \
             VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval, $6, $7)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(phone)
        .bind(name)
        .bind(days_offset.to_string())
        .bind(reason)
        .bind(status)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    tracing::info!("demo-eletronica seeded");
    Ok(())
}
