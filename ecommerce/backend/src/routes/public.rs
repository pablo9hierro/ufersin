use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abacatepay;
use crate::error::AppError;
use crate::google_routes::{self, Ponto, RotaResult};
use crate::models::OrderDto;
use crate::orders_common::{fetch_items, fetch_order_dto, fetch_order_row, row_to_dto, short_id};
use crate::state::AppState;
use crate::tenant;
use crate::whatsapp;

// Catálogo, criação/consulta de pedido etc. foram todos migrados pra RPCs do
// Supabase (ver supabase/*.sql) — só sobra aqui o que precisa de segredo
// (Pix, WhatsApp), que só existe no backend Rust.
//
// Nenhuma dessas rotas tem login (o cliente ainda não tem sessão nesse
// ponto do fluxo) — o tenant de cada uma é resolvido a partir do PRÓPRIO
// pedido (tenant_for_order), que já era o limite de autorização usado aqui
// antes desse refactor (conhecer o id do pedido). Isso também garante que
// a mensagem de WhatsApp/loja usada é sempre a do tenant DONO do pedido,
// nunca a de outro.

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

/// Cria a cobrança Pix de verdade na AbacatePay (ou fake em modo mock) pro
/// pedido — antes disso não existia nenhum lugar que de fato chamava a API
/// de pagamento; a tela de pagamento só lia campos que nunca eram
/// preenchidos. Idempotente: se já tiver cobrança criada, devolve como está
/// em vez de criar uma segunda.
pub async fn create_pix_payment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OrderDto>, AppError> {
    let store = tenant::tenant_for_order(&state.pool, &id).await?;
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if order.payment_method != "pix" {
        return Err(AppError::BadRequest("order is not a pix payment".to_string()));
    }
    if order.pix_payment_id.is_some() {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    let digits = whatsapp::digits_only(&order.customer_whatsapp);
    let pix = abacatepay::create_pix_charge(&state, &store.name, order.total, &order.customer_name, &digits).await?;

    sqlx::query(
        "UPDATE orders SET pix_payment_id = $1, pix_qr_base64 = $2, pix_copia_cola = $3, updated_at = now()::text \
         WHERE tenant_id = $4 AND id = $5",
    )
    .bind(&pix.payment_id)
    .bind(&pix.qr_code_base64)
    .bind(&pix.qr_code)
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

/// Venda de balcão (PDV) só manda UMA mensagem — o "obrigado pela compra"
/// com os itens e o valor — nunca o passo a passo (pedido feito/pronto/
/// saiu pra entrega) que uma compra online recebe, porque não existe
/// preparo nem entrega aqui, a venda já nasce concluída. Sempre a partir
/// do número da PRÓPRIA LOJA (vendedor não tem instância de WhatsApp
/// própria, diferente do motoboy). Sem WhatsApp informado na venda
/// (cliente de balcão anônimo), não faz nada — sucesso silencioso.
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
        return Ok(StatusCode::NO_CONTENT);
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
    let mut tx = tenant::tenant_tx(&state.pool, &store.id).await?;
    let Some(order) = fetch_order_row(&mut *tx, &store.id, &id).await? else {
        return Err(AppError::NotFound("order not found".to_string()));
    };

    if order.payment_method != "pix" || order.payment_status == "pago" {
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    }

    let (Some(payment_id), true) = (order.pix_payment_id.clone(), state.abacatepay_key.is_some()) else {
        // Mock mode (or no payment id yet): nothing to check against the real API.
        let dto = row_to_dto(&mut tx, &store.id, order).await?;
        tx.commit().await?;
        return Ok(Json(dto));
    };

    let status = abacatepay::get_charge_status(&state, &payment_id).await?;
    if status == "PAID" {
        sqlx::query("UPDATE orders SET payment_status = 'pago', updated_at = now()::text WHERE tenant_id = $1 AND id = $2")
            .bind(&store.id)
            .bind(&id)
            .execute(&mut *tx)
            .await?;

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
}

/// Público de propósito — cliente deslogado que esqueceu a senha ainda não
/// tem nenhum token. Gera o código de 3 dígitos direto no banco
/// (sunset._create_customer_reset_code — sem GRANT pra anon/authenticated,
/// só alcançável por SQL direto, que é como o Rust fala com o Postgres) e
/// manda por WhatsApp. Sempre responde 204, mesmo se o whatsapp não tiver
/// cadastro (a função RAISE EXCEPTION nesse caso; vira Err aqui, ignorado
/// de propósito) — não revela quais números têm conta.
///
/// NOTE (Fase 1B pendente): essa RPC ainda não existe nas migrations locais
/// (só em supabase/*.sql) e hoje não recebe qual tenant — um whatsapp só é
/// suficiente pra achar "o" cliente enquanto existe um único tenant. Quando
/// essa RPC for portada, ela precisa passar a receber tenant_id também
/// (mesmo problema do login: sem roteamento por domínio ainda, precisa vir
/// de algum lugar explícito no request).
pub async fn request_customer_password_reset(
    State(state): State<AppState>,
    Json(input): Json<RequestPasswordResetInput>,
) -> Result<StatusCode, AppError> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT customer_id, customer_name, code FROM sunset._create_customer_reset_code($1)",
    )
    .bind(&input.whatsapp)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    if let Some((_customer_id, name, code)) = row {
        // TODO Fase 1B: sem tenant_id vindo da RPC ainda (ver nota acima),
        // não há como resolver a instância/nome da loja aqui — quando a RPC
        // for portada e passar a devolver tenant_id junto, troque isso por
        // tenant::load_tenant(&state.pool, &tenant_id) como nos outros
        // handlers deste arquivo.
        let digits = whatsapp::digits_only(&input.whatsapp);
        let msg = format!(
            "Olá, {name}! Seu código de recuperação de senha é: {code}\n\nVale por 10 minutos."
        );
        whatsapp::notify(&state, "", &digits, &msg);
    }

    Ok(StatusCode::NO_CONTENT)
}
