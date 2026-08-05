use axum::extract::State;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

use crate::auth::PdvUser;
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::models::{OrderDto, OrderRow, PdvSaleInput, ProductDto, ProductRow};
use crate::orders_common;
use crate::orders_common::fetch_order_dto;
use crate::state::AppState;
use crate::tenant;

const PRODUCT_SELECT: &str = "SELECT p.*, c.name as category_name FROM products p \
    LEFT JOIN categories c ON c.id = p.category_id";

/// Catálogo ativo do tenant — mesma fonte do CRUD admin, acessível por
/// admin ou vendedor JWT (PDV nunca deve ler o schema público Supabase).
pub async fn list_products(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
) -> Result<Json<Vec<ProductDto>>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProductRow> = sqlx::query_as(&format!(
        "{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.active <> 0 ORDER BY p.name"
    ))
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(ProductDto::from).collect()))
}

pub async fn create_sale(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
    Json(input): Json<PdvSaleInput>,
) -> Result<Json<OrderDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;

    if input.items.is_empty() {
        return Err(AppError::BadRequest("sale must have at least one item".to_string()));
    }
    if !matches!(input.payment_method.as_str(), "pix" | "cartao" | "dinheiro") {
        return Err(AppError::BadRequest("invalid payment_method".to_string()));
    }

    let name = input
        .customer_name
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Cliente balcão".to_string());
    let whatsapp = input
        .customer_whatsapp
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let mut subtotal = 0.0_f64;
    let mut line_items: Vec<(String, String, f64, i64)> = Vec::with_capacity(input.items.len());

    for item in &input.items {
        if item.quantity <= 0 {
            return Err(AppError::BadRequest("item quantity must be positive".to_string()));
        }
        // Lock the product row alone (LEFT JOIN + FOR UPDATE fails on nullable side).
        let locked: Option<(String,)> =
            sqlx::query_as("SELECT id FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE")
                .bind(&claims.tenant_id)
                .bind(&item.product_id)
                .fetch_optional(&mut *tx)
                .await?;
        if locked.is_none() {
            return Err(AppError::BadRequest(format!("product {} not found", item.product_id)));
        }
        let row: Option<ProductRow> = sqlx::query_as(&format!(
            "{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"
        ))
        .bind(&claims.tenant_id)
        .bind(&item.product_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(product) = row else {
            return Err(AppError::BadRequest(format!("product {} not found", item.product_id)));
        };
        if product.active == 0 {
            return Err(AppError::BadRequest(format!(
                "product {} is not available",
                product.name
            )));
        }
        if product.quantity < item.quantity {
            return Err(AppError::BadRequest(format!(
                "insufficient stock for product {}",
                product.name
            )));
        }
        subtotal += product.price * item.quantity as f64;
        line_items.push((
            product.id,
            product.name,
            product.price,
            item.quantity,
        ));
    }

    let mut discount = 0.0_f64;
    match input.discount_type.as_deref() {
        Some("percent") => discount = subtotal * (input.discount_value.unwrap_or(0.0)) / 100.0,
        Some("fixed") => discount = input.discount_value.unwrap_or(0.0),
        _ => {}
    }
    discount = discount.clamp(0.0, subtotal);
    let total = subtotal - discount;

    let mut customer_id: Option<String> = None;
    if let Some(ref wa) = whatsapp {
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM customers WHERE tenant_id = $1 AND whatsapp = $2",
        )
        .bind(&claims.tenant_id)
        .bind(wa)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((id,)) = existing {
            sqlx::query("UPDATE customers SET name = $1 WHERE tenant_id = $2 AND id = $3")
                .bind(&name)
                .bind(&claims.tenant_id)
                .bind(&id)
                .execute(&mut *tx)
                .await?;
            customer_id = Some(id);
        } else {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO customers (id, tenant_id, name, whatsapp) VALUES ($1, $2, $3, $4)",
            )
            .bind(&id)
            .bind(&claims.tenant_id)
            .bind(&name)
            .bind(wa)
            .execute(&mut *tx)
            .await?;
            customer_id = Some(id);
        }
    }

    let order_id = Uuid::new_v4().to_string();
    // Pix no balcão com QR fica pendente até o caixa confirmar (ou o
    // gateway marcar pago). Dinheiro/cartão já nascem pagos.
    let payment_status = if input.payment_method == "pix" {
        "pendente"
    } else {
        "pago"
    };
    sqlx::query(
        "INSERT INTO orders (\
            id, tenant_id, customer_id, customer_name, customer_whatsapp, delivery_type, \
            payment_method, payment_status, status, shipping_price, total, discount_amount, \
            sold_by_role, sold_by_id\
         ) VALUES (\
            $1, $2, $3, $4, $5, 'balcao', $6, $7, 'concluido', 0, $8, $9, $10, $11\
         )",
    )
    .bind(&order_id)
    .bind(&claims.tenant_id)
    .bind(&customer_id)
    .bind(&name)
    .bind(whatsapp.as_deref().unwrap_or(""))
    .bind(&input.payment_method)
    .bind(payment_status)
    .bind(total)
    .bind(discount)
    .bind(&claims.role)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await?;

    for (product_id, product_name, unit_price, quantity) in &line_items {
        let item_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name, unit_price, quantity) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&item_id)
        .bind(&claims.tenant_id)
        .bind(&order_id)
        .bind(product_id)
        .bind(product_name)
        .bind(unit_price)
        .bind(quantity)
        .execute(&mut *tx)
        .await?;
    }

    // Baixa de estoque só quando a venda já nasce paga (dinheiro/cartão —
    // instantâneo no balcão). Pix com QR fica `payment_status = 'pendente'`
    // acima: o estoque só sai quando o pagamento for de fato confirmado
    // (refresh_payment / notify_pdv_sale), nunca na criação da venda —
    // senão um Pix nunca pago já teria consumido o estoque.
    if payment_status == "pago" {
        orders_common::decrement_stock_for_order(&mut *tx, &claims.tenant_id, &order_id).await?;
    }

    let dto = fetch_order_dto(&mut tx, &claims.tenant_id, &order_id)
        .await?
        .ok_or_else(|| AppError::Internal("pdv sale vanished after insert".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

#[derive(Debug, Serialize)]
pub struct PdvSaleItemReport {
    pub product_name: String,
    pub quantity: i64,
    pub unit_price: f64,
}

#[derive(Debug, Serialize)]
pub struct PdvSaleReport {
    pub id: String,
    pub total: f64,
    pub payment_method: String,
    pub customer_name: String,
    pub created_at: String,
    pub sold_by_role: String,
    pub sold_by_id: Option<String>,
    pub sold_by_name: Option<String>,
    pub items: Vec<PdvSaleItemReport>,
}

#[derive(Debug, Serialize)]
pub struct VendedorRelatorioDto {
    pub total_sales: f64,
    pub total_count: i64,
    pub sales: Vec<PdvSaleReport>,
}

/// Relatório de vendas de balcão — mesma fonte do create_sale (DB do
/// tenant no Railway). Admin vê todas; vendedor só as próprias.
pub async fn relatorio(
    State(state): State<AppState>,
    PdvUser(claims): PdvUser,
) -> Result<Json<VendedorRelatorioDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let orders: Vec<OrderRow> = if claims.role == "admin" {
        sqlx::query_as(
            "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao' \
             ORDER BY created_at DESC LIMIT 100",
        )
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?
    } else {
        sqlx::query_as(
            "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao' \
             AND sold_by_role = 'vendedor' AND sold_by_id = $2 \
             ORDER BY created_at DESC LIMIT 100",
        )
        .bind(&claims.tenant_id)
        .bind(&claims.sub)
        .fetch_all(&mut *tx)
        .await?
    };

    let (total_sales, total_count): (f64, i64) = if claims.role == "admin" {
        sqlx::query_as(
            "SELECT COALESCE(SUM(total), 0)::double precision, COUNT(*)::bigint \
             FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao'",
        )
        .bind(&claims.tenant_id)
        .fetch_one(&mut *tx)
        .await?
    } else {
        sqlx::query_as(
            "SELECT COALESCE(SUM(total), 0)::double precision, COUNT(*)::bigint \
             FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao' \
             AND sold_by_role = 'vendedor' AND sold_by_id = $2",
        )
        .bind(&claims.tenant_id)
        .bind(&claims.sub)
        .fetch_one(&mut *tx)
        .await?
    };

    let mut sales = Vec::with_capacity(orders.len());
    for o in orders {
        let items: Vec<(String, i64, f64)> = sqlx::query_as(
            "SELECT product_name, quantity, unit_price FROM order_items \
             WHERE tenant_id = $1 AND order_id = $2",
        )
        .bind(&claims.tenant_id)
        .bind(&o.id)
        .fetch_all(&mut *tx)
        .await?;

        let sold_by_role = o.sold_by_role.clone().unwrap_or_else(|| "admin".to_string());
        let sold_by_name = match sold_by_role.as_str() {
            "admin" => Some("Admin".to_string()),
            "vendedor" => {
                // Sem tabela vendedores no motor Railway ainda — usa o id
                // curto pra o filtro de abas no front não ficar vazio.
                o.sold_by_id
                    .as_ref()
                    .map(|id| format!("Vendedor {}", &id[..id.len().min(8)]))
            }
            _ => None,
        };

        sales.push(PdvSaleReport {
            id: o.id,
            total: o.total,
            payment_method: o.payment_method,
            customer_name: o.customer_name,
            created_at: o.created_at,
            sold_by_role,
            sold_by_id: o.sold_by_id,
            sold_by_name,
            items: items
                .into_iter()
                .map(|(product_name, quantity, unit_price)| PdvSaleItemReport {
                    product_name,
                    quantity,
                    unit_price,
                })
                .collect(),
        });
    }

    tx.commit().await?;
    Ok(Json(VendedorRelatorioDto {
        total_sales,
        total_count,
        sales,
    }))
}
