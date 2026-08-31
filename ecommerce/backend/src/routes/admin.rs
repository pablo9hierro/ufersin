use axum::extract::{Multipart, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{hash_password, AdminTenant, AdminUser};
use crate::error::AppError;
use crate::features::{self, Feature};
use crate::formulation;
use crate::models::{
    Category, CategoryInput, FinanceiroSummary, LucroSummary, MotoboyDto, MotoboyInput, MotoboyRow,
    OrderDto, OrderRow, ProductDto, ProductInput, ProductRow, SetStoreHoursInput,
    SetStoreManualStatusInput, StatusCount, StoreHourDay, StoreHourInterval, StoreStatusDto,
    TopProduct, UpdateStatusInput,
};
use crate::mercadopago;
use crate::orders_common::{self, row_to_dto};
use crate::state::AppState;
use crate::status_flow;
use crate::storage;
use crate::tenant;
use crate::whatsapp;

// ---------- Categories ----------

/// Padroniza nome de categoria: primeira letra maiúscula, resto minúsculo
/// (ex.: "PABLO" / "pablo" / "PaBLo" -> "Pablo"). Junto com o UNIQUE
/// (tenant_id, name) já existente, isso barra duplicata por variação de
/// caixa sem precisar de constraint case-insensitive nova — depois de
/// normalizado, "PABLO" e "pablo" viram o mesmo texto e colidem sozinhos.
fn normalize_category_name(name: &str) -> String {
    let trimmed = name.trim();
    let mut chars = trimmed.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}

pub async fn list_categories(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<Category>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<Category> = sqlx::query_as("SELECT id, name FROM categories WHERE tenant_id = $1 ORDER BY name")
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn create_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CategoryInput>,
) -> Result<Json<Category>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let name = normalize_category_name(&input.name);
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ($1, $2, $3)")
        .bind(&id)
        .bind(&claims.tenant_id)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                AppError::BadRequest("essa categoria já existe".to_string())
            }
            other => other.into(),
        })?;
    tx.commit().await?;
    Ok(Json(Category { id, name }))
}

pub async fn update_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<CategoryInput>,
) -> Result<Json<Category>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let name = normalize_category_name(&input.name);
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("UPDATE categories SET name = $1 WHERE tenant_id = $2 AND id = $3")
        .bind(&name)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                AppError::BadRequest("essa categoria já existe".to_string())
            }
            other => other.into(),
        })?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("category not found".to_string()));
    }
    tx.commit().await?;
    Ok(Json(Category { id, name }))
}

pub async fn delete_category(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM categories WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("category not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Products ----------

const PRODUCT_SELECT: &str = "SELECT p.*, c.name as category_name FROM products p \
    LEFT JOIN categories c ON c.id = p.category_id";

pub async fn list_products(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<ProductDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<ProductRow> =
        sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 ORDER BY p.name"))
            .bind(&claims.tenant_id)
            .fetch_all(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(ProductDto::from).collect()))
}

pub async fn get_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<ProductDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<ProductRow> =
        sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
            .bind(&claims.tenant_id)
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    tx.commit().await?;
    match row {
        Some(r) => Ok(Json(r.into())),
        None => Err(AppError::NotFound("product not found".to_string())),
    }
}

pub async fn create_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<ProductInput>,
) -> Result<Json<ProductDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.active.unwrap_or(true);
    let barcode = input
        .barcode
        .as_ref()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active, cost_price, low_stock_threshold, barcode, phone_brand, phone_model) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.name)
    .bind(&input.description)
    .bind(input.price)
    .bind(input.quantity)
    .bind(&input.image_url)
    .bind(&input.category_id)
    .bind(active as i64)
    .bind(input.cost_price)
    .bind(input.low_stock_threshold)
    .bind(&barcode)
    .bind(&input.phone_brand)
    .bind(&input.phone_model)
    .execute(&mut *tx)
    .await?;

    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<ProductInput>,
) -> Result<Json<ProductDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let active = input.active.unwrap_or(true);
    let barcode = input
        .barcode
        .as_ref()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    // Produto ERP (`origin_type = 'erp_formulation'`) tem `quantity`/
    // `cost_price` CALCULADOS a partir da formulação (ver `formulation.rs`)
    // — bloqueio de verdade aqui no SQL, não só escondendo o campo no
    // frontend. Qualquer valor mandado pelo cliente pra esses dois campos é
    // simplesmente ignorado quando o produto é ERP.
    let result = sqlx::query(
        "UPDATE products SET name = $1, description = $2, price = $3, \
         quantity = CASE WHEN origin_type = 'erp_formulation' THEN quantity ELSE $4 END, \
         image_url = $5, category_id = $6, active = $7, \
         cost_price = CASE WHEN origin_type = 'erp_formulation' THEN cost_price ELSE $8 END, \
         low_stock_threshold = $9, barcode = $10, phone_brand = $11, phone_model = $12 \
         WHERE tenant_id = $13 AND id = $14",
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(input.price)
    .bind(input.quantity)
    .bind(&input.image_url)
    .bind(&input.category_id)
    .bind(active as i64)
    .bind(input.cost_price)
    .bind(input.low_stock_threshold)
    .bind(&barcode)
    .bind(&input.phone_brand)
    .bind(&input.phone_model)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("product not found".to_string()));
    }

    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

/// Multipart upload ("file" field) -> Supabase Storage, returns
/// `{"url": "..."}` to save as the product's image_url. Only the image
/// bytes ever leave the browser — the service_role key that authorizes the
/// write stays server-side.
pub async fn upload_product_image(
    State(state): State<AppState>,
    _admin: AdminTenant,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("invalid upload: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let ext = storage::extension_for(&content_type);
        let filename = format!("{}.{ext}", Uuid::new_v4());
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("invalid upload: {e}")))?;

        let url = storage::upload_image(&state, &filename, &content_type, bytes.to_vec()).await?;
        return Ok(Json(serde_json::json!({ "url": url })));
    }
    Err(AppError::BadRequest("no file field in upload".to_string()))
}

pub async fn delete_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM products WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("product not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- ERP Formulação (insumos / ficha técnica) ----------
//
// Produto ERP continua sendo um `products` normal (`origin_type =
// 'erp_formulation'`) — catálogo/vitrine/PDV leem exatamente como sempre
// leram. `quantity`/`cost_price` desse produto são sempre recalculados por
// `formulation::recompute_formulated_product`, nunca aceitos crus do
// cliente (ver guarda em `update_product` acima). Mesma feature flag de
// sempre (`Feature::Catalogo`) — não é uma flag nova.

pub async fn list_ingredients(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<crate::models::Ingredient>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows = sqlx::query_as(
        "SELECT id, name, unit, quantity, cost_price, low_stock_threshold FROM ingredients WHERE tenant_id = $1 ORDER BY name",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(rows))
}

pub async fn create_ingredient(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<crate::models::IngredientInput>,
) -> Result<Json<crate::models::Ingredient>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    // Valida a unidade cedo (mesma tabela de `formulation::convert`) —
    // erro claro na hora de cadastrar, não um insumo com unidade quebrada.
    formulation::convert(0.0, &input.unit, &input.unit)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO ingredients (id, tenant_id, name, unit, quantity, cost_price, low_stock_threshold) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(input.name.trim())
    .bind(&input.unit)
    .bind(input.quantity)
    .bind(input.cost_price)
    .bind(input.low_stock_threshold)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("já existe um insumo com esse nome".to_string())
        }
        other => other.into(),
    })?;
    tx.commit().await?;
    Ok(Json(crate::models::Ingredient {
        id,
        name: input.name.trim().to_string(),
        unit: input.unit,
        quantity: input.quantity,
        cost_price: input.cost_price,
        low_stock_threshold: input.low_stock_threshold,
    }))
}

pub async fn update_ingredient(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::IngredientInput>,
) -> Result<Json<crate::models::Ingredient>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    formulation::convert(0.0, &input.unit, &input.unit)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query(
        "UPDATE ingredients SET name = $1, unit = $2, quantity = $3, cost_price = $4, low_stock_threshold = $5 \
         WHERE tenant_id = $6 AND id = $7",
    )
    .bind(input.name.trim())
    .bind(&input.unit)
    .bind(input.quantity)
    .bind(input.cost_price)
    .bind(input.low_stock_threshold)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("já existe um insumo com esse nome".to_string())
        }
        other => other.into(),
    })?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("ingredient not found".to_string()));
    }
    // Custo/unidade podem ter mudado — todo produto ERP que usa esse
    // insumo precisa recalcular custo (e possivelmente disponibilidade, se
    // a unidade mudou).
    formulation::recompute_dependents(&mut tx, &claims.tenant_id, &id).await?;
    tx.commit().await?;
    Ok(Json(crate::models::Ingredient {
        id,
        name: input.name.trim().to_string(),
        unit: input.unit,
        quantity: input.quantity,
        cost_price: input.cost_price,
        low_stock_threshold: input.low_stock_threshold,
    }))
}

