//! ERP Formulação / Ficha Técnica (BOM) — produtos cujo estoque e custo são
//! DERIVADOS dos insumos consumidos, nunca uma coluna editável à mão.
//!
//! `products.quantity`/`cost_price` continuam sendo as MESMAS colunas de
//! sempre (catálogo/vitrine/PDV leem exatamente como já liam) — só passam a
//! ser recalculadas aqui toda vez que um insumo dependente muda, em vez de
//! aceitas cruas de um formulário. A escrita direta é bloqueada em
//! `routes/admin.rs::update_product` (guarda no próprio SQL, não só no
//! frontend).

use sqlx::PgConnection;
use uuid::Uuid;

use crate::error::AppError;

/// Só dentro da mesma família (massa: g/kg; volume: ml/l; `un` não
/// converte — só combina com `un`). Cross-family (ex: g -> ml) é rejeitado
/// na hora de SALVAR a formulação/insumo, nunca silenciosamente truncado.
pub fn convert(qty: f64, from: &str, to: &str) -> Result<f64, AppError> {
    fn base_factor(unit: &str) -> Result<(f64, &'static str), AppError> {
        match unit {
            "g" => Ok((1.0, "mass")),
            "kg" => Ok((1000.0, "mass")),
            "ml" => Ok((1.0, "volume")),
            "l" => Ok((1000.0, "volume")),
            "un" => Ok((1.0, "unit")),
            other => Err(AppError::BadRequest(format!("unidade inválida: {other}"))),
        }
    }
    let (from_factor, from_family) = base_factor(from)?;
    let (to_factor, to_family) = base_factor(to)?;
    if from_family != to_family {
        return Err(AppError::BadRequest(format!(
            "não é possível converter {from} para {to} — unidades incompatíveis"
        )));
    }
    Ok(qty * from_factor / to_factor)
}

/// Disponibilidade calculada de um serviço a partir dos insumos ligados a
/// ele (insumo limitante — mesma lógica de produto ERP). `Ok(None)` quando
/// o serviço não tem insumo ligado (front decide se usa `manual_quantity`
/// nesse caso). Usado tanto pelo admin (`routes/admin.rs`) quanto pela
/// vitrine/Assistente IA pública (`routes/public.rs`), pra nunca divergir.
pub async fn compute_service_available_quantity(
    tx: &mut PgConnection,
    tenant_id: &str,
    service_id: &str,
) -> Result<Option<f64>, AppError> {
    let lines: Vec<(f64, String, f64, String)> = sqlx::query_as(
        "SELECT si.quantity, si.unit, i.quantity, i.unit \
         FROM service_ingredients si \
         JOIN ingredients i ON i.id = si.ingredient_id AND i.tenant_id = si.tenant_id \
         WHERE si.tenant_id = $1 AND si.service_id = $2",
    )
    .bind(tenant_id)
    .bind(service_id)
    .fetch_all(&mut *tx)
    .await?;
    if lines.is_empty() {
        return Ok(None);
    }
    let mut min_available: f64 = f64::MAX;
    for (line_quantity, line_unit, ingredient_quantity, ingredient_unit) in lines {
        let Ok(converted_stock) = convert(ingredient_quantity, &ingredient_unit, &line_unit) else { continue };
        let can_make = (converted_stock / line_quantity).floor().max(0.0);
        min_available = min_available.min(can_make);
    }
    Ok(Some(if min_available == f64::MAX { 0.0 } else { min_available }))
}

#[derive(Debug, sqlx::FromRow)]
struct FormulationLine {
    quantity: f64,
    unit: String,
    ingredient_quantity: f64,
    ingredient_unit: String,
    ingredient_cost_price: f64,
}

