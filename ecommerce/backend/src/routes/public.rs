use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{Datelike, Timelike};
use serde::Deserialize;

use crate::cancel;
use crate::error::AppError;
use crate::formulation;
use crate::geocode;
use crate::google_routes::{self, Ponto, RotaResult};
use crate::mercadopago;
use crate::mercadopago_link;
use crate::models::{
    Category, CustomerCancelInput, OrderDto, ProductDto, ProductRow, StoreHourDay,
    StoreHourInterval, StoreStatusDto,
};
use crate::orders_common::{self, fetch_items, fetch_order_dto, fetch_order_row, row_to_dto, short_id};
use crate::state::AppState;
use crate::tenant;
use crate::whatsapp;

// Catálogo público multi-tenant (products/categories por slug) mora neste
// arquivo — mesma tabela `sunset.products` do CRUD admin. Pix/WhatsApp
// continuam resolvendo tenant pelo order_id (sem login).
//
// Nenhuma dessas rotas tem login (o cliente ainda não tem sessão nesse
// ponto do fluxo) — o tenant de cada uma é resolvido a partir do PRÓPRIO
// pedido (tenant_for_order), que já era o limite de autorização usado aqui
// antes desse refactor (conhecer o id do pedido). Isso também garante que
// a mensagem de WhatsApp/loja usada é sempre a do tenant DONO do pedido,
// nunca a de outro.

const PRODUCT_SELECT: &str = "SELECT p.*, c.name as category_name FROM products p \
    LEFT JOIN categories c ON c.id = p.category_id";

#[derive(Debug, Deserialize, Default)]
pub struct PublicCatalogQuery {
    #[serde(default)]
    pub category_id: Option<String>,
}

/// Vitrine pública: produtos ativos do tenant do `?tenant=` / slug.
/// Sem auth — isolamento é o slug → tenant_id (mesmo DB do admin).
pub async fn list_public_products(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(q): Query<PublicCatalogQuery>,
) -> Result<Json<Vec<ProductDto>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let category_id = q
        .category_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let rows: Vec<ProductRow> = if let Some(cat) = category_id {
        sqlx::query_as(&format!(
            "{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.active <> 0 AND p.category_id = $2 \
             ORDER BY p.name"
        ))
        .bind(&store.id)
        .bind(&cat)
        .fetch_all(&mut *tx)
        .await?
    } else {
        sqlx::query_as(&format!(
            "{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.active <> 0 ORDER BY p.name"
        ))
        .bind(&store.id)
        .fetch_all(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(ProductDto::from).collect()))
}

pub async fn get_public_product(
    State(state): State<AppState>,
    Path((slug, id)): Path<(String, String)>,
) -> Result<Json<ProductDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let row: Option<ProductRow> = sqlx::query_as(&format!(
        "{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2 AND p.active <> 0"
    ))
    .bind(&store.id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    match row {
        Some(r) => Ok(Json(r.into())),
        None => Err(AppError::NotFound("product not found".to_string())),
    }
}

#[derive(serde::Serialize)]
pub struct PublicOrderStatusDto {
    pub id: String,
    pub short_id: String,
    pub status: String,
    pub payment_status: String,
    pub payment_method: String,
    pub delivery_type: String,
    pub total: f64,
    pub created_at: String,
    /// Quando o status mudou pela última vez (aproximação de "quando saiu
    /// pra entrega" pra pedidos em `em_rota_de_entrega` — não existe uma
    /// coluna dedicada de "despachado em", então isso é a melhor
    /// referência real disponível). Usado pra calcular ETA restante.
    pub updated_at: String,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
}

/// Consulta pedidos de um telefone nessa loja — só os campos que o próprio
/// cliente já vê na tela pública "/consultar" (nada além disso). Usado pelo
/// módulo Assistente IA pra responder "cadê meu pedido" sem inventar. Sem
/// login (mesmo modelo de autorização das outras rotas públicas deste
/// arquivo: conhecer o telefone já é o limite razoável aqui, e é o mesmo
/// telefone que a Evolution API confirma dono da conversa do WhatsApp).
pub async fn list_public_orders_by_phone(
    State(state): State<AppState>,
    Path((slug, phone)): Path<(String, String)>,
) -> Result<Json<Vec<PublicOrderStatusDto>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    #[allow(clippy::type_complexity)]
    let rows: Vec<(String, String, String, String, String, f64, String, String, Option<f64>, Option<f64>)> = sqlx::query_as(
        "SELECT id, status, payment_status, payment_method, delivery_type, total, created_at::text, \
                updated_at::text, customer_lat, customer_lng \
         FROM orders WHERE tenant_id = $1 AND customer_whatsapp LIKE '%' || $2 \
         ORDER BY created_at DESC LIMIT 5",
    )
    .bind(&store.id)
    .bind(&digits)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, status, payment_status, payment_method, delivery_type, total, created_at, updated_at, customer_lat, customer_lng)| {
                PublicOrderStatusDto {
                    short_id: short_id(&id).to_string(),
                    id,
                    status,
                    payment_status,
                    payment_method,
                    delivery_type,
                    total,
                    created_at,
                    updated_at,
                    customer_lat,
                    customer_lng,
                }
            })
            .collect(),
    ))
}

#[derive(serde::Deserialize)]
pub struct MigrateCustomerWhatsappInput {
    /// Vários formatos/variantes já normalizados (com/sem 9, com/sem 55)
    /// pelo lado que chama (Assistente IA) — a busca aceita qualquer um.
    pub old_whatsapp_candidates: Vec<String>,
    pub new_whatsapp: String,
}

#[derive(serde::Serialize)]
pub struct MigrateCustomerWhatsappResponse {
    pub found: bool,
}

fn digits_only(s: &str) -> String {
    s.chars().filter(char::is_ascii_digit).collect()
}

/// Usado pela Assistente IA (WhatsApp) quando o cliente diz que o
/// atendimento/pedido dele está cadastrado em outro número: acha o
/// registro pelo número antigo (dentro do MESMO tenant, nunca cross-tenant
/// — tenant vem do slug) e migra o whatsapp pro número da conversa atual
/// em toda tabela onde o whatsapp é identidade do cliente — `customers` e
/// `orders` (ramo ecommerce), `eletronicos.service_requests` e
/// `eletronicos.appointments` (ramo eletrônica). Decisão de produto: sem
/// verificação extra (OTP/confirmação) — confia na palavra do cliente na
/// conversa. `found=false` quando nenhuma das variantes bate com nada
/// nesse tenant (nada foi alterado).
pub async fn migrate_customer_whatsapp(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<MigrateCustomerWhatsappInput>,
) -> Result<Json<MigrateCustomerWhatsappResponse>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let candidates: Vec<String> = input
        .old_whatsapp_candidates
        .iter()
        .map(|s| digits_only(s))
        .filter(|s| s.len() >= 8)
        .collect();
    let new_digits = digits_only(&input.new_whatsapp);
    if candidates.is_empty() || new_digits.len() < 8 {
        return Err(AppError::BadRequest("telefone inválido".to_string()));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;

    let r1 = sqlx::query(
        "UPDATE customers SET whatsapp = $3 \
         WHERE tenant_id = $1 AND regexp_replace(whatsapp, '\\D', '', 'g') = ANY($2)",
    )
    .bind(&store.id)
    .bind(&candidates)
    .bind(&new_digits)
    .execute(&mut *tx)
    .await?;
    let r2 = sqlx::query(
        "UPDATE orders SET customer_whatsapp = $3 \
         WHERE tenant_id = $1 AND regexp_replace(customer_whatsapp, '\\D', '', 'g') = ANY($2)",
    )
    .bind(&store.id)
    .bind(&candidates)
    .bind(&new_digits)
    .execute(&mut *tx)
    .await?;
    let r3 = sqlx::query(
        "UPDATE eletronicos.service_requests SET customer_phone = $3 \
         WHERE tenant_id = $1 AND regexp_replace(customer_phone, '\\D', '', 'g') = ANY($2)",
    )
    .bind(&store.id)
    .bind(&candidates)
    .bind(&new_digits)
    .execute(&mut *tx)
    .await?;
    let r4 = sqlx::query(
        "UPDATE eletronicos.appointments SET customer_phone = $3 \
         WHERE tenant_id = $1 AND regexp_replace(customer_phone, '\\D', '', 'g') = ANY($2)",
    )
    .bind(&store.id)
    .bind(&candidates)
    .bind(&new_digits)
    .execute(&mut *tx)
    .await?;

    let found = r1.rows_affected() + r2.rows_affected() + r3.rows_affected() + r4.rows_affected() > 0;
    tx.commit().await?;
    Ok(Json(MigrateCustomerWhatsappResponse { found }))
}