pub async fn delete_ingredient(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM ingredients WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.is_foreign_key_violation() => AppError::BadRequest(
                "esse insumo está em uso numa formulação — remova-o da formulação antes de excluir".to_string(),
            ),
            other => other.into(),
        })?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("ingredient not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Serviços (entidade separada de produto, sem estoque próprio) ----------
// Mora na página /produtos/servicos. Custo é só referência calculada a
// partir de insumos (mesma tabela `ingredients` do ERP Formulação) + custos
// extras livres — o preço final (`price`) é sempre digitado pelo lojista,
// nunca calculado automaticamente (diferente de produto ERP).

async fn load_service_dto(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    row: crate::models::ServiceRow,
) -> Result<crate::models::ServiceDto, AppError> {
    let ingredient_rows: Vec<(String, String, f64, String, f64, String)> = sqlx::query_as(
        "SELECT si.ingredient_id, i.name, si.quantity, si.unit, i.cost_price, i.unit \
         FROM service_ingredients si \
         JOIN ingredients i ON i.id = si.ingredient_id AND i.tenant_id = si.tenant_id \
         WHERE si.tenant_id = $1 AND si.service_id = $2",
    )
    .bind(tenant_id)
    .bind(&row.id)
    .fetch_all(&mut *tx)
    .await?;

    let mut estimated_cost = 0.0;
    let mut ingredients = Vec::with_capacity(ingredient_rows.len());
    for (ingredient_id, ingredient_name, quantity, unit, ingredient_cost_price, ingredient_unit) in ingredient_rows {
        if let Ok(converted) = formulation::convert(quantity, &unit, &ingredient_unit) {
            estimated_cost += converted * ingredient_cost_price;
        }
        ingredients.push(crate::models::ServiceIngredientDto {
            ingredient_id,
            ingredient_name,
            quantity,
            unit,
        });
    }

    let extra_cost_rows: Vec<(String, f64)> = sqlx::query_as(
        "SELECT label, value FROM service_extra_costs WHERE tenant_id = $1 AND service_id = $2",
    )
    .bind(tenant_id)
    .bind(&row.id)
    .fetch_all(&mut *tx)
    .await?;
    let extra_costs: Vec<crate::models::ServiceExtraCostDto> = extra_cost_rows
        .into_iter()
        .map(|(label, value)| {
            estimated_cost += value;
            crate::models::ServiceExtraCostDto { label, value }
        })
        .collect();

    // Disponibilidade: se tem insumo(s) ligado(s), é sempre calculada (o
    // insumo limitante manda, mesma lógica de produto ERP) — nunca a
    // `manual_quantity` nesse caso. Sem insumo, usa a quantidade manual
    // (se definida) — sem nenhum dos dois, disponibilidade "ilimitada"
    // (`None`, front não trava nem mostra alerta de estoque).
    let quantity_from_stock = !ingredients.is_empty();
    let available_quantity = if quantity_from_stock {
        formulation::compute_service_available_quantity(&mut *tx, tenant_id, &row.id).await?
    } else {
        row.manual_quantity
    };

    Ok(crate::models::ServiceDto {
        id: row.id,
        name: row.name,
        description: row.description,
        category_id: row.category_id,
        price: row.price,
        active: row.active != 0,
        estimated_cost,
        ingredients,
        extra_costs,
        available_quantity,
        low_stock_threshold: row.low_stock_threshold,
        manual_quantity: row.manual_quantity,
        quantity_from_stock,
        model_name: row.model_name,
        repair_type: row.repair_type,
    })
}

pub async fn list_services(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<crate::models::ServiceDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<crate::models::ServiceRow> = sqlx::query_as(
        "SELECT id, name, description, category_id, price, active, low_stock_threshold, manual_quantity, model_name, repair_type \
         FROM services WHERE tenant_id = $1 ORDER BY name",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut dtos = Vec::with_capacity(rows.len());
    for row in rows {
        dtos.push(load_service_dto(&mut tx, &claims.tenant_id, row).await?);
    }
    tx.commit().await?;
    Ok(Json(dtos))
}

async fn save_service_lines(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    service_id: &str,
    ingredients: &[crate::models::ServiceIngredientInput],
    extra_costs: &[crate::models::ServiceExtraCostInput],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM service_ingredients WHERE tenant_id = $1 AND service_id = $2")
        .bind(tenant_id)
        .bind(service_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM service_extra_costs WHERE tenant_id = $1 AND service_id = $2")
        .bind(tenant_id)
        .bind(service_id)
        .execute(&mut *tx)
        .await?;
    for line in ingredients {
        if line.quantity <= 0.0 {
            return Err(AppError::BadRequest("quantidade do insumo deve ser positiva".to_string()));
        }
        assert_line_within_stock(tx, tenant_id, &line.ingredient_id, line.quantity, &line.unit).await?;
        sqlx::query(
            "INSERT INTO service_ingredients (id, tenant_id, service_id, ingredient_id, quantity, unit) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(tenant_id)
        .bind(service_id)
        .bind(&line.ingredient_id)
        .bind(line.quantity)
        .bind(&line.unit)
        .execute(&mut *tx)
        .await?;
    }
    for extra in extra_costs {
        if extra.label.trim().is_empty() {
            continue;
        }
        sqlx::query("INSERT INTO service_extra_costs (id, tenant_id, service_id, label, value) VALUES ($1, $2, $3, $4, $5)")
            .bind(Uuid::new_v4().to_string())
            .bind(tenant_id)
            .bind(service_id)
            .bind(extra.label.trim())
            .bind(extra.value)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

pub async fn create_service(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<crate::models::ServiceInput>,
) -> Result<Json<crate::models::ServiceDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    // Quantidade manual só faz sentido sem insumo ligado — nesse caso a
    // disponibilidade é sempre calculada a partir do estoque.
    let manual_quantity = if input.ingredients.is_empty() { input.manual_quantity } else { None };
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO services (id, tenant_id, name, description, category_id, price, active, low_stock_threshold, manual_quantity, model_name, repair_type) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(input.name.trim())
    .bind(&input.description)
    .bind(&input.category_id)
    .bind(input.price)
    .bind(input.active.unwrap_or(true) as i32)
    .bind(input.low_stock_threshold)
    .bind(manual_quantity)
    .bind(&input.model_name)
    .bind(&input.repair_type)
    .execute(&mut *tx)
    .await?;
    save_service_lines(&mut tx, &claims.tenant_id, &id, &input.ingredients, &input.extra_costs).await?;

    let row = crate::models::ServiceRow {
        id: id.clone(),
        name: input.name.trim().to_string(),
        description: input.description.clone(),
        category_id: input.category_id.clone(),
        price: input.price,
        active: input.active.unwrap_or(true) as i32,
        low_stock_threshold: input.low_stock_threshold,
        manual_quantity,
        model_name: input.model_name.clone(),
        repair_type: input.repair_type.clone(),
    };
    let dto = load_service_dto(&mut tx, &claims.tenant_id, row).await?;
    tx.commit().await?;
    Ok(Json(dto))
}

pub async fn update_service(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::ServiceInput>,
) -> Result<Json<crate::models::ServiceDto>, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let manual_quantity = if input.ingredients.is_empty() { input.manual_quantity } else { None };
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query(
        "UPDATE services SET name = $1, description = $2, category_id = $3, price = $4, active = $5, \
         low_stock_threshold = $6, manual_quantity = $7, model_name = $8, repair_type = $9 \
         WHERE tenant_id = $10 AND id = $11",
    )
    .bind(input.name.trim())
    .bind(&input.description)
    .bind(&input.category_id)
    .bind(input.price)
    .bind(input.active.unwrap_or(true) as i32)
    .bind(input.low_stock_threshold)
    .bind(manual_quantity)
    .bind(&input.model_name)
    .bind(&input.repair_type)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("service not found".to_string()));
    }
    save_service_lines(&mut tx, &claims.tenant_id, &id, &input.ingredients, &input.extra_costs).await?;

    let row = crate::models::ServiceRow {
        id: id.clone(),
        name: input.name.trim().to_string(),
        description: input.description.clone(),
        category_id: input.category_id.clone(),
        price: input.price,
        active: input.active.unwrap_or(true) as i32,
        low_stock_threshold: input.low_stock_threshold,
        manual_quantity,
        model_name: input.model_name.clone(),
        repair_type: input.repair_type.clone(),
    };
    let dto = load_service_dto(&mut tx, &claims.tenant_id, row).await?;
    tx.commit().await?;
    Ok(Json(dto))
}

pub async fn delete_service(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM services WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("service not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// "Informar aumento de estoque" de um INSUMO — sempre soma (nunca
/// sobrescreve), registra no ledger, recalcula todo produto ERP dependente.
pub async fn ingredient_stock_entry(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::StockEntryInput>,
) -> Result<Json<crate::models::Ingredient>, AppError> {
    if input.quantity <= 0.0 {
        return Err(AppError::BadRequest("quantidade adicionada deve ser maior que zero".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("UPDATE ingredients SET quantity = quantity + $1 WHERE tenant_id = $2 AND id = $3")
        .bind(input.quantity)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("ingredient not found".to_string()));
    }
    sqlx::query(
        "INSERT INTO stock_movements (id, tenant_id, entity_type, entity_id, delta, reason) \
         VALUES ($1, $2, 'ingredient', $3, $4, 'manual_entry')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.quantity)
    .execute(&mut *tx)
    .await?;
    formulation::recompute_dependents(&mut tx, &claims.tenant_id, &id).await?;
    let row = sqlx::query_as(
        "SELECT id, name, unit, quantity, cost_price FROM ingredients WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

/// "Informar aumento de estoque" de um PRODUTO — só pra `origin_type =
/// 'manual'`. Produto ERP rejeita com 400 (o estoque dele é sempre
/// derivado dos insumos — nunca uma entrada manual).
pub async fn product_stock_entry(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::StockEntryInput>,
) -> Result<Json<ProductDto>, AppError> {
    if input.quantity <= 0.0 {
        return Err(AppError::BadRequest("quantidade adicionada deve ser maior que zero".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query(
        "UPDATE products SET quantity = quantity + $1 \
         WHERE tenant_id = $2 AND id = $3 AND origin_type = 'manual'",
    )
    .bind(input.quantity as i64)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        // Pode ser 404 (produto não existe) ou 400 (é ERP) — checa qual.
        let origin: Option<(String,)> =
            sqlx::query_as("SELECT origin_type FROM products WHERE tenant_id = $1 AND id = $2")
                .bind(&claims.tenant_id)
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
        return match origin {
            Some((o,)) if o == "erp_formulation" => Err(AppError::BadRequest(
                "estoque desse produto é calculado automaticamente pelos insumos".to_string(),
            )),
            _ => Err(AppError::NotFound("product not found".to_string())),
        };
    }
    sqlx::query(
        "INSERT INTO stock_movements (id, tenant_id, entity_type, entity_id, delta, reason) \
         VALUES ($1, $2, 'product', $3, $4, 'manual_entry')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&claims.tenant_id)
    .bind(&id)
    .bind(input.quantity)
    .execute(&mut *tx)
    .await?;
    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

/// Impede cadastrar/editar uma linha de formulação (produto OU serviço)
/// pedindo mais do que existe fisicamente em estoque do insumo — a
/// quantidade da linha é convertida (respeitando família de unidade,
/// `formulation::convert` já rejeita cross-family) pra unidade do insumo
/// antes de comparar com `ingredients.quantity`.
async fn assert_line_within_stock(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    ingredient_id: &str,
    line_quantity: f64,
    line_unit: &str,
) -> Result<(), AppError> {
    let ingredient: (String, f64, String) = sqlx::query_as(
        "SELECT name, quantity, unit FROM ingredients WHERE tenant_id = $1 AND id = $2",
    )
    .bind(tenant_id)
    .bind(ingredient_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::BadRequest("insumo não encontrado".to_string()))?;
    let (name, available, ingredient_unit) = ingredient;
    let requested_in_stock_unit = formulation::convert(line_quantity, line_unit, &ingredient_unit)?;
    if requested_in_stock_unit > available {
        return Err(AppError::BadRequest(format!(
            "quantidade de \"{name}\" ({line_quantity} {line_unit}) excede o estoque disponível ({available} {ingredient_unit})"
        )));
    }
    Ok(())
}

async fn save_formulation_lines(
    tx: &mut sqlx::PgConnection,
    tenant_id: &str,
    product_id: &str,
    lines: &[crate::models::FormulationLineInput],
) -> Result<(), AppError> {
    if lines.is_empty() {
        return Err(AppError::BadRequest("informe pelo menos um insumo na formulação".to_string()));
    }
    for line in lines {
        if line.quantity <= 0.0 {
            return Err(AppError::BadRequest("quantidade do insumo deve ser maior que zero".to_string()));
        }
        assert_line_within_stock(tx, tenant_id, &line.ingredient_id, line.quantity, &line.unit).await?;
        sqlx::query(
            "INSERT INTO product_formulations (id, tenant_id, product_id, ingredient_id, quantity, unit) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(tenant_id)
        .bind(product_id)
        .bind(&line.ingredient_id)
        .bind(line.quantity)
        .bind(&line.unit)
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                AppError::BadRequest("insumo repetido na formulação".to_string())
            }
            other => other.into(),
        })?;
    }
    formulation::recompute_formulated_product(tx, tenant_id, product_id).await
}

pub async fn create_formulated_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<crate::models::FormulatedProductInput>,
) -> Result<Json<ProductDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Catalogo).await?;
    if input.product.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.product.active.unwrap_or(true);
    let barcode = input
        .product
        .barcode
        .as_ref()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, description, price, quantity, image_url, category_id, active, cost_price, low_stock_threshold, barcode, origin_type) \
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, 0, $9, $10, 'erp_formulation')",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.product.name)
    .bind(&input.product.description)
    .bind(input.product.price)
    .bind(&input.product.image_url)
    .bind(&input.product.category_id)
    .bind(active as i64)
    .bind(input.product.low_stock_threshold)
    .bind(&barcode)
    .execute(&mut *tx)
    .await?;

    save_formulation_lines(&mut tx, &claims.tenant_id, &id, &input.formulation).await?;

    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_formulated_product(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::FormulatedProductInput>,
) -> Result<Json<ProductDto>, AppError> {
    if input.product.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let origin: Option<(String,)> =
        sqlx::query_as("SELECT origin_type FROM products WHERE tenant_id = $1 AND id = $2")
            .bind(&claims.tenant_id)
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?;
    match origin {
        None => return Err(AppError::NotFound("product not found".to_string())),
        Some((o,)) if o != "erp_formulation" => {
            return Err(AppError::BadRequest("esse produto não é um produto ERP".to_string()));
        }
        _ => {}
    }

    let active = input.product.active.unwrap_or(true);
    let barcode = input
        .product
        .barcode
        .as_ref()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    sqlx::query(
        "UPDATE products SET name = $1, description = $2, price = $3, image_url = $4, \
         category_id = $5, active = $6, low_stock_threshold = $7, barcode = $8 \
         WHERE tenant_id = $9 AND id = $10",
    )
    .bind(&input.product.name)
    .bind(&input.product.description)
    .bind(input.product.price)
    .bind(&input.product.image_url)
    .bind(&input.product.category_id)
    .bind(active as i64)
    .bind(input.product.low_stock_threshold)
    .bind(&barcode)
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM product_formulations WHERE tenant_id = $1 AND product_id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    save_formulation_lines(&mut tx, &claims.tenant_id, &id, &input.formulation).await?;

    let row: ProductRow = sqlx::query_as(&format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2"))
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

// ---------- Motoboys ----------

pub async fn list_motoboys(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<MotoboyDto>>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<MotoboyRow> = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 ORDER BY name")
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(MotoboyDto::from).collect()))
}

pub async fn get_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<Json<MotoboyDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: Option<MotoboyRow> = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    match row {
        Some(r) => Ok(Json(r.into())),
        None => Err(AppError::NotFound("motoboy not found".to_string())),
    }
}

pub async fn create_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<MotoboyInput>,
) -> Result<Json<MotoboyDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) else {
        return Err(AppError::BadRequest("password is required to create a motoboy".to_string()));
    };
    let hash = hash_password(password)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.active.unwrap_or(true);

    sqlx::query(
        "INSERT INTO motoboys (id, tenant_id, name, phone, email, password_hash, active) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.name)
    .bind(&input.phone)
    .bind(&input.email)
    .bind(&hash)
    .bind(active as i64)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("email already in use".to_string())
        }
        other => other.into(),
    })?;

    let row: MotoboyRow = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<MotoboyInput>,
) -> Result<Json<MotoboyDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let active = input.active.unwrap_or(true);

    if let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) {
        let hash = hash_password(password)?;
        let result = sqlx::query(
            "UPDATE motoboys SET name = $1, phone = $2, email = $3, password_hash = $4, active = $5 \
             WHERE tenant_id = $6 AND id = $7",
        )
        .bind(&input.name)
        .bind(&input.phone)
        .bind(&input.email)
        .bind(&hash)
        .bind(active as i64)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("motoboy not found".to_string()));
        }
    } else {
        let result = sqlx::query(
            "UPDATE motoboys SET name = $1, phone = $2, email = $3, active = $4 WHERE tenant_id = $5 AND id = $6",
        )
        .bind(&input.name)
        .bind(&input.phone)
        .bind(&input.email)
        .bind(active as i64)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("motoboy not found".to_string()));
        }
    }

    let row: MotoboyRow = sqlx::query_as("SELECT * FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn delete_motoboy(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM motoboys WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("motoboy not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Vendedores ----------
// BUG-020: tabela `vendedores` nunca existiu em produção -- cadastro de
// vendedor só existia como RPC do Supabase (ver ecommerce/frontend/src/lib/
// api.ts) apontando pra uma tabela inexistente. Mesmo padrão de motoboys.

pub async fn list_vendedores(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<crate::models::VendedorDto>>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<crate::models::VendedorRow> = sqlx::query_as("SELECT * FROM vendedores WHERE tenant_id = $1 ORDER BY name")
        .bind(&claims.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(crate::models::VendedorDto::from).collect()))
}

