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

    // Hero da vitrine pública -- sem isso a landing da demo nascia sem banner
    // (comportamento correto pra lojista real que nunca configurou nada, mas
    // passa impressão de produto quebrado numa vitrine de vendas).
    sqlx::query("UPDATE tenants SET landing_hero_image_url = $2 WHERE id = $1")
        .bind(&tenant_id)
        .bind("https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1600&q=80")
        .execute(&mut *tx)
        .await?;

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

    // Reforço de dados de demo (Part 4 do plano): mais clientes e mais
    // pedidos concluídos espalhados nos últimos dias, pra Financeiro/gráfico
    // de receita não ficarem achatados com só 1 pedido concluído.
    let extra_customers: [(&str, &str); 3] = [
        ("Beatriz Nunes", "5583999996655"),
        ("Rafael Torres", "5583999995544"),
        ("Camila Prado", "5583999994433"),
    ];
    let mut extra_customer_ids = Vec::new();
    for (name, whatsapp) in extra_customers {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO customers (id, tenant_id, name, whatsapp) VALUES ($1, $2, $3, $4)")
            .bind(&id)
            .bind(&tenant_id)
            .bind(name)
            .bind(whatsapp)
            .execute(&mut *tx)
            .await?;
        extra_customer_ids.push((id, name.to_string(), whatsapp.to_string()));
    }

    // (customer idx, product idx, dias atrás)
    let extra_orders: [(usize, usize, i64); 4] = [(0, 0, 3), (1, 2, 7), (2, 4, 15), (0, 6, 28)];
    for (customer_idx, product_idx, days_ago) in extra_orders {
        let (customer_id, customer_name, whatsapp) = &extra_customer_ids[customer_idx];
        let (product_id, product_name, price) = &product_ids[product_idx % product_ids.len()];
        let order_id = Uuid::new_v4().to_string();
        let total = *price * 2.0;
        sqlx::query(
            "INSERT INTO orders (id, tenant_id, customer_id, customer_name, customer_whatsapp, delivery_type, \
             neighborhood, address, payment_method, payment_status, status, shipping_price, total, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, 'entrega', 'Centro', 'Rua Demo, 456', 'pix', 'pago', 'concluido', 5.0, $6, \
             (NOW() - ($7 || ' days')::interval)::text, (NOW() - ($7 || ' days')::interval)::text)",
        )
        .bind(&order_id)
        .bind(&tenant_id)
        .bind(customer_id)
        .bind(customer_name)
        .bind(whatsapp)
        .bind(total)
        .bind(days_ago.to_string())
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

/// Acessórios à venda — categoria de produto separada da de serviços
/// ("Reparos"), pra vitrine/destaques não nascerem vazios. Extraído pra ser
/// chamado tanto na criação do tenant quanto no backfill abaixo (achado em
/// auditoria: `demo-eletronica` já existia de uma seed anterior a este
/// bloco, então `seed_demo_eletronica` inteiro nunca rodava de novo pra
/// gente nenhum, e a vitrine real ficava com catálogo 100% vazio pra
/// sempre — `!created` cortava tudo antes de chegar aqui).
async fn seed_demo_eletronica_accessories(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
) -> anyhow::Result<()> {
    let accessories_category_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, 'Acessórios')")
        .bind(&accessories_category_id)
        .bind(tenant_id)
        .execute(&mut **tx)
        .await?;
    let accessories: [(&str, &str, f64, i64); 9] = [
        ("Capinha iPhone 13", "Silicone premium, várias cores", 39.9, 30),
        ("Película de vidro", "Proteção 9H anti-risco", 19.9, 50),
        ("Carregador USB-C 20W", "Carregamento rápido original", 79.9, 25),
        ("Fone Bluetooth TWS", "Cancelamento de ruído, estojo carregador", 129.9, 15),
        ("Cabo USB-C 1m", "Reforçado, trançado em nylon", 24.9, 40),
        ("Power bank 10000mAh", "Carrega o celular 2-3x, saída dupla USB", 99.9, 20),
        ("Suporte veicular magnético", "Fixação no ar-condicionado, imã reforçado", 34.9, 35),
        ("Adaptador OTG USB-C", "Conecta pendrive/mouse no celular", 29.9, 25),
        ("Mochila para notebook", "Compartimento acolchoado até 15,6\"", 149.9, 10),
    ];
    for (name, description, price, quantity) in accessories {
        sqlx::query(
            "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active, cost_price) \
             VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 1, $8)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(tenant_id)
        .bind(name)
        .bind(description)
        .bind(price)
        .bind(quantity)
        .bind(&accessories_category_id)
        .bind(price * 0.5)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn seed_demo_eletronica(pool: &PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let (tenant_id, created) =
        ensure_demo_tenant(&mut tx, "demo-eletronica", "Resolutoo Assistência", "eletronicos", "plan_eletronica").await?;
    if !created {
        // Backfill idempotente: tenant seedado antes desta rodada ainda tinha
        // o nome antigo "Demo Eletrônica" -- não é literalmente "VR Tech",
        // mas o dono pediu a marca "Resolutoo Assistência Técnica" nessa
        // demo; sem isso, só tenant novo (nunca seedado) ganharia o nome novo.
        sqlx::query("UPDATE tenants SET name = 'Resolutoo Assistência' WHERE id = $1 AND name = 'Demo Eletrônica'")
            .bind(&tenant_id)
            .execute(&mut *tx)
            .await?;
        // Backfill idempotente: só insere se o tenant (já existente) ainda
        // não tem nenhum produto -- cobre exatamente o caso descrito acima
        // sem duplicar nada em quem já tiver os acessórios.
        let (product_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM products WHERE tenant_id = $1")
            .bind(&tenant_id)
            .fetch_one(&mut *tx)
            .await?;
        if product_count == 0 {
            tracing::info!("demo-eletronica: catálogo de produtos vazio, aplicando backfill de acessórios");
            seed_demo_eletronica_accessories(&mut tx, &tenant_id).await?;
        }
        // Commit sempre necessário aqui (não só no ramo de backfill de
        // acessórios) -- senão o UPDATE de nome acima nunca persiste,
        // já que o tx é descartado (rollback implícito) no `return`.
        tx.commit().await?;
        tracing::info!("demo-eletronica already seeded, skipping the rest");
        return Ok(());
    }
    tracing::info!("seeding demo-eletronica...");

    // Hero da vitrine pública (assistência técnica/eletrônicos), mesmo motivo
    // do demo-ecommerce acima.
    sqlx::query("UPDATE tenants SET landing_hero_image_url = $2 WHERE id = $1")
        .bind(&tenant_id)
        .bind("https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1600&q=80")
        .execute(&mut *tx)
        .await?;

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

    // eletronicos.shipping_settings (endereço/coords da loja, tabela
    // própria do módulo de assistência técnica, distinta da `shipping_settings`
    // do ecommerce acima) -- sem essa linha, resolve_driver_location() não
    // acha nem o fallback da loja e o mapa de rastreio do card de
    // deslocamento (/consultar) fica sem nenhum ponto pra mostrar.
    sqlx::query(
        "INSERT INTO eletronicos.shipping_settings \
         (tenant_id, price_per_km, minutes_per_km, store_lat, store_lng, store_address) \
         VALUES ($1, 2.0, 3.0, -7.1195, -34.8450, 'Rua das Trincheiras, 500 - João Pessoa, PB') \
         ON CONFLICT (tenant_id) DO NOTHING",
    )
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

    // Aparelho/marca/modelo — sem isso as abas "Aparelho"/"Marca"/"Modelo"
    // de /estoque nasciam vazias na demo (achado testando a demo ao vivo).
    let device_types: [(&str, &str); 3] = [("Smartphone", "demo-celular"), ("Notebook", "demo-notebook"), ("Tablet", "demo-tablet")];
    let mut device_type_ids = std::collections::HashMap::new();
    for (name, slug) in device_types {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO eletronicos.device_types (id, tenant_id, name, slug) VALUES ($1, $2, $3, $4)")
            .bind(&id)
            .bind(&tenant_id)
            .bind(name)
            .bind(slug)
            .execute(&mut *tx)
            .await?;
        device_type_ids.insert(slug, id);
    }

    // Marcas (eletronicos.service_catalog_categories) — uma por device_type
    // predominante, pra Modelo (catalog_models) ter onde pendurar.
    // Slugs prefixados "demo-" -- device_types.slug e
    // service_catalog_categories.slug são únicos GLOBALMENTE (não por
    // tenant, achado testando: colidia com o tenant single-tenant legado
    // que já usa celular/samsung/xiaomi/etc), não só dentro do tenant.
    let brands: [(&str, &str, &str); 6] = [
        ("Apple", "demo-apple", "demo-celular"),
        ("Samsung", "demo-samsung", "demo-celular"),
        ("Xiaomi", "demo-xiaomi", "demo-celular"),
        ("Motorola", "demo-motorola", "demo-celular"),
        ("Dell", "demo-dell", "demo-notebook"),
        ("Lenovo", "demo-lenovo", "demo-notebook"),
    ];
    let mut brand_ids = Vec::new();
    for (name, slug, device_slug) in brands {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO eletronicos.service_catalog_categories (id, tenant_id, name, slug, device_type) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&id)
        .bind(&tenant_id)
        .bind(name)
        .bind(slug)
        .bind(device_slug)
        .execute(&mut *tx)
        .await?;
        brand_ids.push((slug, id));
    }
    let brand_id = |slug: &str| brand_ids.iter().find(|(s, _)| *s == slug).map(|(_, id)| id.clone()).unwrap();

    let models: [(&str, &str); 10] = [
        ("iPhone 13", "demo-apple"),
        ("iPhone 14", "demo-apple"),
        ("Galaxy S21", "demo-samsung"),
        ("Galaxy A54", "demo-samsung"),
        ("Redmi Note 12", "demo-xiaomi"),
        ("Redmi Note 13", "demo-xiaomi"),
        ("Moto G84", "demo-motorola"),
        ("Moto Edge 40", "demo-motorola"),
        ("Inspiron 15", "demo-dell"),
        ("IdeaPad 3", "demo-lenovo"),
    ];
    for (name, brand_slug) in models {
        sqlx::query("INSERT INTO eletronicos.catalog_models (id, tenant_id, brand_id, name) VALUES ($1, $2, $3, $4)")
            .bind(Uuid::new_v4().to_string())
            .bind(&tenant_id)
            .bind(brand_id(brand_slug))
            .bind(name)
            .execute(&mut *tx)
            .await?;
    }
    let _ = &device_type_ids; // reservado pra quando service_catalog_categories.device_type_id virar obrigatório

    // Catálogo de serviços de reparo por marca (eletronicos.service_catalog_items
    // -- é isto, não a tabela genérica `services`, que o PDV/CatalogSearch e a
    // vitrine de assistência técnica leem via eletronicosAdmin.catalogItems).
    // Achado nesta rodada: antes NUNCA foi seedado, então PDV/catálogo público
    // apareciam vazios pra reparo (só produtos/acessórios apareciam) -- causa
    // raiz real da Parte 9.7 ("PDV não funciona": nada pra buscar/adicionar).
    let catalog_items: [(&str, &str, &str, f64, f64, i32); 14] = [
        ("demo-apple", "Troca de tela", "Tela original ou compatível com garantia", 349.9, 140.0, 60),
        ("demo-apple", "Troca de bateria", "Bateria nova, restaura autonomia original", 189.9, 70.0, 45),
        ("demo-apple", "Troca de conector de carga", "Resolve carregamento lento ou intermitente", 159.9, 50.0, 50),
        ("demo-apple", "Reparo de câmera", "Troca do módulo de câmera traseira/frontal", 229.9, 90.0, 60),
        ("demo-samsung", "Troca de tela", "Tela AMOLED original ou compatível", 299.9, 120.0, 60),
        ("demo-samsung", "Troca de bateria", "Bateria nova com garantia de 90 dias", 149.9, 55.0, 40),
        ("demo-samsung", "Troca de conector de carga", "Substituição do conector USB-C danificado", 129.9, 40.0, 45),
        ("demo-samsung", "Reparo de placa (curto)", "Diagnóstico e reparo de curto na placa lógica", 279.0, 100.0, 120),
        ("demo-xiaomi", "Troca de tela", "Tela original ou compatível com garantia", 259.9, 100.0, 60),
        ("demo-xiaomi", "Troca de bateria", "Bateria nova, restaura autonomia original", 129.9, 45.0, 40),
        ("demo-motorola", "Troca de tela", "Tela original ou compatível com garantia", 219.9, 85.0, 60),
        ("demo-motorola", "Troca de conector de carga", "Resolve carregamento lento ou intermitente", 119.9, 35.0, 45),
        ("demo-dell", "Limpeza interna e pasta térmica", "Remoção de poeira/oxidação, troca de pasta térmica", 129.9, 30.0, 90),
        ("demo-lenovo", "Troca de tela", "Tela de notebook original ou compatível", 449.9, 200.0, 90),
    ];
    for (i, (brand_slug, repair_type, description, price, cost_price, duration_minutes)) in catalog_items.into_iter().enumerate() {
        sqlx::query(
            "INSERT INTO eletronicos.service_catalog_items \
             (id, tenant_id, category_id, repair_type, description, price, cost_price, duration_minutes, active, sort_order) \
             VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, true, $9)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(brand_id(brand_slug))
        .bind(repair_type)
        .bind(description)
        .bind(price)
        .bind(cost_price)
        .bind(duration_minutes)
        .bind(i as i32)
        .execute(&mut *tx)
        .await?;
    }

    seed_demo_eletronica_accessories(&mut tx, &tenant_id).await?;

    // Solicitações de serviço cobrindo todo status do Kanban do painel --
    // Parte 9.5: faltavam "aguardando_diagnostico"/"diagnostico_enviado"
    // (os dois status que caem na coluna "Em diagnóstico", ver
    // STATUS_GROUP em EletronicaAdminDashboard.tsx) -- com os 8 status
    // originais essa coluna sempre ficava vazia na demo.
    let requests: [(&str, &str, &str, &str, &str, Option<f64>); 10] = [
        ("pending", "Maria Silva", "83988887777", "iPhone 12", "Tela trincada, não toca em uma parte", None),
        ("accepted", "João Souza", "83988886666", "Samsung A54", "Não liga mais", Some(150.0)),
        ("aguardando_diagnostico", "Rafael Nunes", "83988879999", "iPhone 14", "Molhou, não liga mais", None),
        ("diagnostico_enviado", "Larissa Prado", "83988878888", "Galaxy S21", "Tela piscando após queda", Some(220.0)),
        ("in_progress", "Ana Costa", "83988885555", "Motorola G60", "Bateria viciada, desliga sozinho", Some(99.9)),
        ("em_pagamento", "Pedro Lima", "83988884444", "iPhone 13", "Conector de carga solto", Some(129.9)),
        ("completed", "Carla Dias", "83988883333", "Xiaomi Redmi Note 11", "Tela com manchas", Some(189.9)),
        ("delivered", "Bruno Alves", "83988882222", "iPhone 11", "Câmera embaçada", Some(140.0)),
        ("finished", "Fernanda Melo", "83988881111", "Samsung S21", "Não carrega", Some(99.9)),
        ("rejected", "Diego Rocha", "83988880000", "iPhone 8", "Aparelho furtado — sem nota fiscal", None),
    ];
    // request_id por status -- statuses são únicos dentro do array acima,
    // então dá pra usar como chave pra ligar diagnóstico/ordem de serviço
    // ao request certo logo depois.
    let mut request_ids: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    for (status, name, phone, model, problem, quote) in requests {
        let (request_id,): (String,) = sqlx::query_as(
            "INSERT INTO eletronicos.service_requests \
             (tenant_id, customer_name, customer_phone, customer_email, phone_model, problem_description, \
              status, quote_value, self_pickup, payment_methods) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, '[\"pix\", \"dinheiro\"]'::jsonb) \
             RETURNING id::text",
        )
        .bind(&tenant_id)
        .bind(name)
        .bind(phone)
        .bind(format!("{}@example.com", name.to_lowercase().replace(' ', ".")))
        .bind(model)
        .bind(problem)
        .bind(status)
        .bind(quote)
        .fetch_one(&mut *tx)
        .await?;
        request_ids.insert(status, request_id);
    }

    // Card de deslocamento com entrega em andamento -- ponto real pro mapa
    // de rastreio ao vivo (LiveTrackingMap, /consultar) ter algo pra
    // mostrar na demo: endereço a ~2km da loja seedada acima
    // (eletronicos.shipping_settings, -7.1195,-34.8450), status "em_entrega"
    // + self_pickup=false (única combinação que liga showLiveMap em
    // EletronicaConsultar.tsx). Sem GPS real empurrando driver_location, o
    // mapa cai no fallback já existente em resolve_driver_location()
    // (posição fixa da loja, is_live=false) -- mostra o trajeto loja->
    // cliente com um ponto real, não anima sozinho.
    sqlx::query(
        "INSERT INTO eletronicos.service_requests \
         (tenant_id, customer_name, customer_phone, customer_email, phone_model, problem_description, \
          status, quote_value, self_pickup, address_street, address_number, address_neighborhood, \
          address_city, address_state, address_lat, address_lng, payment_methods) \
         VALUES ($1, 'Camila Ferreira', '83988870000', 'camila.ferreira@example.com', 'iPhone 12 Pro', \
          'Troca de tela concluída, aparelho a caminho', 'em_entrega', 349.9, false, \
          'Av. Epitácio Pessoa', '1200', 'Tambaú', 'João Pessoa', 'PB', -7.1035, -34.8291, \
          '[\"pix\", \"dinheiro\"]'::jsonb)",
    )
    .bind(&tenant_id)
    .execute(&mut *tx)
    .await?;

    // Diagnóstico preenchido pros 3 cards que passam pela etapa de
    // diagnóstico/reparo (Parte 9.5) -- sem isso, EletronicaDiagnosticSection
    // abria em branco pros cards das colunas "Em diagnóstico"/"Em reparo".
    let diagnostics: [(&str, &str, Option<f64>, bool); 3] = [
        ("aguardando_diagnostico", "Aparelho oxidado pelo contato com água -- aguardando abertura e limpeza da placa pra confirmar extensão do dano.", None, false),
        ("diagnostico_enviado", "Tela com manchas de pressão e falha intermitente no touch após queda -- orçamento já enviado, aguardando aprovação do cliente.", Some(220.0), true),
        ("in_progress", "Bateria com inchaço leve e degradação de capacidade -- troca de bateria original aprovada, aparelho em reparo.", Some(99.9), true),
    ];
    for (status, notes, quote_confirmed, finalized) in diagnostics {
        let Some(request_id) = request_ids.get(status) else { continue };
        sqlx::query(
            "INSERT INTO eletronicos.service_diagnostics \
             (id, tenant_id, service_request_id, services_selected, notes, quote_confirmed, media_urls, finalized) \
             VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5, $6, $7, $8)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(request_id)
        .bind(serde_json::json!([{"id": "demo-troca-tela", "repair_type": "Troca de tela", "price": quote_confirmed.unwrap_or(99.9)}]))
        .bind(notes)
        .bind(quote_confirmed)
        .bind(&Vec::<String>::new())
        .bind(finalized)
        .execute(&mut *tx)
        .await?;
    }

    // Ordem de serviço com checklist preenchido pro card "Em reparo"
    // (in_progress) -- EletronicaServiceOrderPanel.tsx lê isso, sem seed
    // ficava em branco mesmo com o card na coluna certa.
    if let Some(request_id) = request_ids.get("in_progress") {
        sqlx::query(
            "INSERT INTO eletronicos.service_orders (id, tenant_id, request_id, checklist, warranty) \
             VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(request_id)
        .bind(serde_json::json!([
            {"id": "abertura", "label": "Abertura do aparelho", "done": true},
            {"id": "diagnostico", "label": "Diagnóstico confirmado", "done": true},
            {"id": "troca_peca", "label": "Troca da bateria", "done": true},
            {"id": "teste", "label": "Teste de carga e funcionamento", "done": false},
            {"id": "limpeza", "label": "Limpeza e fechamento", "done": false},
        ]))
        .bind("90 dias")
        .execute(&mut *tx)
        .await?;
    }

    // Agendamentos — a tela real (EletronicaAdminAgenda.tsx →
    // eletronicosAdmin.appointments.list()) lê de `eletronicos.appointments`,
    // não de `service_appointments` (tabela legada, sem leitor nenhum na UI
    // atual) — sem isso a agenda da demo aparecia sempre vazia. Passado,
    // hoje e futuro, em status variados, com starts_at/ends_at de 1h.
    let appointments: [(&str, &str, &str, &str, i64, u32); 5] = [
        ("Maria Silva", "83988887777", "Consulta de diagnóstico", "agendado", 0, 10),
        ("João Souza", "83988886666", "Retirada de aparelho", "agendado", 1, 14),
        ("Carla Dias", "83988883333", "Troca de tela", "agendado", 2, 11),
        ("Ana Costa", "83988885555", "Orçamento presencial", "concluido", -5, 9),
        ("Pedro Lima", "83988884444", "Reagendado", "cancelado", 5, 16),
    ];
    for (name, phone, reason, status, days_offset, hour) in appointments {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO eletronicos.appointments \
             (id, tenant_id, service_label, customer_name, customer_phone, starts_at, ends_at, status, notes, created_by, appointment_type) \
             VALUES ($1::uuid, $2, $3, $4, $5, \
              date_trunc('day', NOW()) + ($6 || ' days')::interval + ($7 || ' hours')::interval, \
              date_trunc('day', NOW()) + ($6 || ' days')::interval + ($7 || ' hours')::interval + interval '1 hour', \
              $8, NULL, 'admin', 'service')",
        )
        .bind(&id)
        .bind(&tenant_id)
        .bind(reason)
        .bind(name)
        .bind(phone)
        .bind(days_offset.to_string())
        .bind(hour.to_string())
        .bind(status)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    tracing::info!("demo-eletronica seeded");
    Ok(())
}