#[derive(serde::Deserialize)]
pub struct AssistantOrderItemInput {
    #[serde(default)]
    pub product_id: Option<String>,
    /// Serviço (reparo/manutenção) — mutuamente exclusivo com `product_id`.
    /// Sem estoque próprio na tabela `products`; usa `services` + a
    /// disponibilidade calculada por insumo (`formulation::compute_service_available_quantity`).
    #[serde(default)]
    pub service_id: Option<String>,
    pub quantity: i64,
}

#[derive(serde::Deserialize)]
pub struct AssistantOrderInput {
    pub customer_name: String,
    pub customer_whatsapp: String,
    pub items: Vec<AssistantOrderItemInput>,
    /// "pix" (padrão) ou "cartao" (gera link de cobrança depois via
    /// create_card_link, em vez de QR/copia-e-cola Pix).
    #[serde(default = "default_assistant_payment_method")]
    pub payment_method: String,
    /// Valor de entrega/coleta já calculado pela tool `calcular_valor_entrega`
    /// (preço por km real da loja) — nunca inventado pela IA. `None`/0 =
    /// retirada, sem taxa de entrega.
    #[serde(default)]
    pub shipping_price: Option<f64>,
}

fn default_assistant_payment_method() -> String {
    "pix".to_string()
}

/// Cria pedido a partir do Assistente IA (WhatsApp) — mesma lógica de
/// inserção do PDV (`pdv::create_sale`), só que sem login de vendedor
/// (autorização aqui é o slug da loja, mesmo modelo das outras rotas
/// públicas deste arquivo) e sempre como retirada, porque o atendimento
/// por WhatsApp ainda não coleta endereço/localização pra entrega. Nunca
/// nasce paga — quem confirma o pagamento de verdade é sempre o fluxo Pix
/// (create_pix_payment) ou cartão (create_card_link) + refresh_payment,
/// nunca esse endpoint.
pub async fn create_assistant_order(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<AssistantOrderInput>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    if input.items.is_empty() {
        return Err(AppError::BadRequest("pedido precisa ter pelo menos um item".to_string()));
    }
    let name = input.customer_name.trim();
    let whatsapp = input.customer_whatsapp.trim();
    if name.is_empty() || whatsapp.is_empty() {
        return Err(AppError::BadRequest("nome e whatsapp do cliente sao obrigatorios".to_string()));
    }
    if !matches!(input.payment_method.as_str(), "pix" | "cartao") {
        return Err(AppError::BadRequest("payment_method invalido".to_string()));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;

    let mut total = 0.0_f64;
    let mut line_items: Vec<(String, String, f64, i64)> = Vec::with_capacity(input.items.len());
    // Serviços cujo estoque de insumo precisa ser decrementado depois que o
    // pedido é criado (id do serviço, quantidade vendida).
    let mut service_consumptions: Vec<(String, i64)> = Vec::new();
    for item in &input.items {
        if item.quantity <= 0 {
            return Err(AppError::BadRequest("quantidade do item deve ser positiva".to_string()));
        }
        if let Some(service_id) = &item.service_id {
            // services.active é INTEGER (i32) no banco — diferente de
            // products.active, que é BIGINT (i64). Não confundir os dois.
            let row: Option<(String, String, f64, i32)> = sqlx::query_as(
                "SELECT id, name, price, active FROM services WHERE tenant_id = $1 AND id = $2",
            )
            .bind(&store.id)
            .bind(service_id)
            .fetch_optional(&mut *tx)
            .await?;
            let Some((id, name, price, active)) = row else {
                return Err(AppError::BadRequest(format!("servico {service_id} nao encontrado")));
            };
            if active == 0 {
                return Err(AppError::BadRequest(format!("servico {name} nao esta disponivel")));
            }
            let has_ingredients: (i64,) = sqlx::query_as(
                "SELECT count(*) FROM service_ingredients WHERE tenant_id = $1 AND service_id = $2",
            )
            .bind(&store.id)
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
            if has_ingredients.0 > 0 {
                let available = formulation::compute_service_available_quantity(&mut *tx, &store.id, &id)
                    .await?
                    .unwrap_or(0.0);
                if available < item.quantity as f64 {
                    return Err(AppError::BadRequest(format!(
                        "servico {name} sem peca em estoque suficiente pra essa quantidade"
                    )));
                }
                service_consumptions.push((id.clone(), item.quantity));
            }
            total += price * item.quantity as f64;
            line_items.push((id, name, price, item.quantity));
            continue;
        }
        let Some(product_id) = &item.product_id else {
            return Err(AppError::BadRequest("item precisa ter product_id ou service_id".to_string()));
        };
        let row: Option<ProductRow> = sqlx::query_as(&format!(
            "{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"
        ))
        .bind(&store.id)
        .bind(product_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(product) = row else {
            return Err(AppError::BadRequest(format!("produto {product_id} nao encontrado")));
        };
        if product.active == 0 {
            return Err(AppError::BadRequest(format!("produto {} nao esta disponivel", product.name)));
        }
        if product.quantity < item.quantity {
            return Err(AppError::BadRequest(format!("estoque insuficiente pra {}", product.name)));
        }
        total += product.price * item.quantity as f64;
        line_items.push((product.id, product.name, product.price, item.quantity));
    }

    let existing_customer: Option<(String,)> =
        sqlx::query_as("SELECT id FROM customers WHERE tenant_id = $1 AND whatsapp = $2")
            .bind(&store.id)
            .bind(whatsapp)
            .fetch_optional(&mut *tx)
            .await?;
    let customer_id = if let Some((id,)) = existing_customer {
        id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO customers (id, tenant_id, name, whatsapp) VALUES ($1, $2, $3, $4)")
            .bind(&id)
            .bind(&store.id)
            .bind(name)
            .bind(whatsapp)
            .execute(&mut *tx)
            .await?;
        id
    };

    let shipping_price = input.shipping_price.filter(|p| p.is_finite() && *p > 0.0).unwrap_or(0.0);
    let delivery_type = if shipping_price > 0.0 { "entrega" } else { "balcao" };
    let order_total = total + shipping_price;

    let order_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO orders (\
            id, tenant_id, customer_id, customer_name, customer_whatsapp, delivery_type, \
            payment_method, payment_status, status, shipping_price, total, discount_amount, sold_by_role\
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', 'pendente', $8, $9, 0, 'assistente_ia')",
    )
    .bind(&order_id)
    .bind(&store.id)
    .bind(&customer_id)
    .bind(name)
    .bind(whatsapp)
    .bind(delivery_type)
    .bind(&input.payment_method)
    .bind(shipping_price)
    .bind(order_total)
    .execute(&mut *tx)
    .await?;

    for (product_id, product_name, unit_price, quantity) in &line_items {
        sqlx::query(
            "INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name, unit_price, quantity) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&store.id)
        .bind(&order_id)
        .bind(product_id)
        .bind(product_name)
        .bind(unit_price)
        .bind(quantity)
        .execute(&mut *tx)
        .await?;
    }

    // Pedido nasce sempre pendente (nunca dá baixa aqui) — quem confirma
    // pagamento e decrementa estoque é sempre create_pix_payment +
    // refresh_payment, o mesmo fluxo Pix de todo o resto do sistema.
    let dto = fetch_order_dto(&mut tx, &store.id, &order_id)
        .await?
        .ok_or_else(|| AppError::Internal("assistant order vanished after insert".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

/// Sitemap.xml da vitrine pública do tenant — um <url> por produto ativo,
/// pra indexação em buscadores. A mesma URL pública que o botão
/// "compartilhar produto" do catálogo usa (`/loja/produto/{id}?tenant=`).
/// A Assistente IA também pode usar isso como fonte de link direto pra
/// mandar pro cliente (além do buscar_produtos, que já traz preço/nome).
pub async fn get_public_sitemap(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<axum::response::Response, AppError> {
    use axum::http::header;
    use axum::response::IntoResponse;

    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, created_at::text FROM products WHERE tenant_id = $1 AND active <> 0 ORDER BY name",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let base = "https://resolutoo.com/loja";
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
    xml.push_str(&format!(
        "  <url><loc>{base}/catalogo?tenant={slug}</loc></url>\n"
    ));
    for (id, updated_at) in rows {
        xml.push_str("  <url>\n");
        xml.push_str(&format!("    <loc>{base}/produto/{id}?tenant={slug}</loc>\n"));
        if let Some(ts) = updated_at {
            xml.push_str(&format!("    <lastmod>{}</lastmod>\n", &ts[..ts.len().min(10)]));
        }
        xml.push_str("  </url>\n");
    }
    xml.push_str("</urlset>\n");

    Ok((
        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
        xml,
    )
        .into_response())
}

#[derive(serde::Serialize)]
pub struct PublicServiceDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category_name: Option<String>,
    pub price: f64,
    /// `None` = disponibilidade não controlada (sempre "disponível").
    /// `Some(0.0)` = indisponível agora por falta de peça em estoque —
    /// vitrine/Assistente IA devem tratar isso como "fora de estoque",
    /// nunca vender/oferecer um serviço nessa condição.
    pub available_quantity: Option<f64>,
    pub model_name: Option<String>,
    pub repair_type: Option<String>,
    pub tags: Vec<String>,
}

/// Lista de serviços ativos da loja — mesmo modelo de autorização (slug =
/// loja) das outras rotas públicas deste arquivo. Usado pela vitrine e
/// pela tool `buscar_servicos` do Assistente IA.
pub(crate) async fn load_public_service_availability(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    service_id: &str,
    manual_quantity: Option<f64>,
) -> Result<Option<f64>, AppError> {
    let has_ingredients: (i64,) =
        sqlx::query_as("SELECT count(*) FROM service_ingredients WHERE tenant_id = $1 AND service_id = $2")
            .bind(tenant_id)
            .bind(service_id)
            .fetch_one(&mut *tx)
            .await?;
    if has_ingredients.0 > 0 {
        formulation::compute_service_available_quantity(&mut *tx, tenant_id, service_id).await
    } else {
        Ok(manual_quantity)
    }
}

pub async fn list_public_services(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<PublicServiceDto>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let rows: Vec<(String, String, String, Option<String>, f64, Option<f64>, Option<String>, Option<String>, Vec<String>)> = sqlx::query_as(
        "SELECT s.id, s.name, s.description, c.name, s.price, s.manual_quantity, s.model_name, s.repair_type, s.tags \
         FROM services s LEFT JOIN categories c ON c.id = s.category_id \
         WHERE s.tenant_id = $1 AND s.active <> 0 ORDER BY s.name",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;
    let mut services = Vec::with_capacity(rows.len());
    for (id, name, description, category_name, price, manual_quantity, model_name, repair_type, tags) in rows {
        let available_quantity = load_public_service_availability(&mut tx, &store.id, &id, manual_quantity).await?;
        services.push(PublicServiceDto { id, name, description, category_name, price, available_quantity, model_name, repair_type, tags });
    }
    tx.commit().await?;
    Ok(Json(services))
}

/// Detalhe público de UM serviço — página `/loja/servico/{id}` da vitrine
/// e link que o Assistente IA manda pro cliente na prévia do carrinho.
pub async fn get_public_service(
    State(state): State<AppState>,
    Path((slug, id)): Path<(String, String)>,
) -> Result<Json<PublicServiceDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let row: Option<(String, String, String, Option<String>, f64, Option<f64>, Option<String>, Option<String>, Vec<String>)> = sqlx::query_as(
        "SELECT s.id, s.name, s.description, c.name, s.price, s.manual_quantity, s.model_name, s.repair_type, s.tags \
         FROM services s LEFT JOIN categories c ON c.id = s.category_id \
         WHERE s.tenant_id = $1 AND s.id = $2 AND s.active <> 0",
    )
    .bind(&store.id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((id, name, description, category_name, price, manual_quantity, model_name, repair_type, tags)) = row else {
        return Err(AppError::NotFound("service not found".to_string()));
    };
    let available_quantity = load_public_service_availability(&mut tx, &store.id, &id, manual_quantity).await?;
    tx.commit().await?;
    Ok(Json(PublicServiceDto { id, name, description, category_name, price, available_quantity, model_name, repair_type, tags }))
}

/// Sitemap.xml só dos serviços da loja (separado do sitemap de produtos).
pub async fn get_public_services_sitemap(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<axum::response::Response, AppError> {
    use axum::http::header;
    use axum::response::IntoResponse;

    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, created_at::text FROM services WHERE tenant_id = $1 AND active <> 0 ORDER BY name",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let base = "https://resolutoo.com/loja";
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
    for (id, created_at) in rows {
        xml.push_str("  <url>\n");
        xml.push_str(&format!("    <loc>{base}/servico/{id}?tenant={slug}</loc>\n"));
        xml.push_str(&format!("    <lastmod>{}</lastmod>\n", &created_at[..created_at.len().min(10)]));
        xml.push_str("  </url>\n");
    }
    xml.push_str("</urlset>\n");

    Ok(([(header::CONTENT_TYPE, "application/xml; charset=utf-8")], xml).into_response())
}

pub async fn list_public_categories(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<Category>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let rows: Vec<Category> =
        sqlx::query_as("SELECT id, name FROM categories WHERE tenant_id = $1 ORDER BY name")
            .bind(&store.id)
            .fetch_all(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

/// Horário/status da loja pra vitrine pública — antes o front lia isso via
/// Supabase direto (`supabasePublicApi.storeStatus`), que aponta pro schema
/// `resolutoo` legado. O admin salva horário aqui no backend Rust (mesmo
/// banco `loja.store_hours` do CRUD), então a vitrine sempre via "Horários
/// ainda não configurados" mesmo com o lojista tendo salvado — schemas
/// diferentes, dados diferentes. Essa rota lê da MESMA fonte que o admin
/// escreve.
pub async fn get_public_store_status(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<StoreStatusDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;

    let rows: Vec<(i16, bool, serde_json::Value)> = sqlx::query_as(
        "SELECT day_of_week, is_open, intervals FROM store_hours \
         WHERE tenant_id = $1 ORDER BY day_of_week",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;

    let hours: Vec<StoreHourDay> = rows
        .into_iter()
        .map(|(day_of_week, is_open, intervals)| {
            let intervals: Vec<StoreHourInterval> =
                serde_json::from_value(intervals).unwrap_or_default();
            StoreHourDay { day_of_week, is_open, intervals }
        })
        .collect();

    let status: (bool, Option<String>) = sqlx::query_as(
        "SELECT manually_closed, manual_closed_reason FROM store_status WHERE tenant_id = $1",
    )
    .bind(&store.id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or((false, None));

    tx.commit().await?;

    let (pickup_lat, pickup_lng) = geocode::geocode_address(&state.http, &store.pickup_address)
        .await
        .unzip();

    Ok(Json(StoreStatusDto {
        hours,
        manually_closed: status.0,
        manual_closed_reason: status.1,
        onboarding_hours_done: true,
        pickup_address: store.pickup_address,
        pickup_lat,
        pickup_lng,
    }))
}

#[derive(Debug, serde::Serialize)]
pub struct PublicMpKeyDto {
    pub public_key: Option<String>,
}

/// Public key da conta Mercado Pago DA LOJA — nunca o access_token (esse é
/// segredo, fica só no servidor). A public key é feita pra ir pro navegador:
/// o SDK oficial da Mercado Pago (Checkout Transparente) usa ela pra
/// tokenizar o cartão ali mesmo, sem o PAN passar pelo nosso backend.
pub async fn get_public_mp_key(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<PublicMpKeyDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    let public_key = payment_cfg
        .plataforma_credenciais
        .as_ref()
        .and_then(|c| c.get("public_key"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok(Json(PublicMpKeyDto { public_key }))
}

/// Contagem de vendas por produto (ordenação "mais vendidos" no catálogo).
pub async fn public_product_sales_counts(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<ProductSalesCount>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let rows: Vec<ProductSalesCount> = sqlx::query_as(
        "SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::bigint AS sold_count \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         WHERE o.tenant_id = $1 AND oi.tenant_id = $1 \
         GROUP BY oi.product_id",
    )
    .bind(&store.id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct ProductSalesCount {
    pub product_id: String,
    pub sold_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct NotifyOrderCreatedInput {
    pub order_id: String,
}

/// Público de propósito — dispara logo depois do checkout, antes do cliente
/// ter qualquer sessão/token. O texto é montado aqui a partir do pedido
/// (nunca confia em texto vindo do cliente), então o único jeito de abusar
/// disso é reenviar a mesma mensagem fixa pro próprio cliente do pedido,
/// o que é inofensivo.
pub async fn notify_order_created(
    State(state): State<AppState>,
    Json(input): Json<NotifyOrderCreatedInput>,
) -> Result<StatusCode, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &input.order_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &input.order_id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    let mut vars = std::collections::HashMap::new();
    vars.insert("nome".to_string(), order.customer_name.clone());
    vars.insert("loja".to_string(), store.name.clone());
    let templated = crate::routes::eletronicos::render_whatsapp_template(&mut tx, &store.id, "order_confirmed", &vars).await?;
    tx.commit().await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = templated.unwrap_or_else(|| {
        format!(
            "Olá, {}! Recebemos seu pedido e já estamos preparando 😋 Assim que ficar pronto, avisamos por aqui!",
            order.customer_name
        )
    });
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, Default)]
pub struct CreatePixQuery {
    /// Quando `1`/`true`, descarta cobrança anterior (ainda não paga) e
    /// gera um QR novo — usado pelo PDV ("Gerar nova cobrança").
    #[serde(default)]
    pub force: Option<String>,
    /// E-mail de login do cliente (se estiver autenticado) — usado como
    /// payer.email na cobrança Mercado Pago em vez do e-mail da loja, já
    /// que login de cliente agora exige e-mail. Cai pro e-mail da loja se
    /// ausente (checkout de convidado, sem conta).
    #[serde(default)]
    pub customer_email: Option<String>,
}

fn force_flag(q: &CreatePixQuery) -> bool {
    matches!(
        q.force.as_deref().map(|s| s.trim().to_ascii_lowercase()).as_deref(),
        Some("1") | Some("true") | Some("yes")
    )
}

/// Cria a cobrança Pix (Mercado Pago por tenant — único provedor suportado).
/// Idempotente: se já tiver cobrança e `force` não veio, devolve
/// como está. Com `?force=1` (e pagamento ainda pendente), gera outra.
pub async fn create_pix_payment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<CreatePixQuery>,
) -> Result<Json<OrderDto>, AppError> {
    let force = force_flag(&q);
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if order.payment_method != "pix" {
        return Err(AppError::BadRequest("order is not a pix payment".to_string()));
    }
    if order.payment_status == "pago" && force {
        return Err(AppError::BadRequest(
            "cannot regenerate pix charge after payment is confirmed".to_string(),
        ));
    }
    if order.pix_payment_id.is_some() && !force {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    let (pix, provider) = match payment_cfg.online_provider() {
        Some("mercado_pago") => {
            let token = payment_cfg.mp_access_token().unwrap();
            let payer_email = match q.customer_email.as_deref().map(str::trim) {
                Some(email) if email.contains('@') => Some(email.to_string()),
                _ => tenant::organization_email_for_tenant(&state.pool, &store.id).await?,
            };
            let pix = mercadopago::create_pix_charge(
                &state,
                token,
                &store.name,
                order.total,
                &order.customer_name,
                payer_email.as_deref(),
                &order.id,
            )
            .await?;
            (pix, "mercado_pago")
        }
        _ => {
            return Err(AppError::BadRequest(
                "Esta loja não tem Mercado Pago conectado — pagamento via Pix indisponível.".to_string(),
            ));
        }
    };

    sqlx::query(
        "UPDATE orders SET pix_payment_id = $1, pix_qr_base64 = $2, pix_copia_cola = $3, \
         pix_provider = $4, \
         payment_status = CASE WHEN payment_status = 'pago' THEN payment_status ELSE 'pendente' END, \
         payment_expires_at = now() + interval '30 minutes', \
         updated_at = now()::text \
         WHERE tenant_id = $5 AND id = $6",
    )
    .bind(&pix.payment_id)
    .bind(&pix.qr_code_base64)
    .bind(&pix.qr_code)
    .bind(provider)
    .bind(&store.id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    let dto = fetch_order_dto(&mut tx, &store.id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

fn mp_access_token_or_err(
    payment_cfg: &tenant::TenantPayment,
) -> Result<&str, AppError> {
    payment_cfg.mp_access_token().ok_or_else(|| {
        AppError::BadRequest(
            "Esta loja não tem Mercado Pago conectado — pagamento com cartão indisponível.".to_string(),
        )
    })
}

/// Cria o link de pagamento (Checkout Pro) pra um pedido `payment_method =
/// 'cartao'` com `card_payment_mode = 'link'` — o lojista (checkout público
/// ou PDV) manda essa URL pro cliente completar no celular DELE.
pub async fn create_card_link(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    if order.payment_method != "cartao" {
        return Err(AppError::BadRequest("order is not a card payment".to_string()));
    }
    if order.payment_status == "pago" {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    let token = mp_access_token_or_err(&payment_cfg)?;
    let back_url = format!(
        "{}/consultar?order={}",
        state.frontend_public_url.trim_end_matches('/'),
        order.id
    );
    let notification_url = if state.backend_public_url.is_empty() {
        None
    } else {
        Some(format!("{}/api/webhooks/mercadopago", state.backend_public_url.trim_end_matches('/')))
    };
    let link = mercadopago_link::create_payment_link(
        &state,
        token,
        &store.name,
        order.total,
        &order.id,
        &back_url,
        notification_url.as_deref(),
    )
    .await?;

    sqlx::query(
        "UPDATE orders SET card_payment_mode = 'link', card_payment_link_url = $1, \
         payment_expires_at = now() + interval '30 minutes', updated_at = now()::text \
         WHERE tenant_id = $2 AND id = $3",
    )
    .bind(&link.init_point)
    .bind(&store.id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    let dto = fetch_order_dto(&mut tx, &store.id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

#[derive(Debug, Deserialize)]
pub struct CreateCardPaymentInput {
    pub card_token: String,
    pub payment_method_id: String,
    #[serde(default = "default_installments")]
    pub installments: i32,
    #[serde(default)]
    pub payer_email: Option<String>,
}
fn default_installments() -> i32 {
    1
}

/// Checkout Transparente — cliente já tokenizou o cartão no navegador (SDK
/// oficial da Mercado Pago); aqui só cobra com o token resultante. PAN/CVV
/// crus nunca passam por este servidor.
pub async fn create_card_payment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateCardPaymentInput>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    if order.payment_method != "cartao" {
        return Err(AppError::BadRequest("order is not a card payment".to_string()));
    }
    if order.payment_status == "pago" {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    let token = mp_access_token_or_err(&payment_cfg)?;
    let payer_email = match input.payer_email.as_deref().map(str::trim) {
        Some(email) if email.contains('@') => email.to_string(),
        _ => tenant::organization_email_for_tenant(&state.pool, &store.id)
            .await?
            .unwrap_or_else(|| "cliente@resolutoo.com".to_string()),
    };
    let charge = mercadopago_link::create_card_payment(
        &state,
        token,
        &store.name,
        order.total,
        &input.card_token,
        &input.payment_method_id,
        input.installments,
        &payer_email,
        &order.id,
    )
    .await?;

    let approved = charge.status.eq_ignore_ascii_case("approved");
    sqlx::query(
        "UPDATE orders SET card_payment_mode = 'transparente', card_payment_charge_id = $1, \
         payment_status = CASE WHEN $2 THEN 'pago' ELSE payment_status END, updated_at = now()::text \
         WHERE tenant_id = $3 AND id = $4",
    )
    .bind(&charge.payment_id)
    .bind(approved)
    .bind(&store.id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    if approved {
        orders_common::decrement_stock_for_order(&mut *tx, &store.id, &id).await?;
    } else if !matches!(charge.status.as_str(), "in_process" | "pending") {
        tx.commit().await?;
        let detail = charge.status_detail.unwrap_or_default();
        return Err(AppError::BadRequest(format!(
            "Cartão recusado pela Mercado Pago ({}). Confira os dados ou tente outro cartão.",
            if detail.is_empty() { charge.status } else { detail }
        )));
    }

    let dto = fetch_order_dto(&mut tx, &store.id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

#[derive(Debug, Deserialize)]
pub struct ComputeRouteInput {
    pub de: Ponto,
    pub ate: Ponto,
}

/// Sem chave nenhuma no navegador: o frontend manda dois pontos, a gente
/// decide (Google Routes ou OSRM) e devolve o trajeto pronto. Usado pela
/// navegação do motoboy e pelo acompanhamento do cliente em /consultar.
/// Sem estado/tenant nenhum: a chave da Google Routes é global e
/// compartilhada por todos os tenants de propósito (nunca uma por loja).
pub async fn compute_route(
    State(state): State<AppState>,
    Json(input): Json<ComputeRouteInput>,
) -> Result<Json<RotaResult>, AppError> {
    let rota = google_routes::calcular_rota(&state, input.de, input.ate).await?;
    Ok(Json(rota))
}

#[derive(Debug, Deserialize)]
pub struct EstimateDeliveryInput {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, serde::Serialize)]
pub struct EstimateDeliveryDto {
    pub km: f64,
    pub price: f64,
    /// `false` quando a distância passa do raio máximo configurado em
    /// /admin/frete — nesse caso `price` ainda vem calculado (pra
    /// referência), mas a loja não deveria aceitar a entrega.
    pub within_range: bool,
    /// Tempo real de rota (Google Routes, com fallback OSRM) — já calculado
    /// por `google_routes::calcular_rota` mas descartado antes; exposto
    /// aqui pra dar ETA real ao cliente (nunca chutado).
    pub eta_minutes: i64,
}

/// Calcula o valor de entrega/coleta pro cliente, com o MESMO preço por
/// km cadastrado pelo lojista em /admin/frete (`shipping_settings`) —
/// usado tanto pelo checkout normal da vitrine quanto pela tool de
/// entrega/coleta do Assistente IA, pra nunca inventar um valor
/// diferente do que a loja já cobra de verdade.
pub async fn estimate_delivery(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<EstimateDeliveryInput>,
) -> Result<Json<EstimateDeliveryDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let settings: Option<(f64, Option<f64>, f64, f64)> = sqlx::query_as(
        "SELECT price_per_km, max_km, store_lat, store_lng FROM shipping_settings WHERE tenant_id = $1",
    )
    .bind(&store.id)
    .fetch_optional(&state.pool)
    .await?;
    let Some((price_per_km, max_km, store_lat, store_lng)) = settings else {
        return Err(AppError::BadRequest("loja ainda não configurou o frete (/admin/frete)".to_string()));
    };
    if store_lat == 0.0 && store_lng == 0.0 {
        return Err(AppError::BadRequest("loja ainda não cadastrou a localização própria em /admin/frete".to_string()));
    }

    let rota = google_routes::calcular_rota(
        &state,
        Ponto { lat: store_lat, lng: store_lng },
        Ponto { lat: input.lat, lng: input.lng },
    )
    .await?;

    let within_range = max_km.map(|max| rota.km <= max).unwrap_or(true);
    let price = (rota.km * price_per_km * 100.0).round() / 100.0;

    Ok(Json(EstimateDeliveryDto { km: rota.km, price, within_range, eta_minutes: rota.min }))
}

// ---------- Agendamento (marcar/desmarcar/editar horário) ----------
//
// Sem login, mesmo modelo de autorização de list_public_orders_by_phone
// acima (conhecer o telefone já é o limite razoável — é o mesmo telefone
// que a Evolution API confirma dono da conversa). Usado pelas tools
// agendar_horario/desmarcar_horario/editar_horario/consultar_agendamentos
// do Assistente IA (a-vrtek-gente).

#[derive(Debug, serde::Serialize)]
pub struct AppointmentDto {
    pub id: String,
    pub customer_name: Option<String>,
    pub scheduled_at: String,
    pub reason: String,
    pub status: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateAppointmentInput {
    pub customer_phone: String,
    #[serde(default)]
    pub customer_name: Option<String>,
    /// ISO 8601 com offset (ex: "2026-08-20T14:00:00-03:00") — sem offset
    /// explícito, assume horário de Brasília (mesmo fuso usado pra validar
    /// contra store_hours abaixo).
    pub scheduled_at: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateAppointmentInput {
    pub scheduled_at: String,
}

fn parse_scheduled_at(raw: &str) -> Result<chrono::DateTime<chrono::Utc>, AppError> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .map_err(|_| AppError::BadRequest("scheduled_at inválido — use ISO 8601 (ex: 2026-08-20T14:00:00-03:00)".to_string()))
}

/// Confere se `when` cai dentro do horário de funcionamento cadastrado
/// (mesma lógica de isScheduledOpenNow do frontend, só que validando uma
/// data/hora futura em vez de "agora"). Fuso fixo -03:00 (Brasília, sem
/// horário de verão desde 2019) — não depende de chrono-tz.
async fn validate_within_business_hours(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    when: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    let brasilia = chrono::FixedOffset::west_opt(3 * 3600).expect("fixed offset válido");
    let local = when.with_timezone(&brasilia);
    let day_of_week = local.weekday().num_days_from_sunday() as i16;
    let minutes_of_day = local.hour() as i32 * 60 + local.minute() as i32;

    let row: Option<(bool, serde_json::Value)> = sqlx::query_as(
        "SELECT is_open, intervals FROM store_hours WHERE tenant_id = $1 AND day_of_week = $2",
    )
    .bind(tenant_id)
    .bind(day_of_week)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((is_open, intervals)) = row else {
        return Err(AppError::BadRequest("loja ainda não cadastrou o horário de funcionamento".to_string()));
    };
    if !is_open {
        return Err(AppError::BadRequest("a loja não funciona nesse dia da semana".to_string()));
    }
    let intervals: Vec<StoreHourInterval> = serde_json::from_value(intervals).unwrap_or_default();
    let within = intervals.iter().any(|iv| {
        let parse = |s: &str| -> Option<i32> {
            let (h, m) = s.split_once(':')?;
            Some(h.parse::<i32>().ok()? * 60 + m.parse::<i32>().ok()?)
        };
        match (parse(&iv.opens_at), parse(&iv.closes_at)) {
            (Some(open), Some(close)) => minutes_of_day >= open && minutes_of_day < close,
            _ => false,
        }
    });
    if !within {
        return Err(AppError::BadRequest("esse horário está fora do funcionamento da loja".to_string()));
    }
    Ok(())
}

pub async fn create_appointment(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<CreateAppointmentInput>,
) -> Result<Json<AppointmentDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let phone: String = input.customer_phone.chars().filter(char::is_ascii_digit).collect();
    if phone.is_empty() {
        return Err(AppError::BadRequest("customer_phone é obrigatório".to_string()));
    }
    let scheduled_at = parse_scheduled_at(&input.scheduled_at)?;
    if scheduled_at <= chrono::Utc::now() {
        return Err(AppError::BadRequest("scheduled_at precisa ser no futuro".to_string()));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    validate_within_business_hours(&mut tx, &store.id, scheduled_at).await?;

    let row: (String, Option<String>, String, String, String) = sqlx::query_as(
        "INSERT INTO service_appointments (tenant_id, customer_phone, customer_name, scheduled_at, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, customer_name, scheduled_at::text, reason, status",
    )
    .bind(&store.id)
    .bind(&phone)
    .bind(&input.customer_name)
    .bind(scheduled_at)
    .bind(&input.reason)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AppointmentDto { id: row.0, customer_name: row.1, scheduled_at: row.2, reason: row.3, status: row.4 }))
}

pub async fn list_appointments_by_phone(
    State(state): State<AppState>,
    Path((slug, phone)): Path<(String, String)>,
) -> Result<Json<Vec<AppointmentDto>>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let rows: Vec<(String, Option<String>, String, String, String)> = sqlx::query_as(
        "SELECT id, customer_name, scheduled_at::text, reason, status FROM service_appointments \
         WHERE tenant_id = $1 AND customer_phone = $2 AND status = 'agendado' \
         ORDER BY scheduled_at ASC",
    )
    .bind(&store.id)
    .bind(&digits)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, customer_name, scheduled_at, reason, status)| AppointmentDto { id, customer_name, scheduled_at, reason, status })
            .collect(),
    ))
}

pub async fn update_appointment(
    State(state): State<AppState>,
    Path((slug, id)): Path<(String, String)>,
    Json(input): Json<UpdateAppointmentInput>,
) -> Result<Json<AppointmentDto>, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let scheduled_at = parse_scheduled_at(&input.scheduled_at)?;
    if scheduled_at <= chrono::Utc::now() {
        return Err(AppError::BadRequest("scheduled_at precisa ser no futuro".to_string()));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    validate_within_business_hours(&mut tx, &store.id, scheduled_at).await?;

    let row: Option<(String, Option<String>, String, String, String)> = sqlx::query_as(
        "UPDATE service_appointments SET scheduled_at = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND status = 'agendado'
         RETURNING id, customer_name, scheduled_at::text, reason, status",
    )
    .bind(&store.id)
    .bind(&id)
    .bind(scheduled_at)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;

    match row {
        Some((id, customer_name, scheduled_at, reason, status)) => {
            Ok(Json(AppointmentDto { id, customer_name, scheduled_at, reason, status }))
        }
        None => Err(AppError::NotFound("agendamento não encontrado (ou já cancelado)".to_string())),
    }
}

pub async fn cancel_appointment(
    State(state): State<AppState>,
    Path((slug, id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let store = tenant::tenant_for_slug(&state.pool, &slug).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let result = sqlx::query(
        "UPDATE service_appointments SET status = 'cancelado', updated_at = now() \
         WHERE tenant_id = $1 AND id = $2 AND status = 'agendado'",
    )
    .bind(&store.id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("agendamento não encontrado (ou já cancelado)".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct NotifyPdvSaleInput {
    pub order_id: String,
}

/// Confirmação de pagamento no balcão (msg 3): só depois que o pagamento
/// foi confirmado (dinheiro/cartão/Pix manual no caixa, ou Pix gateway
/// marcado como pago). Sem WhatsApp no pedido → sucesso silencioso (ainda
/// marca Pix pendente como pago quando aplicável).
pub async fn notify_pdv_sale(
    State(state): State<AppState>,
    Json(input): Json<NotifyPdvSaleInput>,
) -> Result<StatusCode, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &input.order_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &input.order_id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    if digits.is_empty() {
        // Sem WA: ainda confirma Pix pendente de balcão se for o caso.
        if order.payment_method == "pix" && order.payment_status != "pago" {
            sqlx::query(
                "UPDATE orders SET payment_status = 'pago', updated_at = now()::text \
                 WHERE tenant_id = $1 AND id = $2",
            )
            .bind(&store.id)
            .bind(&input.order_id)
            .execute(&mut *tx)
            .await?;
            orders_common::decrement_stock_for_order(&mut *tx, &store.id, &input.order_id).await?;
        }
        tx.commit().await?;
        return Ok(StatusCode::NO_CONTENT);
    }

    if order.payment_method == "pix" && order.payment_status != "pago" {
        sqlx::query(
            "UPDATE orders SET payment_status = 'pago', updated_at = now()::text \
             WHERE tenant_id = $1 AND id = $2",
        )
        .bind(&store.id)
        .bind(&input.order_id)
        .execute(&mut *tx)
        .await?;
        orders_common::decrement_stock_for_order(&mut *tx, &store.id, &input.order_id).await?;
    }

    let items = fetch_items(&mut *tx, &store.id, &order.id).await?;
    tx.commit().await?;
    let itens_texto = items
        .iter()
        .map(|i| format!("{}x {}", i.quantity, i.product_name))
        .collect::<Vec<_>>()
        .join("\n");

    let total_str = format!("{:.2}", order.total).replace('.', ",");
    let msg = format!("Obrigado pela compra na {}! 🌇\n\n{itens_texto}\n\nTotal: R$ {total_str}", store.name);

    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    Ok(StatusCode::NO_CONTENT)
}

/// PDV com WhatsApp + cobrança Pix: duas mensagens em sequência —
/// (1) resumo do carrinho/total sem EMV; (2) só o Pix copia-e-cola.
/// Confirmação de pagamento é outra rota (`notify_pdv_sale` /
/// `refresh_payment`) e só sai depois que o Pix foi pago de verdade.
pub async fn notify_pdv_pix_charge(
    State(state): State<AppState>,
    Json(input): Json<NotifyPdvSaleInput>,
) -> Result<StatusCode, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &input.order_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &input.order_id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    if digits.is_empty() {
        tx.commit().await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if order.payment_method != "pix" {
        return Err(AppError::BadRequest("order is not a pix payment".to_string()));
    }
    let Some(copia) = order.pix_copia_cola.clone().filter(|s| !s.is_empty()) else {
        return Err(AppError::BadRequest("pix charge not created yet".to_string()));
    };

    let items = fetch_items(&mut *tx, &store.id, &order.id).await?;
    tx.commit().await?;

    let itens_texto = items
        .iter()
        .map(|i| format!("{}x {}", i.quantity, i.product_name))
        .collect::<Vec<_>>()
        .join("\n");
    let total_str = format!("{:.2}", order.total).replace('.', ",");

    // Msg 1 — resumo da compra (sem copia-e-cola).
    let summary = format!(
        "Compra na {}\n\n{itens_texto}\n\nTotal: R$ {total_str}",
        store.name
    );
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &summary);

    // Msg 2 — imediatamente depois: só o EMV / copia-e-cola.
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &copia);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct NotifyPdvCardChargeInput {
    pub order_id: String,
    /// PDV deixa o lojista digitar/confirmar o WhatsApp do cliente na hora
    /// (a venda pode não ter sido criada com um número, ou o lojista quer
    /// mandar pra outro) — sempre usa ESSE número, nunca abre WhatsApp no
    /// aparelho do lojista (era o bug: `window.open` local mandava o
    /// PRÓPRIO lojista clicar "enviar").
    pub whatsapp: String,
    /// "Link de cobrança" (Checkout Pro — Pix/cartão/boleto, hospedado pela
    /// própria Mercado Pago). Pelo menos um dos dois tem que vir preenchido.
    #[serde(default)]
    pub link_url: Option<String>,
    /// "Link checkout" (nossa página `/pagamento/:id` — só cartão,
    /// tokenizado). O lojista pode mandar os dois pro mesmo cliente.
    #[serde(default)]
    pub checkout_url: Option<String>,
}

/// PDV — "Enviar link de cobrança" / "Enviar checkout": manda o link de
/// pagamento com cartão pro WhatsApp do CLIENTE através da instância
/// Evolution API já conectada da própria loja (mesmo mecanismo que já
/// manda confirmação de venda/Pix), nunca abrindo o WhatsApp no aparelho
/// do lojista.
pub async fn notify_pdv_card_charge(
    State(state): State<AppState>,
    Json(input): Json<NotifyPdvCardChargeInput>,
) -> Result<StatusCode, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &input.order_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &input.order_id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if order.payment_method != "cartao" {
        return Err(AppError::BadRequest("order is not a card payment".to_string()));
    }

    let digits = whatsapp::digits_only(&input.whatsapp);
    if digits.is_empty() {
        return Err(AppError::BadRequest("informe um WhatsApp válido".to_string()));
    }
    let link_url = input.link_url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let checkout_url = input.checkout_url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if link_url.is_none() && checkout_url.is_none() {
        return Err(AppError::BadRequest("escolha pelo menos uma forma de cobrança pra enviar".to_string()));
    }

    let items = fetch_items(&mut *tx, &store.id, &order.id).await?;
    tx.commit().await?;

    let itens_texto = items
        .iter()
        .map(|i| format!("{}x {}", i.quantity, i.product_name))
        .collect::<Vec<_>>()
        .join("\n");
    let total_str = format!("{:.2}", order.total).replace('.', ",");

    // Msg 1 — resumo do pedido. Msg 2/3 — cada link escolhido, um de cada
    // vez (o lojista pode mandar os dois). `notify_sequential` AGUARDA cada
    // envio terminar antes do próximo — sem isso as mensagens (disparadas
    // como tasks independentes) podiam chegar fora de ordem no WhatsApp.
    let summary = format!("Compra na {} (R$ {total_str})\n\n{itens_texto}", store.name);
    whatsapp::notify_sequential(&state, &store.whatsapp_instance, &digits, &summary).await;
    if let Some(url) = link_url {
        whatsapp::notify_sequential(&state, &store.whatsapp_instance, &digits, url).await;
    }
    if let Some(url) = checkout_url {
        whatsapp::notify_sequential(&state, &store.whatsapp_instance, &digits, url).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Só manda o WhatsApp de "pagamento confirmado" pra esse pedido — chamada
/// pela Vercel Edge Function depois que ELA já confirmou o pagamento no
/// Supabase (o Pix em si saiu do Rust/Railway, mas o envio de WhatsApp via
/// Evolution API continua aqui, de propósito).
pub async fn notify_payment_received(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    let mut vars = std::collections::HashMap::new();
    vars.insert("nome".to_string(), order.customer_name.clone());
    vars.insert("loja".to_string(), store.name.clone());
    let templated =
        crate::routes::eletronicos::render_whatsapp_template(&mut tx, &store.id, "order_payment_confirmed", &vars).await?;
    tx.commit().await?;

    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = templated.unwrap_or_else(|| {
        format!(
            "Recebemos seu pagamento! Seu pedido #{} já está sendo preparado. 🌇",
            short_id(&order.id)
        )
    });
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn refresh_payment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if order.payment_method != "pix" || order.payment_status == "pago" {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    let Some(payment_id) = order.pix_payment_id.clone() else {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    };

    let provider = order.pix_provider.as_deref().unwrap_or("");
    let paid = if provider == "mercado_pago" || (provider.is_empty() && payment_cfg.mp_access_token().is_some()) {
        let Some(token) = payment_cfg.mp_access_token() else {
            let dto = row_to_dto(&mut tx, &store.id, order).await?;
            tx.commit().await?;
            return Ok(Json(dto));
        };
        let status = mercadopago::get_payment_status(&state, token, &payment_id).await?;
        status.eq_ignore_ascii_case("approved")
    } else {
        false
    };

    if paid {
        sqlx::query("UPDATE orders SET payment_status = 'pago', updated_at = now()::text WHERE tenant_id = $1 AND id = $2")
            .bind(&store.id)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        // Only now (payment actually confirmed by the gateway) — never at
        // order/charge creation, or an unpaid Pix would already have
        // consumed stock.
        orders_common::decrement_stock_for_order(&mut *tx, &store.id, &id).await?;

        let digits = whatsapp::digits_only(&order.customer_whatsapp);
        if !digits.is_empty() {
            let msg = if order.delivery_type == "balcao" {
                let total_str = format!("{:.2}", order.total).replace('.', ",");
                format!(
                    "Pagamento confirmado na {}! Total: R$ {total_str}. Obrigado pela compra! 🌇",
                    store.name
                )
            } else {
                format!(
                    "Recebemos seu pagamento! Seu pedido #{} já está sendo preparado. 🌇",
                    short_id(&order.id)
                )
            };
            whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
        }
    }

    let dto = fetch_order_dto(&mut tx, &store.id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

/// Customer cancel from /consultar. Ownership = WhatsApp digits on the order
/// (same trust model as track-by-phone). Blocked once status reaches
/// "saiu para entrega" (`em_rota_de_entrega` / `entregas`).
pub async fn cancel_order(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CustomerCancelInput>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    let provided = whatsapp::digits_only(&input.whatsapp);
    let on_order = whatsapp::digits_only(&order.customer_whatsapp);
    if provided.is_empty() || provided != on_order {
        return Err(AppError::Forbidden(
            "whatsapp não confere com o pedido".to_string(),
        ));
    }

    if !cancel::customer_can_cancel(&order.status) {
        return Err(AppError::BadRequest(
            "não é possível cancelar após o pedido sair para entrega".to_string(),
        ));
    }

    cancel::apply_cancel(
        &state,
        &mut *tx,
        &store.id,
        &order,
        &payment_cfg,
        cancel::CancelInput {
            cancel_by: "cliente",
            cancel_reason: "Cancelado pelo cliente".to_string(),
            cancel_note: None,
        },
    )
    .await?;

    let dto = fetch_order_dto(&mut tx, &store.id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

pub async fn simulate_pix_paid(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    // CRÍTICO: checa o gateway de VERDADE configurado NESSA loja
    // especificamente — só permite simular quando essa loja não tem nenhum
    // gateway online real conectado (senão daria pra marcar qualquer pedido
    // pendente como pago sem pagar nada).
    let payment = tenant::load_tenant_payment(&state.pool, &store.id).await?;
    if payment.online_provider().is_some() {
        return Err(AppError::Forbidden(
            "esta loja tem um gateway de pagamento real conectado; simular pagamento está desabilitado".to_string(),
        ));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    if order.payment_method != "pix" {
        return Err(AppError::BadRequest("order is not a pix payment".to_string()));
    }

    if order.payment_status != "pago" {
        sqlx::query("UPDATE orders SET payment_status = 'pago', updated_at = now()::text WHERE tenant_id = $1 AND id = $2")
            .bind(&store.id)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        orders_common::decrement_stock_for_order(&mut *tx, &store.id, &id).await?;

        let digits = whatsapp::digits_only(&order.customer_whatsapp);
        let msg = format!(
            "Recebemos seu pagamento! Seu pedido #{} já está sendo preparado. 🌇",
            short_id(&order.id)
        );
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    let dto = fetch_order_dto(&mut tx, &store.id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

#[derive(Debug, Deserialize)]
pub struct RequestPasswordResetInput {
    pub whatsapp: String,
    pub tenant: String,
}

/// Público de propósito — cliente deslogado que esqueceu a senha ainda não
/// tem nenhum token. Gera o código de 3 dígitos via RPC no Supabase (schema
/// `resolutoo` — mesma base de `customer_register`/`customer_login`/
/// `customer_verify_reset_code`/`customer_reset_password`, ver
/// ecommerce/frontend/src/lib/supabasePublicApi.ts) e manda por WhatsApp
/// (só o backend Rust alcança a Evolution API, por isso esse passo não é
/// uma RPC pura chamada direto do navegador como as outras). Sempre
/// responde 204, mesmo se o whatsapp não tiver cadastro (a função RAISE
/// EXCEPTION nesse caso — tratado como silêncio de propósito) — não revela
/// quais números têm conta.
///
/// Bug corrigido: essa rota chamava `sunset._create_customer_reset_code`
/// via `state.pool` (o Postgres do Railway) — mas essa função nunca
/// existiu ali, só no Supabase (schema `resolutoo`, renomeado a partir do
/// antigo `sunset`/`ufersin`), então TODO pedido de recuperação falhava
/// silenciosamente (erro engolido por padrão, pra não revelar contas) e
/// nenhuma mensagem saía nunca.
///
/// Segundo bug corrigido: `whatsapp::notify` recebia instance="" fixo, e
/// `notify()` trata instance vazia como "WhatsApp não configurado" (short-
/// circuit silencioso, ver whatsapp.rs) — ou seja, mesmo com a RPC
/// funcionando, NENHUMA mensagem seria enviada, pra loja nenhuma. Agora usa
/// `store.whatsapp_instance` da própria loja, igual todo o resto do app.
pub async fn request_customer_password_reset(
    State(state): State<AppState>,
    Json(input): Json<RequestPasswordResetInput>,
) -> Result<StatusCode, AppError> {
    let Ok(store) = tenant::tenant_for_slug(&state.pool, &input.tenant).await else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if let Some((name, code)) = create_customer_reset_code(&state, &input.whatsapp, &store.id).await {
        let digits = whatsapp::digits_only(&input.whatsapp);
        let msg = format!(
            "Olá, {name}! Seu código de recuperação de senha é: {code}\n\nVale por 10 minutos."
        );
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Chama `resolutoo._create_customer_reset_code(p_whatsapp, p_tenant_id)`
/// via PostgREST no Supabase — essa função é `SECURITY DEFINER` sem GRANT
/// pra anon/authenticated (só alcançável com a service_role key), daqui,
/// nunca do navegador, igual ao padrão já usado em `storage.rs` pra upload
/// de imagem. `None` em qualquer falha (whatsapp sem cadastro nessa loja,
/// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurada, Supabase fora
/// do ar) — nunca propaga erro, pra manter a resposta 204 de sempre e não
/// revelar quais números têm conta.
async fn create_customer_reset_code(state: &AppState, whatsapp_raw: &str, tenant_id: &str) -> Option<(String, String)> {
    if state.supabase_url.is_empty() || state.supabase_service_key.is_empty() {
        tracing::warn!("customer password reset: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured");
        return None;
    }
    let base = state.supabase_url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/rpc/_create_customer_reset_code");
    tracing::info!("customer password reset: requesting code for whatsapp={whatsapp_raw} tenant={tenant_id}");
    let resp = match state
        .http
        .post(&url)
        .header("apikey", state.supabase_service_key.as_str())
        .header("Authorization", format!("Bearer {}", state.supabase_service_key))
        .header("Content-Profile", "resolutoo")
        .json(&serde_json::json!({ "p_whatsapp": whatsapp_raw, "p_tenant_id": tenant_id }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("customer password reset: supabase request failed: {e}");
            return None;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        // Cliente sem cadastro (RAISE EXCEPTION) é o caso normal/esperado
        // aqui — mas loga sempre (nunca o whatsapp completo em nível
        // error, só o status+corpo do Supabase) porque essa mesma rota
        // também esconderia silenciosamente uma falha real (Content-
        // Profile errado, GRANT faltando, etc.) sem esse log.
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("customer password reset: supabase rpc returned {status}: {body}");
        return None;
    }
    let rows: Vec<serde_json::Value> = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("customer password reset: supabase response parse error: {e}");
            return None;
        }
    };
    let Some(row) = rows.first() else {
        tracing::warn!("customer password reset: supabase rpc returned an empty row set");
        return None;
    };
    let name = row.get("customer_name").and_then(|v| v.as_str()).map(str::to_string);
    let code = row.get("code").and_then(|v| v.as_str()).map(str::to_string);
    if name.is_none() || code.is_none() {
        tracing::warn!("customer password reset: supabase rpc row missing customer_name/code: {row}");
        return None;
    }
    tracing::info!("customer password reset: code generated ok");
    Some((name.unwrap(), code.unwrap()))
}

#[derive(Debug, Deserialize)]
pub struct RequestLoginCodeInput {
    pub whatsapp: String,
    pub name: String,
    pub tenant: String,
}

/// Login único do cliente (mesmo formulário serve cadastro e login): nome +
/// whatsapp + código OTP mandado pelo WhatsApp da loja. Espelha
/// `request_customer_password_reset` — RPC `resolutoo._create_customer_login_code`
/// (SECURITY DEFINER, só service_role) cria o cliente se não existir e gera
/// o código de 6 dígitos; aqui é o único lugar que alcança a Evolution API
/// pra mandar de verdade. Sempre 204 (mesmo se a loja não tiver WhatsApp
/// configurado) -- nunca revela detalhe de erro pro cliente.
pub async fn request_customer_login_code(
    State(state): State<AppState>,
    Json(input): Json<RequestLoginCodeInput>,
) -> Result<StatusCode, AppError> {
    let Ok(store) = tenant::tenant_for_slug(&state.pool, &input.tenant).await else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if let Some((name, code)) = create_customer_login_code(&state, &input.whatsapp, &input.name, &store.id).await {
        let digits = whatsapp::digits_only(&input.whatsapp);
        let msg = format!("Olá, {name}! Seu código de acesso é: {code}\n\nVale por 10 minutos.");
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn create_customer_login_code(state: &AppState, whatsapp_raw: &str, name: &str, tenant_id: &str) -> Option<(String, String)> {
    if state.supabase_url.is_empty() || state.supabase_service_key.is_empty() {
        tracing::warn!("customer login code: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured");
        return None;
    }
    let base = state.supabase_url.trim_end_matches('/');
    let url = format!("{base}/rest/v1/rpc/_create_customer_login_code");
    let resp = match state
        .http
        .post(&url)
        .header("apikey", state.supabase_service_key.as_str())
        .header("Authorization", format!("Bearer {}", state.supabase_service_key))
        .header("Content-Profile", "resolutoo")
        .json(&serde_json::json!({ "p_whatsapp": whatsapp_raw, "p_name": name, "p_tenant_id": tenant_id }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("customer login code: supabase request failed: {e}");
            return None;
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("customer login code: supabase rpc returned {status}: {body}");
        return None;
    }
    let rows: Vec<serde_json::Value> = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("customer login code: supabase response parse error: {e}");
            return None;
        }
    };
    let Some(row) = rows.first() else {
        tracing::warn!("customer login code: supabase rpc returned an empty row set");
        return None;
    };
    let name = row.get("customer_name").and_then(|v| v.as_str()).map(str::to_string);
    let code = row.get("code").and_then(|v| v.as_str()).map(str::to_string);
    if name.is_none() || code.is_none() {
        tracing::warn!("customer login code: supabase rpc row missing customer_name/code: {row}");
        return None;
    }
    Some((name.unwrap(), code.unwrap()))
}

// rebuild-marker PDV Pix force 2026-08-01T17:20:00.6543400-03:00

#[derive(Debug, serde::Serialize)]
pub struct TenantVerticalDto {
    pub slug: String,
    pub vertical: String,
}

/// Registro público mínimo de "qual ramo esse tenant assinou" — usado por
/// serviços externos ao motor de e-commerce (ex.: a-vrtek-gente, que
/// atende WhatsApp de vários ramos e precisa saber qual adapter de dados
/// usar pra cada loja) sem precisar de acesso a nenhuma outra tabela.
/// Nunca expõe nada além do slug/vertical — sem dado de negócio real.
pub async fn get_public_tenant_vertical(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<TenantVerticalDto>, AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT vertical FROM tenants WHERE slug = $1")
            .bind(&slug)
            .fetch_optional(&state.pool)
            .await?;
    let Some((vertical,)) = row else {
        return Err(AppError::NotFound("tenant not found".to_string()));
    };
    Ok(Json(TenantVerticalDto { slug, vertical }))
}