pub async fn create_vendedor(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<crate::models::VendedorInput>,
) -> Result<Json<crate::models::VendedorDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) else {
        return Err(AppError::BadRequest("password is required to create a vendedor".to_string()));
    };
    let hash = hash_password(password)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.active.unwrap_or(true);
    let commission_active = input.commission_active.unwrap_or(false);

    sqlx::query(
        "INSERT INTO vendedores (id, tenant_id, name, email, password_hash, active, commission_active, commission_percent) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.name)
    .bind(&input.email)
    .bind(&hash)
    .bind(active as i64)
    .bind(commission_active as i64)
    .bind(input.commission_percent)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("email already in use".to_string())
        }
        other => other.into(),
    })?;

    let row: crate::models::VendedorRow = sqlx::query_as("SELECT * FROM vendedores WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_vendedor(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::VendedorInput>,
) -> Result<Json<crate::models::VendedorDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let active = input.active.unwrap_or(true);
    let commission_active = input.commission_active.unwrap_or(false);

    if let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) {
        let hash = hash_password(password)?;
        let result = sqlx::query(
            "UPDATE vendedores SET name = $1, email = $2, password_hash = $3, active = $4, \
             commission_active = $5, commission_percent = $6 WHERE tenant_id = $7 AND id = $8",
        )
        .bind(&input.name)
        .bind(&input.email)
        .bind(&hash)
        .bind(active as i64)
        .bind(commission_active as i64)
        .bind(input.commission_percent)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("vendedor not found".to_string()));
        }
    } else {
        let result = sqlx::query(
            "UPDATE vendedores SET name = $1, email = $2, active = $3, commission_active = $4, \
             commission_percent = $5 WHERE tenant_id = $6 AND id = $7",
        )
        .bind(&input.name)
        .bind(&input.email)
        .bind(active as i64)
        .bind(commission_active as i64)
        .bind(input.commission_percent)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("vendedor not found".to_string()));
        }
    }

    let row: crate::models::VendedorRow = sqlx::query_as("SELECT * FROM vendedores WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn delete_vendedor(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM vendedores WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("vendedor not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Cozinha users ----------

pub async fn list_cozinha_users(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<crate::models::CozinhaUserDto>>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<crate::models::CozinhaUserRow> =
        sqlx::query_as("SELECT * FROM cozinha_users WHERE tenant_id = $1 ORDER BY name")
            .bind(&claims.tenant_id)
            .fetch_all(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(crate::models::CozinhaUserDto::from).collect()))
}

