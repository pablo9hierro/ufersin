use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abacatepay;
use crate::cancel;
use crate::error::AppError;
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

    Ok(Json(StoreStatusDto {
        hours,
        manually_closed: status.0,
        manual_closed_reason: status.1,
        onboarding_hours_done: true,
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
    tx.commit().await?;
    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = format!(
        "Olá, {}! Recebemos seu pedido e já estamos preparando 😋 Assim que ficar pronto, avisamos por aqui!",
        order.customer_name
    );
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

/// Cria a cobrança Pix (Mercado Pago por tenant, AbacatePay legado/global,
/// ou QR mock). Idempotente: se já tiver cobrança e `force` não veio, devolve
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

    let digits = whatsapp::digits_only(&order.customer_whatsapp);
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
        Some("abacate_pay") | None => {
            // Tenant Abacate token (if synced) else global ABACATEPAY_API_KEY / mock.
            let pix =
                abacatepay::create_pix_charge(&state, &store.name, order.total, &order.customer_name, &digits)
                    .await?;
            let provider = if state.abacatepay_key.is_some() || payment_cfg.abacate_token().is_some() {
                "abacate_pay"
            } else {
                "mock"
            };
            (pix, provider)
        }
        _ => unreachable!(),
    };

    sqlx::query(
        "UPDATE orders SET pix_payment_id = $1, pix_qr_base64 = $2, pix_copia_cola = $3, \
         pix_provider = $4, \
         payment_status = CASE WHEN payment_status = 'pago' THEN payment_status ELSE 'pendente' END, \
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
        "UPDATE orders SET card_payment_mode = 'link', card_payment_link_url = $1, updated_at = now()::text \
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
    tx.commit().await?;

    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let msg = format!(
        "Recebemos seu pagamento! Seu pedido #{} já está sendo preparado. 🌇",
        short_id(&order.id)
    );
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
    } else if state.abacatepay_key.is_some() {
        let status = abacatepay::get_charge_status(&state, &payment_id).await?;
        status == "PAID"
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
    if state.abacatepay_key.is_some() {
        return Err(AppError::Forbidden(
            "a real ABACATEPAY_API_KEY is configured; simulate-pix-paid is disabled".to_string(),
        ));
    }

    let store = tenant::tenant_for_order(&state.pool, &id).await?;
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

// rebuild-marker PDV Pix force 2026-08-01T17:20:00.6543400-03:00