/// Recalcula `quantity` (insumo limitante) e `cost_price` de UM produto ERP
/// a partir da formulação atual + estoque/custo dos insumos. Chamar sempre
/// que a formulação do produto OU qualquer insumo dependente mudar.
pub async fn recompute_formulated_product(
    tx: &mut PgConnection,
    tenant_id: &str,
    product_id: &str,
) -> Result<(), AppError> {
    let lines: Vec<FormulationLine> = sqlx::query_as(
        "SELECT pf.quantity, pf.unit, \
                i.quantity AS ingredient_quantity, i.unit AS ingredient_unit, i.cost_price AS ingredient_cost_price \
         FROM product_formulations pf \
         JOIN ingredients i ON i.id = pf.ingredient_id AND i.tenant_id = pf.tenant_id \
         WHERE pf.tenant_id = $1 AND pf.product_id = $2",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *tx)
    .await?;

    let mut available_units: Option<i64> = None;
    let mut total_cost = 0.0;
    for line in &lines {
        let qty_in_ingredient_unit = convert(line.quantity, &line.unit, &line.ingredient_unit)?;
        total_cost += qty_in_ingredient_unit * line.ingredient_cost_price;

        let stock_in_line_unit = convert(line.ingredient_quantity, &line.ingredient_unit, &line.unit)?;
        let possible = (stock_in_line_unit / line.quantity).floor().max(0.0) as i64;
        available_units = Some(match available_units {
            None => possible,
            Some(min_so_far) => min_so_far.min(possible),
        });
    }
    // Produto ERP sem nenhuma linha de formulação (nunca deveria acontecer
    // via UI, mas é um estado válido de banco) — estoque 0, custo intocado.
    let available_units = available_units.unwrap_or(0);

    sqlx::query(
        "UPDATE products SET quantity = $1, cost_price = $2 \
         WHERE tenant_id = $3 AND id = $4 AND origin_type = 'erp_formulation'",
    )
    .bind(available_units)
    .bind(total_cost)
    .bind(tenant_id)
    .bind(product_id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Chamado sempre que um insumo muda (estoque OU custo) — recalcula todo
/// produto ERP que depende dele.
pub async fn recompute_dependents(
    tx: &mut PgConnection,
    tenant_id: &str,
    ingredient_id: &str,
) -> Result<(), AppError> {
    let product_ids: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT product_id FROM product_formulations WHERE tenant_id = $1 AND ingredient_id = $2",
    )
    .bind(tenant_id)
    .bind(ingredient_id)
    .fetch_all(&mut *tx)
    .await?;
    for (product_id,) in product_ids {
        recompute_formulated_product(tx, tenant_id, &product_id).await?;
    }
    Ok(())
}

/// `sign = -1.0` consome (venda), `sign = 1.0` restaura (cancelamento de
/// venda paga). Retorna os `ingredient_id`s afetados (sem repetição) pra
/// quem chamou recalcular os produtos dependentes deles.
async fn apply_order_ingredient_delta(
    tx: &mut PgConnection,
    tenant_id: &str,
    order_id: &str,
    sign: f64,
    reason: &str,
) -> Result<Vec<String>, AppError> {
    // UNION dos dois jeitos de `order_items.product_id` referenciar um
    // insumo: via ficha técnica de produto ERP (`product_formulations`) OU
    // via peça ligada a um serviço vendido pelo Assistente IA
    // (`service_ingredients` — `oi.product_id` guarda o id do SERVIÇO
    // nesse caso, `order_items` não distingue produto/serviço por design,
    // ver `create_assistant_order`).
    let rows: Vec<(String, f64, String, String)> = sqlx::query_as(
        "SELECT pf.ingredient_id, oi.quantity::double precision * pf.quantity AS needed, pf.unit, i.unit AS ingredient_unit \
         FROM order_items oi \
         JOIN product_formulations pf ON pf.tenant_id = oi.tenant_id AND pf.product_id = oi.product_id \
         JOIN ingredients i ON i.id = pf.ingredient_id AND i.tenant_id = pf.tenant_id \
         WHERE oi.tenant_id = $1 AND oi.order_id = $2 \
         UNION ALL \
         SELECT si.ingredient_id, oi.quantity::double precision * si.quantity AS needed, si.unit, i.unit AS ingredient_unit \
         FROM order_items oi \
         JOIN service_ingredients si ON si.tenant_id = oi.tenant_id AND si.service_id = oi.product_id \
         JOIN ingredients i ON i.id = si.ingredient_id AND i.tenant_id = si.tenant_id \
         WHERE oi.tenant_id = $1 AND oi.order_id = $2",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *tx)
    .await?;

    let mut touched: Vec<String> = Vec::new();
    for (ingredient_id, needed_in_line_unit, line_unit, ingredient_unit) in rows {
        let delta = convert(needed_in_line_unit, &line_unit, &ingredient_unit)? * sign;
        sqlx::query("UPDATE ingredients SET quantity = quantity + $1 WHERE tenant_id = $2 AND id = $3")
            .bind(delta)
            .bind(tenant_id)
            .bind(&ingredient_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO stock_movements (id, tenant_id, entity_type, entity_id, delta, reason, order_id) \
             VALUES ($1, $2, 'ingredient', $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(tenant_id)
        .bind(&ingredient_id)
        .bind(delta)
        .bind(reason)
        .bind(order_id)
        .execute(&mut *tx)
        .await?;
        if !touched.contains(&ingredient_id) {
            touched.push(ingredient_id);
        }
    }
    Ok(touched)
}

/// Consome os insumos dos itens ERP de um pedido (venda confirmada) —
/// retorna os `ingredient_id`s afetados pra recalcular os dependentes.
pub async fn consume_ingredients_for_order(
    tx: &mut PgConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<Vec<String>, AppError> {
    apply_order_ingredient_delta(tx, tenant_id, order_id, -1.0, "sale_consumption").await
}

/// Inverso — restaura os insumos quando uma venda PAGA é cancelada/estornada.
pub async fn restock_ingredients_for_order(
    tx: &mut PgConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<Vec<String>, AppError> {
    apply_order_ingredient_delta(tx, tenant_id, order_id, 1.0, "sale_restock").await
}