pub async fn create_cozinha_user(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<crate::models::CozinhaUserInput>,
) -> Result<Json<crate::models::CozinhaUserDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) else {
        return Err(AppError::BadRequest("password is required to create a cozinha user".to_string()));
    };
    let hash = hash_password(password)?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let id = Uuid::new_v4().to_string();
    let active = input.active.unwrap_or(true);

    sqlx::query(
        "INSERT INTO cozinha_users (id, tenant_id, name, email, password_hash, active) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(&claims.tenant_id)
    .bind(&input.name)
    .bind(&input.email)
    .bind(&hash)
    .bind(active as i64)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest("email already in use".to_string())
        }
        other => other.into(),
    })?;

    let row: crate::models::CozinhaUserRow =
        sqlx::query_as("SELECT * FROM cozinha_users WHERE tenant_id = $1 AND id = $2")
            .bind(&claims.tenant_id)
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn update_cozinha_user(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::CozinhaUserInput>,
) -> Result<Json<crate::models::CozinhaUserDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let active = input.active.unwrap_or(true);

    if let Some(password) = input.password.as_deref().filter(|p| !p.is_empty()) {
        let hash = hash_password(password)?;
        let result = sqlx::query(
            "UPDATE cozinha_users SET name = $1, email = $2, password_hash = $3, active = $4 \
             WHERE tenant_id = $5 AND id = $6",
        )
        .bind(&input.name)
        .bind(&input.email)
        .bind(&hash)
        .bind(active as i64)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("cozinha user not found".to_string()));
        }
    } else {
        let result = sqlx::query(
            "UPDATE cozinha_users SET name = $1, email = $2, active = $3 WHERE tenant_id = $4 AND id = $5",
        )
        .bind(&input.name)
        .bind(&input.email)
        .bind(active as i64)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("cozinha user not found".to_string()));
        }
    }

    let row: crate::models::CozinhaUserRow =
        sqlx::query_as("SELECT * FROM cozinha_users WHERE tenant_id = $1 AND id = $2")
            .bind(&claims.tenant_id)
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(row.into()))
}

pub async fn delete_cozinha_user(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query("DELETE FROM cozinha_users WHERE tenant_id = $1 AND id = $2")
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("cozinha user not found".to_string()));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Orders ----------

#[derive(Debug, Deserialize)]
pub struct OrdersQuery {
    pub status: Option<String>,
}

pub async fn list_orders(
    State(state): State<AppState>,
    crate::auth::AdminOrCozinhaUser(claims): crate::auth::AdminOrCozinhaUser,
    Query(q): Query<OrdersQuery>,
) -> Result<Json<Vec<OrderDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    // Pedidos é exclusivo de pedido feito na vitrine (entrega/retirada) — venda
    // de balcão (PDV) tem a própria tela (Vendas/relatório do PDV, ver
    // `list_pdv_sales` abaixo) e não deve aparecer misturada aqui, senão o
    // lojista confunde uma venda de balcão pendente de cartão com um pedido
    // online de verdade precisando de preparo/entrega.
    let rows: Vec<OrderRow> = match q.status {
        Some(status) => {
            sqlx::query_as(
                "SELECT * FROM orders WHERE tenant_id = $1 AND status = $2 AND delivery_type != 'balcao' \
                 ORDER BY created_at DESC",
            )
            .bind(&claims.tenant_id)
            .bind(status)
            .fetch_all(&mut *tx)
            .await?
        }
        None => {
            sqlx::query_as(
                "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type != 'balcao' \
                 ORDER BY created_at DESC",
            )
            .bind(&claims.tenant_id)
            .fetch_all(&mut *tx)
            .await?
        }
    };

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }
    tx.commit().await?;
    Ok(Json(result))
}

pub async fn update_order_status(
    State(state): State<AppState>,
    crate::auth::AdminOrCozinhaUser(claims): crate::auth::AdminOrCozinhaUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateStatusInput>,
) -> Result<Json<OrderDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let Some(order) = crate::orders_common::fetch_order_row(&mut *tx, &claims.tenant_id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if let Some(ref method) = input.payment_method {
        if !matches!(method.as_str(), "pix" | "cartao" | "dinheiro") {
            return Err(AppError::BadRequest(
                "payment_method must be pix, cartao or dinheiro".to_string(),
            ));
        }
    }

    // Optional settlement metadata (pay-at-pickup form) before transition.
    let payment_method = input
        .payment_method
        .as_deref()
        .unwrap_or(order.payment_method.as_str())
        .to_string();
    let customer_name = input
        .customer_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(order.customer_name.as_str())
        .to_string();
    let customer_whatsapp = input
        .customer_whatsapp
        .as_deref()
        .map(|s| s.chars().filter(|c| c.is_ascii_digit()).collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| order.customer_whatsapp.clone());

    let meta_changed = input.payment_method.is_some()
        || input.customer_name.is_some()
        || input.customer_whatsapp.is_some();
    if meta_changed {
        sqlx::query(
            "UPDATE orders SET payment_method = $1, customer_name = $2, customer_whatsapp = $3, \
             updated_at = now()::text WHERE tenant_id = $4 AND id = $5",
        )
        .bind(&payment_method)
        .bind(&customer_name)
        .bind(&customer_whatsapp)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }

    // Metadata-only PATCH (stay on same status) — used before generating PIX QR.
    if input.status == order.status {
        let row = crate::orders_common::fetch_order_row(&mut *tx, &claims.tenant_id, &id)
            .await?
            .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
        let dto = row_to_dto(&mut tx, &claims.tenant_id, row).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    // Essential admin delivery tray — Management/Premium keep delivery on the
    // motoboy queue; refuse admin `entregas` transitions when Motoboy is on.
    if status_flow::is_admin_delivery_transition(&order.status, &input.status) {
        if features::has_feature(&state.pool, &claims.tenant_id, Feature::Motoboy).await? {
            return Err(AppError::Forbidden(
                "entregas pelo admin só estão disponíveis em planos sem motoboy".to_string(),
            ));
        }
    }

    let set_paid = status_flow::admin_apply_transition(
        &order.status,
        &input.status,
        &order.delivery_type,
        &payment_method,
        &order.payment_status,
        input.payment_confirmed,
    )?;

    if set_paid {
        sqlx::query(
            "UPDATE orders SET status = $1, payment_status = 'pago', updated_at = now()::text \
             WHERE tenant_id = $2 AND id = $3",
        )
        .bind(&input.status)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        // Only now — payment just got manually confirmed by the admin
        // (cash/cartão presencial or Pix pago-na-retirada), never earlier.
        orders_common::decrement_stock_for_order(&mut *tx, &claims.tenant_id, &id).await?;
    } else {
        sqlx::query(
            "UPDATE orders SET status = $1, updated_at = now()::text WHERE tenant_id = $2 AND id = $3",
        )
        .bind(&input.status)
        .bind(&claims.tenant_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    }

    if input.status == "retiradas" {
        let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
        let digits = whatsapp::digits_only(&customer_whatsapp);
        let mut vars = std::collections::HashMap::new();
        vars.insert("nome".to_string(), customer_name.to_string());
        vars.insert("loja".to_string(), store.name.clone());
        vars.insert("endereco".to_string(), store.pickup_address.clone());
        let templated =
            crate::routes::eletronicos::render_whatsapp_template(&mut tx, &claims.tenant_id, "order_ready_pickup", &vars)
                .await?;
        let msg = templated.unwrap_or_else(|| {
            format!(
                "Seu pedido está pronto! Pode vir buscar 😊 Local de retirada: {}",
                store.pickup_address
            )
        });
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    if input.status == "entregas" {
        let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
        let digits = whatsapp::digits_only(&customer_whatsapp);
        let mut vars = std::collections::HashMap::new();
        vars.insert("nome".to_string(), customer_name.to_string());
        vars.insert("loja".to_string(), store.name.clone());
        let templated =
            crate::routes::eletronicos::render_whatsapp_template(&mut tx, &claims.tenant_id, "order_shipped", &vars).await?;
        let msg = templated.unwrap_or_else(|| {
            "Seu pedido saiu para entrega! Em breve você recebe. Qualquer dúvida, fale com a loja pelo WhatsApp."
                .to_string()
        });
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    let dto = crate::orders_common::fetch_order_dto(&mut tx, &claims.tenant_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;
    Ok(Json(dto))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    crate::auth::AdminOrCozinhaUser(claims): crate::auth::AdminOrCozinhaUser,
    Path(id): Path<String>,
    Json(input): Json<crate::models::AdminCancelInput>,
) -> Result<Json<OrderDto>, AppError> {
    let reason = input.reason.trim().to_string();
    let note = input.note.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);

    if reason == crate::cancel::ADMIN_REASON_OUTRO && note.is_none() {
        return Err(AppError::BadRequest(
            "justificativa obrigatória quando o motivo é Outro".to_string(),
        ));
    }
    if reason != crate::cancel::ADMIN_REASON_CLIENTE && reason != crate::cancel::ADMIN_REASON_OUTRO {
        return Err(AppError::BadRequest(
            "motivo inválido — use \"A pedido do cliente\" ou \"Outro\"".to_string(),
        ));
    }

    let payment = tenant::load_tenant_payment(&state.pool, &claims.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let Some(order) = crate::orders_common::fetch_order_row(&mut *tx, &claims.tenant_id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if !crate::cancel::admin_can_cancel(&order.status) {
        return Err(AppError::BadRequest(
            "não é possível cancelar um pedido concluído ou já cancelado".to_string(),
        ));
    }

    crate::cancel::apply_cancel(
        &state,
        &mut *tx,
        &claims.tenant_id,
        &order,
        &payment,
        crate::cancel::CancelInput {
            cancel_by: "admin",
            cancel_reason: reason,
            cancel_note: note,
        },
    )
    .await?;

    let dto = crate::orders_common::fetch_order_dto(&mut tx, &claims.tenant_id, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("order not found".to_string()))?;
    tx.commit().await?;

    // Notify customer (best-effort).
    let store = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let mut vtx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let mut vars = std::collections::HashMap::new();
    vars.insert("nome".to_string(), order.customer_name.clone());
    vars.insert("loja".to_string(), store.name.clone());
    let templated =
        crate::routes::eletronicos::render_whatsapp_template(&mut vtx, &claims.tenant_id, "order_cancelled", &vars).await?;
    vtx.commit().await?;
    let msg = templated.unwrap_or_else(|| "Seu pedido foi cancelado pela loja. Se pagou via Pix online, o estorno é automático quando a loja usa Mercado Pago; caso contrário a loja acerta a devolução manualmente.".to_string());
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);

    Ok(Json(dto))
}

// ---------- Financeiro ----------

pub async fn financeiro(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<FinanceiroSummary>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    let total_revenue: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(total), 0)::double precision FROM orders \
         WHERE tenant_id = $1 AND payment_status = 'pago'",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;

    let total_orders: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM orders WHERE tenant_id = $1")
        .bind(&claims.tenant_id)
        .fetch_one(&mut *tx)
        .await?;

    let status_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*) FROM orders WHERE tenant_id = $1 GROUP BY status",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let orders_by_status = status_rows
        .into_iter()
        .map(|(status, count)| StatusCount { status, count })
        .collect();

    // SUM() over bigint/double precision in Postgres returns numeric, so the
    // aggregates are cast explicitly back to the types sqlx expects here.
    let top_rows: Vec<(String, String, i64, f64)> = sqlx::query_as(
        "SELECT oi.product_id, oi.product_name, SUM(oi.quantity)::bigint as qty, \
         SUM(oi.unit_price * oi.quantity)::double precision as rev \
         FROM order_items oi JOIN orders o ON o.id = oi.order_id \
         WHERE o.tenant_id = $1 AND o.payment_status = 'pago' \
         GROUP BY oi.product_id, oi.product_name ORDER BY qty DESC LIMIT 10",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let top_products = top_rows
        .into_iter()
        .map(|(product_id, product_name, quantity_sold, revenue)| TopProduct {
            product_id,
            product_name,
            quantity_sold,
            revenue,
        })
        .collect();

    let recent_rows: Vec<OrderRow> = sqlx::query_as(
        "SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut recent_orders = Vec::with_capacity(recent_rows.len());
    for row in recent_rows {
        recent_orders.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }

    let pdv_rows: Vec<OrderRow> = sqlx::query_as(
        "SELECT * FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao' \
         ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    let (pdv_total_sales, pdv_total_count): (f64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total), 0)::double precision, COUNT(*)::bigint \
         FROM orders WHERE tenant_id = $1 AND delivery_type = 'balcao'",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    let mut pdv_sales = Vec::with_capacity(pdv_rows.len());
    for row in pdv_rows {
        pdv_sales.push(row_to_dto(&mut tx, &claims.tenant_id, row).await?);
    }

    tx.commit().await?;

    Ok(Json(FinanceiroSummary {
        total_revenue: total_revenue.0,
        total_orders: total_orders.0,
        orders_by_status,
        top_products,
        recent_orders,
        pdv_sales,
        pdv_total_sales,
        pdv_total_count,
        total_discount_given: 0.0,
        motoboys: vec![],
        avg_delivery_minutes: 0.0,
    }))
}

#[derive(Debug, Deserialize)]
pub struct LucroQuery {
    /// YYYY-MM-DD inclusive
    pub from: String,
    /// YYYY-MM-DD inclusive
    pub to: String,
}

fn valid_iso_date(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let b = s.as_bytes();
    b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// Custo e lucro no intervalo. Inclui vendas de site e PDV (balcão) —
/// qualquer pedido com payment_status = 'pago'.
pub async fn financeiro_lucro(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Query(q): Query<LucroQuery>,
) -> Result<Json<LucroSummary>, AppError> {
    if !valid_iso_date(&q.from) || !valid_iso_date(&q.to) {
        return Err(AppError::BadRequest(
            "from/to must be YYYY-MM-DD".to_string(),
        ));
    }
    if q.from > q.to {
        return Err(AppError::BadRequest(
            "from must be <= to".to_string(),
        ));
    }

    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;

    // created_at é TEXT (now()::text); cast pra timestamptz cobre o intervalo
    // inclusivo [from 00:00, to+1day).
    let receita_row: (f64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(total), 0)::double precision, COUNT(*)::bigint \
         FROM orders \
         WHERE tenant_id = $1 AND payment_status = 'pago' \
           AND created_at::timestamptz >= $2::date \
           AND created_at::timestamptz < ($3::date + interval '1 day')",
    )
    .bind(&claims.tenant_id)
    .bind(&q.from)
    .bind(&q.to)
    .fetch_one(&mut *tx)
    .await?;

    let custo_row: (f64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(oi.quantity::double precision * COALESCE(p.cost_price, 0)), 0)::double precision \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id \
         WHERE o.tenant_id = $1 AND o.payment_status = 'pago' \
           AND o.created_at::timestamptz >= $2::date \
           AND o.created_at::timestamptz < ($3::date + interval '1 day')",
    )
    .bind(&claims.tenant_id)
    .bind(&q.from)
    .bind(&q.to)
    .fetch_one(&mut *tx)
    .await?;

    let incomplete: (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint \
         FROM order_items oi \
         JOIN orders o ON o.id = oi.order_id \
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id \
         WHERE o.tenant_id = $1 AND o.payment_status = 'pago' \
           AND o.created_at::timestamptz >= $2::date \
           AND o.created_at::timestamptz < ($3::date + interval '1 day') \
           AND (p.cost_price IS NULL)",
    )
    .bind(&claims.tenant_id)
    .bind(&q.from)
    .bind(&q.to)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let receita = receita_row.0;
    let custo = custo_row.0;
    Ok(Json(LucroSummary {
        from: q.from,
        to: q.to,
        receita,
        custo,
        lucro: receita - custo,
        orders_count: receita_row.1,
        incomplete_cost: incomplete.0 > 0,
    }))
}

#[derive(Debug, Deserialize)]
pub struct NotifyOrderInput {
    pub order_id: String,
}

/// Fired by the frontend right after moving an order to pedido_pronto.
/// Message text is built here (not trusted from the client) and varies by
/// delivery_type.
pub async fn notify_order_ready(
    State(state): State<AppState>,
    admin: AdminTenant,
    Json(input): Json<NotifyOrderInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &admin.tenant_id).await?;
    let Some(order) =
        crate::orders_common::fetch_order_row(&mut *tx, &admin.tenant_id, &input.order_id).await?
    else {
        return Err(AppError::NotFound("order not found".to_string()));
    };
    tx.commit().await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = if order.delivery_type == "retirada" {
        format!(
            "Olá, {}! Seu pedido está pronto para retirada 🎉 Te esperamos na loja!",
            order.customer_name
        )
    } else if features::has_feature(&state.pool, &admin.tenant_id, Feature::Motoboy).await? {
        format!(
            "Olá, {}! Seu pedido está pronto 🎉 Em breve o motoboy vai te chamar aqui pedindo sua localização.",
            order.customer_name
        )
    } else {
        format!(
            "Olá, {}! Seu pedido está pronto 🎉 Estamos organizando a entrega — a loja te avisa quando sair.",
            order.customer_name
        )
    };
    whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct NotifyCouponGrantInput {
    pub coupon_id: String,
    /// Template opcional do admin, com /nome e /cupom pra substituir por
    /// cliente — quando ausente, cai no texto automático de sempre. O link
    /// do site é sempre acrescentado no fim, não importa o que o admin
    /// escreveu.
    pub custom_message: Option<String>,
}

/// Fired right after the admin creates a cupom alvo (targeted coupon) from
/// a CRM filter, unless "não notificar clientes" was checked. Sends one
/// WhatsApp message per contemplated customer from the store's own
/// instance — same pattern as notify_order_ready, message built here so
/// the client can't spoof the discount text.
pub async fn notify_coupon_grant(
    State(state): State<AppState>,
    admin: AdminTenant,
    Json(input): Json<NotifyCouponGrantInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Cupons).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &admin.tenant_id).await?;

    let coupon: Option<(String, String, Option<String>, Option<f64>, i64)> = sqlx::query_as(
        "SELECT code, kind, discount_type, discount_value, notify_customers FROM coupons \
         WHERE tenant_id = $1 AND id = $2",
    )
    .bind(&admin.tenant_id)
    .bind(&input.coupon_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let Some((code, kind, discount_type, discount_value, notify_customers)) = coupon else {
        return Err(AppError::NotFound("coupon not found".to_string()));
    };
    if notify_customers == 0 {
        return Ok(StatusCode::NO_CONTENT);
    }

    let discount_text = match (discount_type.as_deref(), discount_value) {
        (Some("percent"), Some(v)) => format!("{v}%"),
        (Some("fixed"), Some(v)) => format!("R$ {}", format!("{v:.2}").replace('.', ",")),
        _ => "desconto".to_string(),
    };
    let on_shipping = if kind == "frete" { " no frete" } else { "" };
    let default_msg = format!(
        "Você ganhou um cupom de desconto{on_shipping} na {}! 🎁\n\nCódigo: {code}\nDesconto: {discount_text}\n\nÉ só usar no checkout do site.",
        store.name
    );

    let recipients: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT DISTINCT g.customer_whatsapp, c.name
         FROM coupon_grants g
         LEFT JOIN customers c ON c.whatsapp = g.customer_whatsapp AND c.tenant_id = g.tenant_id
         WHERE g.tenant_id = $1 AND g.coupon_id = $2",
    )
    .bind(&admin.tenant_id)
    .bind(&input.coupon_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    tx.commit().await?;

    for (phone, name) in recipients {
        let digits = whatsapp::digits_only(&phone);
        if digits.is_empty() {
            continue;
        }
        let msg = match &input.custom_message {
            Some(template) if !template.trim().is_empty() => {
                let filled = template
                    .replace("/nome", name.as_deref().unwrap_or("cliente"))
                    .replace("/cupom", &code);
                format!("{filled}\n\n{}", state.frontend_public_url)
            }
            _ => default_msg.clone(),
        };
        whatsapp::notify(&state, &store.whatsapp_instance, &digits, &msg);
    }

    Ok(StatusCode::NO_CONTENT)
}

// Admin auth: JWT (Resolutoo) ou sessão sunset (legado) via AdminTenant.

async fn log_whatsapp_event(
    pool: &sqlx::PgPool,
    tenant_id: &str,
    event_type: &str,
    previous_state: Option<&str>,
    new_state: Option<&str>,
) -> Result<(), AppError> {
    // Sempre via tenant_tx: RLS da tabela exige app.tenant_id. Pool cru
    // sem set_config gravava zero linhas / falhava em silêncio — Status
    // "Conectado" (Evolution) com histórico vazio.
    let mut tx = tenant::tenant_tx(pool, tenant_id).await?;
    // Evita spam: só grava se o new_state mudou em relação ao último evento.
    let last: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT new_state FROM whatsapp_connection_events \
         WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    if last.as_ref().and_then(|r| r.0.as_deref()) == new_state {
        tx.commit().await?;
        return Ok(());
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO whatsapp_connection_events (id, tenant_id, event_type, previous_state, new_state) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(event_type)
    .bind(previous_state)
    .bind(new_state)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn extract_wa_state(status: &serde_json::Value) -> String {
    status
        .pointer("/instance/state")
        .or_else(|| status.get("state"))
        .and_then(|v| v.as_str())
        .unwrap_or("desconhecido")
        .to_string()
}

pub async fn whatsapp_status(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let status = whatsapp::connection_status(&state, &store.whatsapp_instance).await?;
    let new_state = extract_wa_state(&status);
    tracing::info!(
        "wa_status: tenant_id={} instance={} state={new_state}",
        admin.tenant_id,
        store.whatsapp_instance
    );
    let event_type = if new_state == "open" {
        "connected"
    } else if matches!(new_state.as_str(), "close" | "closed" | "logout") {
        "disconnected"
    } else {
        "status"
    };
    // Só registra connected/disconnected (transições relevantes pro histórico).
    if event_type != "status" {
        if let Err(e) = log_whatsapp_event(
            &state.pool,
            &admin.tenant_id,
            event_type,
            None,
            Some(&new_state),
        )
        .await
        {
            tracing::warn!("whatsapp event log failed: {e:?}");
        }
    }
    Ok(Json(status))
}

pub async fn whatsapp_connect(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let payload = whatsapp::connect(&state, &store.whatsapp_instance).await?;
    if let Err(e) = log_whatsapp_event(
        &state.pool,
        &admin.tenant_id,
        "qr",
        None,
        Some("qr"),
    )
    .await
    {
        tracing::warn!("whatsapp qr event log failed: {e:?}");
    }
    Ok(Json(payload))
}

pub async fn whatsapp_logout(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    whatsapp::logout(&state, &store.whatsapp_instance).await?;
    if let Err(e) = log_whatsapp_event(
        &state.pool,
        &admin.tenant_id,
        "disconnected",
        Some("open"),
        Some("close"),
    )
    .await
    {
        tracing::warn!("whatsapp disconnect event log failed: {e:?}");
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, serde::Serialize)]
pub struct WhatsAppConnectionEventDto {
    pub id: String,
    pub event_type: String,
    pub previous_state: Option<String>,
    pub new_state: Option<String>,
    /// RFC3339 — string estável pro front (`new Date(created_at)`).
    pub created_at: String,
}

pub async fn list_whatsapp_connection_events(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<Vec<WhatsAppConnectionEventDto>>, AppError> {
    // AdminTenant (JWT Railway OU sessão sunset) — igual status/connect.
    // AdminUser-only 401 em sessão legado + pool sem tenant_tx = histórico
    // vazio enquanto o card de Status mostrava "Conectado".
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &admin.tenant_id).await?;
    let rows: Vec<(String, String, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT id, event_type, previous_state, new_state, created_at \
             FROM whatsapp_connection_events WHERE tenant_id = $1 \
             ORDER BY created_at DESC LIMIT 100",
        )
        .bind(&admin.tenant_id)
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, event_type, previous_state, new_state, created_at)| {
                WhatsAppConnectionEventDto {
                    id,
                    event_type,
                    previous_state,
                    new_state,
                    created_at: created_at.to_rfc3339(),
                }
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct SimulateAssistantIaMessageInput {
    pub phone: String,
    pub text: String,
    #[serde(default)]
    pub customer_name: Option<String>,
}

/// Injeta uma mensagem sintética no MESMO pipeline que uma mensagem real de
/// WhatsApp aciona (`crate::routes::webhooks::send_to_assistant_ia` — mesmo
/// endpoint, mesmo payload) — usado pelo botão "Novo Chat"/caixa de envio
/// em /admin/chat pra testar a Assistente IA sem precisar de um segundo
/// número de WhatsApp de verdade. `tenant_slug`/`instance` NUNCA vêm do
/// cliente — sempre resolvidos aqui a partir do tenant autenticado, pra um
/// admin nunca conseguir injetar mensagem na conversa de outro tenant.
/// Diferente do forward de webhook real (fire-and-forget): aqui é um clique
/// direto do admin, então aguarda e propaga erro de verdade se o
/// assistant-ia estiver fora do ar.
pub async fn simulate_assistant_ia_message(
    State(state): State<AppState>,
    admin: AdminTenant,
    Json(input): Json<SimulateAssistantIaMessageInput>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let phone = input.phone.trim();
    let text = input.text.trim();
    if phone.is_empty() || text.is_empty() {
        return Err(AppError::BadRequest("phone e text são obrigatórios".to_string()));
    }
    let store = tenant::load_tenant(&state.pool, &admin.tenant_id).await?;
    let slug: Option<(String,)> = sqlx::query_as("SELECT slug FROM tenants WHERE id = $1")
        .bind(&admin.tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((slug,)) = slug else {
        return Err(AppError::Internal("tenant sem slug".to_string()));
    };
    crate::routes::webhooks::send_to_assistant_ia(
        &state,
        &slug,
        &store.whatsapp_instance,
        phone,
        Some(text),
        None,
        input.customer_name.as_deref(),
        true,
        false,
    )
    .await
    .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Resolve o slug do tenant autenticado e monta a base URL do assistant-ia —
/// usado por todos os proxies abaixo, mesma resolução de
/// `simulate_assistant_ia_message`.
async fn assistant_ia_base_and_slug(state: &AppState, tenant_id: &str) -> Result<(String, String), AppError> {
    let assistant_ia_url = std::env::var("ASSISTANT_IA_URL").unwrap_or_default();
    if assistant_ia_url.trim().is_empty() {
        return Err(AppError::Internal("ASSISTANT_IA_URL not configured".to_string()));
    }
    let slug: Option<(String,)> = sqlx::query_as("SELECT slug FROM tenants WHERE id = $1")
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await?;
    let Some((slug,)) = slug else {
        return Err(AppError::Internal("tenant sem slug".to_string()));
    };
    Ok((assistant_ia_url.trim_end_matches('/').to_string(), slug))
}

/// Chave compartilhada que só backends conhecem (nunca chega ao navegador)
/// — assistant-ia recusa qualquer chamada administrativa sem ela. Ver
/// `internalAuthGate` no lado do assistant-ia (repo `a-vrtek-gente`).
fn assistant_ia_internal_key() -> Result<String, AppError> {
    let key = std::env::var("ASSISTANT_IA_INTERNAL_KEY").unwrap_or_default();
    if key.trim().is_empty() {
        return Err(AppError::Internal("ASSISTANT_IA_INTERNAL_KEY not configured".to_string()));
    }
    Ok(key)
}

/// Proxies autenticados (AdminTenant) pro inbox `/admin/chat` — o browser
/// nunca fala com o assistant-ia direto nem conhece a chave interna dele.
/// `tenant_slug` sempre resolvido a partir do tenant autenticado, nunca do
/// cliente, então um admin nunca alcança a conversa de outro tenant mesmo
/// sabendo o id/slug alheio.
pub async fn assistant_ia_conversations(
    State(state): State<AppState>,
    admin: AdminTenant,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let (base, slug) = assistant_ia_base_and_slug(&state, &admin.tenant_id).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .get(format!("{base}/api/tenants/{slug}/conversations"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(body))
}

pub async fn assistant_ia_conversation_messages(
    State(state): State<AppState>,
    admin: AdminTenant,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let (base, slug) = assistant_ia_base_and_slug(&state, &admin.tenant_id).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .get(format!("{base}/api/tenants/{slug}/conversations/{id}/messages"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(body))
}

#[derive(Debug, Deserialize)]
pub struct SetAssistantEnabledInput {
    pub enabled: bool,
}

pub async fn assistant_ia_set_conversation_enabled(
    State(state): State<AppState>,
    admin: AdminTenant,
    Path(id): Path<String>,
    Json(input): Json<SetAssistantEnabledInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let (base, slug) = assistant_ia_base_and_slug(&state, &admin.tenant_id).await?;
    let key = assistant_ia_internal_key()?;
    let resp = state
        .http
        .put(format!("{base}/api/tenants/{slug}/conversations/{id}/assistant-enabled"))
        .header("x-internal-key", &key)
        .json(&serde_json::json!({ "enabled": input.enabled }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    Ok(Json(body))
}

pub async fn assistant_ia_delete_conversation(
    State(state): State<AppState>,
    admin: AdminTenant,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    features::require_feature(&state.pool, &admin.tenant_id, Feature::Whatsapp).await?;
    let (base, slug) = assistant_ia_base_and_slug(&state, &admin.tenant_id).await?;
    let key = assistant_ia_internal_key()?;
    state
        .http
        .delete(format!("{base}/api/tenants/{slug}/conversations/{id}"))
        .header("x-internal-key", key)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("assistant-ia indisponível: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, serde::Serialize)]
pub struct OnboardingGateDto {
    pub onboarding_hours_done: bool,
}

pub async fn get_onboarding_gate(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<OnboardingGateDto>, AppError> {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT COALESCE(onboarding_hours_done, false) FROM tenants WHERE id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?;
    Ok(Json(OnboardingGateDto {
        onboarding_hours_done: row.map(|r| r.0).unwrap_or(false),
    }))
}

// ---------- Horário / status da loja ----------

async fn ensure_default_hours(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
) -> Result<(), AppError> {
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM store_hours WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&mut **tx)
            .await?;
    if count.0 > 0 {
        return Ok(());
    }
    let default_intervals = serde_json::json!([{ "opens_at": "09:00", "closes_at": "18:00" }]);
    for day in 0i16..=6 {
        sqlx::query(
            "INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals) \
             VALUES ($1, $2, true, $3) ON CONFLICT DO NOTHING",
        )
        .bind(tenant_id)
        .bind(day)
        .bind(&default_intervals)
        .execute(&mut **tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO store_status (tenant_id, manually_closed) VALUES ($1, false) \
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn get_store_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<StoreStatusDto>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_default_hours(&mut tx, &claims.tenant_id).await?;

    let rows: Vec<(i16, bool, serde_json::Value)> = sqlx::query_as(
        "SELECT day_of_week, is_open, intervals FROM store_hours \
         WHERE tenant_id = $1 ORDER BY day_of_week",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;

    let hours: Vec<StoreHourDay> = rows
        .into_iter()
        .map(|(day_of_week, is_open, intervals)| {
            let intervals: Vec<StoreHourInterval> =
                serde_json::from_value(intervals).unwrap_or_default();
            StoreHourDay {
                day_of_week,
                is_open,
                intervals,
            }
        })
        .collect();

    let status: (bool, Option<String>) = sqlx::query_as(
        "SELECT manually_closed, manual_closed_reason FROM store_status WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or((false, None));

    tx.commit().await?;

    let hours_done: (bool,) = sqlx::query_as(
        "SELECT COALESCE(onboarding_hours_done, false) FROM tenants WHERE id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or((false,));

    Ok(Json(StoreStatusDto {
        hours,
        manually_closed: status.0,
        manual_closed_reason: status.1,
        onboarding_hours_done: hours_done.0,
        // Admin já tem o endereço em outra tela (config da loja) — não
        // duplica a query aqui, só a rota pública precisa disso pra
        // vitrine/Assistente IA.
        pickup_address: String::new(),
        pickup_lat: None,
        pickup_lng: None,
    }))
}

pub async fn set_store_hours(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<SetStoreHoursInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_default_hours(&mut tx, &claims.tenant_id).await?;

    for h in &body.hours {
        if !(0..=6).contains(&h.day_of_week) {
            return Err(AppError::BadRequest("day_of_week deve ser 0..6".to_string()));
        }
        let intervals = serde_json::to_value(&h.intervals)
            .map_err(|e| AppError::Internal(format!("intervals json: {e}")))?;
        sqlx::query(
            "INSERT INTO store_hours (tenant_id, day_of_week, is_open, intervals) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (tenant_id, day_of_week) DO UPDATE SET \
             is_open = EXCLUDED.is_open, intervals = EXCLUDED.intervals",
        )
        .bind(&claims.tenant_id)
        .bind(h.day_of_week)
        .bind(h.is_open)
        .bind(&intervals)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("UPDATE tenants SET onboarding_hours_done = true, updated_at = now()::text WHERE id = $1")
        .bind(&claims.tenant_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true, "onboarding_hours_done": true })))
}

pub async fn set_store_manual_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<SetStoreManualStatusInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.manually_closed && body.reason.as_deref().unwrap_or("").trim().is_empty() {
        // Motivo só é obrigatório no front quando fecha no horário aberto;
        // no backend aceitamos vazio (lojista pode fechar sem mensagem).
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_default_hours(&mut tx, &claims.tenant_id).await?;
    let reason = if body.manually_closed {
        body.reason.as_deref().map(str::trim).filter(|s| !s.is_empty())
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO store_status (tenant_id, manually_closed, manual_closed_reason) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (tenant_id) DO UPDATE SET \
         manually_closed = EXCLUDED.manually_closed, \
         manual_closed_reason = EXCLUDED.manual_closed_reason",
    )
    .bind(&claims.tenant_id)
    .bind(body.manually_closed)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- Frete (R$/km + raio máximo) ----------

#[derive(Debug, serde::Serialize)]
pub struct ShippingSettingsDto {
    pub price_per_km: f64,
    pub max_km: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateShippingSettingsInput {
    pub price_per_km: f64,
    pub max_km: Option<f64>,
}

async fn ensure_shipping_settings(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO shipping_settings (tenant_id, price_per_km, store_lat, store_lng) \
         VALUES ($1, 1.5, 0, 0) ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn get_shipping_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<ShippingSettingsDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Pedidos).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_shipping_settings(&mut tx, &claims.tenant_id).await?;
    let row: (f64, Option<f64>) = sqlx::query_as(
        "SELECT price_per_km, max_km FROM shipping_settings WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(ShippingSettingsDto {
        price_per_km: row.0,
        max_km: row.1,
    }))
}

pub async fn update_shipping_settings(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(body): Json<UpdateShippingSettingsInput>,
) -> Result<Json<ShippingSettingsDto>, AppError> {
    features::require_feature(&state.pool, &claims.tenant_id, Feature::Pedidos).await?;
    if !body.price_per_km.is_finite() || body.price_per_km < 0.0 {
        return Err(AppError::BadRequest(
            "price_per_km must be a non-negative number".to_string(),
        ));
    }
    if let Some(max_km) = body.max_km {
        if !max_km.is_finite() || max_km <= 0.0 {
            return Err(AppError::BadRequest(
                "max_km must be a positive number".to_string(),
            ));
        }
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    ensure_shipping_settings(&mut tx, &claims.tenant_id).await?;
    sqlx::query(
        "UPDATE shipping_settings SET price_per_km = $2, max_km = $3 WHERE tenant_id = $1",
    )
    .bind(&claims.tenant_id)
    .bind(body.price_per_km)
    .bind(body.max_km)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(ShippingSettingsDto {
        price_per_km: body.price_per_km,
        max_km: body.max_km,
    }))
}

// ---------- Templates de mensagem automática (/admin/template) ----------

#[derive(Debug, serde::Serialize)]
pub struct MessageTemplateDto {
    pub template_key: String,
    pub body: String,
    pub enabled: bool,
    pub trigger_delay_minutes: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpsertMessageTemplateInput {
    pub body: String,
    pub enabled: bool,
    pub trigger_delay_minutes: i32,
}

pub async fn list_message_templates(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<MessageTemplateDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<(String, String, bool, i32)> = sqlx::query_as(
        "SELECT template_key, body, enabled, trigger_delay_minutes FROM message_templates          WHERE tenant_id = $1 ORDER BY template_key",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let mut out: Vec<MessageTemplateDto> = rows
        .into_iter()
        .map(|(template_key, body, enabled, trigger_delay_minutes)| MessageTemplateDto {
            template_key,
            body,
            enabled,
            trigger_delay_minutes,
        })
        .collect();

    // A loja que nunca abriu essa tela não tem linha nenhuma no banco — devolve
    // o template de atraso com o texto padrão (desligado) pra tela ter o que
    // mostrar sem precisar de seed por tenant.
    if !out.iter().any(|t| t.template_key == crate::appointment_reminders::LATE_TEMPLATE_KEY) {
        out.push(MessageTemplateDto {
            template_key: crate::appointment_reminders::LATE_TEMPLATE_KEY.to_string(),
            body: crate::appointment_reminders::DEFAULT_LATE_TEMPLATE.to_string(),
            enabled: false,
            trigger_delay_minutes: 15,
        });
    }
    Ok(Json(out))
}

pub async fn upsert_message_template(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(template_key): Path<String>,
    Json(body): Json<UpsertMessageTemplateInput>,
) -> Result<Json<MessageTemplateDto>, AppError> {
    if body.body.trim().is_empty() {
        return Err(AppError::BadRequest("o texto da mensagem não pode ficar vazio".to_string()));
    }
    // Limite de baixo: 0 significaria disparar no exato minuto do horário
    // marcado, sem tolerância nenhuma. Limite de cima evita um disparo
    // "esquecido" chegando dias depois.
    if body.trigger_delay_minutes < 1 || body.trigger_delay_minutes > 1440 {
        return Err(AppError::BadRequest(
            "a tolerância de atraso deve ficar entre 1 e 1440 minutos".to_string(),
        ));
    }
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let row: (String, String, bool, i32) = sqlx::query_as(
        "INSERT INTO message_templates (tenant_id, template_key, body, enabled, trigger_delay_minutes, updated_at)          VALUES ($1, $2, $3, $4, $5, now())          ON CONFLICT (tenant_id, template_key) DO UPDATE SET            body = EXCLUDED.body,            enabled = EXCLUDED.enabled,            trigger_delay_minutes = EXCLUDED.trigger_delay_minutes,            updated_at = now()          RETURNING template_key, body, enabled, trigger_delay_minutes",
    )
    .bind(&claims.tenant_id)
    .bind(&template_key)
    .bind(body.body.trim())
    .bind(body.enabled)
    .bind(body.trigger_delay_minutes)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(MessageTemplateDto {
        template_key: row.0,
        body: row.1,
        enabled: row.2,
        trigger_delay_minutes: row.3,
    }))
}

// ---------- Agendamentos (visão do lojista) ----------
//
// Criação/edição real acontece só pelas rotas públicas (Assistente IA/
// cliente, ver public.rs) — aqui é só leitura + cancelamento manual, pro
// lojista acompanhar o que foi marcado.

#[derive(Debug, serde::Serialize)]
pub struct AdminAppointmentDto {
    pub id: String,
    pub customer_phone: String,
    pub customer_name: Option<String>,
    pub scheduled_at: String,
    pub reason: String,
    pub status: String,
}

pub async fn list_appointments(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
) -> Result<Json<Vec<AdminAppointmentDto>>, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let rows: Vec<(String, String, Option<String>, String, String, String)> = sqlx::query_as(
        "SELECT id, customer_phone, customer_name, scheduled_at::text, reason, status \
         FROM service_appointments WHERE tenant_id = $1 \
         ORDER BY (status = 'agendado') DESC, scheduled_at ASC LIMIT 200",
    )
    .bind(&claims.tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, customer_phone, customer_name, scheduled_at, reason, status)| AdminAppointmentDto {
                id,
                customer_phone,
                customer_name,
                scheduled_at,
                reason,
                status,
            })
            .collect(),
    ))
}

pub async fn admin_cancel_appointment(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = tenant::tenant_tx(&state.pool, &claims.tenant_id).await?;
    let result = sqlx::query(
        "UPDATE service_appointments SET status = 'cancelado', updated_at = now() \
         WHERE tenant_id = $1 AND id = $2 AND status = 'agendado'",
    )
    .bind(&claims.tenant_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("agendamento não encontrado (ou já cancelado)".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------- PDV (venda presencial no painel) ----------
//
// O PDV do vrtech (Next.js, ecommerce/produto/serviço) reaproveita a MESMA
// integração Mercado Pago já usada no checkout da vitrine -- credencial do
// lojista (tenants.plataforma_credenciais), nunca uma segunda integração
// duplicada. A venda em si (carrinho, split payment, baixa de estoque)
// continua vivendo no banco do vrtech (Supabase); aqui só entra a geração
// e a consulta de status da cobrança Pix, que dependem do token que só
// este backend tem acesso.

#[derive(Debug, Deserialize)]
pub struct CreatePdvPixInput {
    pub amount: f64,
    pub customer_name: String,
    pub customer_email: Option<String>,
    /// ID da venda/pagamento do lado do vrtech -- vira o external_reference
    /// da cobrança, pra rastrear de volta qual pdv_payments isso conclui.
    pub external_reference: String,
}

#[derive(Debug, serde::Serialize)]
pub struct PdvPixDto {
    pub payment_id: String,
    pub qr_code: String,
    pub qr_code_base64: String,
}

/// POST /api/admin/pdv/pix — gera cobrança Pix pro PDV, usando a credencial
/// Mercado Pago já conectada pelo lojista (mesma de Meu Plano → Financeiro).
pub async fn create_pdv_pix(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Json(input): Json<CreatePdvPixInput>,
) -> Result<Json<PdvPixDto>, AppError> {
    if !(input.amount > 0.0) {
        return Err(AppError::BadRequest("valor precisa ser maior que zero".to_string()));
    }
    let tenant_row = tenant::load_tenant(&state.pool, &claims.tenant_id).await?;
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &claims.tenant_id).await?;
    let token = payment_cfg.mp_access_token().ok_or_else(|| {
        AppError::BadRequest(
            "Esta loja não tem Mercado Pago conectado -- conecte em Meu plano → Financeiro antes de gerar Pix no PDV."
                .to_string(),
        )
    })?;
    let payer_email = match input.customer_email.as_deref().map(str::trim) {
        Some(email) if email.contains('@') => Some(email.to_string()),
        _ => tenant::organization_email_for_tenant(&state.pool, &claims.tenant_id).await?,
    };
    let pix = mercadopago::create_pix_charge(
        &state,
        token,
        &tenant_row.name,
        input.amount,
        &input.customer_name,
        payer_email.as_deref(),
        &input.external_reference,
    )
    .await?;
    Ok(Json(PdvPixDto {
        payment_id: pix.payment_id,
        qr_code: pix.qr_code,
        qr_code_base64: pix.qr_code_base64,
    }))
}

#[derive(Debug, serde::Serialize)]
pub struct PdvPixStatusDto {
    pub status: String,
}

/// GET /api/admin/pdv/pix/{payment_id}/status — pro frontend do PDV fazer
/// polling enquanto o cliente escaneia o QR.
pub async fn get_pdv_pix_status(
    State(state): State<AppState>,
    AdminUser(claims): AdminUser,
    Path(payment_id): Path<String>,
) -> Result<Json<PdvPixStatusDto>, AppError> {
    let payment_cfg = tenant::load_tenant_payment(&state.pool, &claims.tenant_id).await?;
    let token = payment_cfg
        .mp_access_token()
        .ok_or_else(|| AppError::BadRequest("Mercado Pago não conectado.".to_string()))?;
    let status = mercadopago::get_payment_status(&state, token, &payment_id).await?;
    Ok(Json(PdvPixStatusDto { status }))
}
