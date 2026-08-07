use serde::{Deserialize, Serialize};

// ---------- Categories ----------

#[derive(Debug, sqlx::FromRow, Serialize)]
pub struct Category {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: String,
}

// ---------- Products ----------

#[derive(Debug, sqlx::FromRow)]
pub struct ProductRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub quantity: i64,
    pub image_url: Option<String>,
    pub category_id: Option<String>,
    pub active: i64,
    #[allow(dead_code)]
    pub created_at: String,
    pub category_name: Option<String>,
    pub cost_price: Option<f64>,
    pub low_stock_threshold: Option<i64>,
    pub barcode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProductDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub quantity: i64,
    pub image_url: Option<String>,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub active: bool,
    pub cost_price: Option<f64>,
    pub low_stock_threshold: Option<i64>,
    pub barcode: Option<String>,
}

impl From<ProductRow> for ProductDto {
    fn from(r: ProductRow) -> Self {
        ProductDto {
            id: r.id,
            name: r.name,
            description: r.description,
            price: r.price,
            quantity: r.quantity,
            image_url: r.image_url,
            category_id: r.category_id,
            category_name: r.category_name,
            active: r.active != 0,
            cost_price: r.cost_price,
            low_stock_threshold: r.low_stock_threshold,
            barcode: r.barcode,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ProductInput {
    pub name: String,
    pub description: Option<String>,
    pub price: f64,
    pub quantity: i64,
    pub image_url: Option<String>,
    pub category_id: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub cost_price: Option<f64>,
    #[serde(default)]
    pub low_stock_threshold: Option<i64>,
    #[serde(default)]
    pub barcode: Option<String>,
}

// ---------- Motoboys ----------

#[derive(Debug, sqlx::FromRow)]
pub struct MotoboyRow {
    pub id: String,
    pub name: String,
    pub phone: String,
    pub email: String,
    #[allow(dead_code)]
    pub password_hash: String,
    pub active: i64,
    #[allow(dead_code)]
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct MotoboyDto {
    pub id: String,
    pub name: String,
    pub phone: String,
    pub email: String,
    pub active: bool,
}

impl From<MotoboyRow> for MotoboyDto {
    fn from(r: MotoboyRow) -> Self {
        MotoboyDto {
            id: r.id,
            name: r.name,
            phone: r.phone,
            email: r.email,
            active: r.active != 0,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct MotoboyInput {
    pub name: String,
    pub phone: String,
    pub email: String,
    pub password: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
}

// ---------- Orders ----------

#[derive(Debug, sqlx::FromRow, Clone)]
pub struct OrderRow {
    pub id: String,
    pub customer_id: Option<String>,
    pub customer_name: String,
    pub customer_whatsapp: String,
    pub delivery_type: String,
    pub neighborhood: Option<String>,
    pub address: Option<String>,
    pub reference_point: Option<String>,
    pub payment_method: String,
    pub payment_status: String,
    pub status: String,
    pub shipping_price: f64,
    pub total: f64,
    pub discount_amount: f64,
    pub motoboy_id: Option<String>,
    pub pix_payment_id: Option<String>,
    pub pix_qr_base64: Option<String>,
    pub pix_copia_cola: Option<String>,
    pub pix_provider: Option<String>,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
    pub sold_by_role: Option<String>,
    pub sold_by_id: Option<String>,
    pub cancel_reason: Option<String>,
    pub cancel_by: Option<String>,
    pub cancel_note: Option<String>,
    pub canceled_at: Option<String>,
    pub refund_status: Option<String>,
    pub refund_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, sqlx::FromRow, Serialize, Clone)]
pub struct OrderItemDto {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub unit_price: f64,
    pub quantity: i64,
}

#[derive(Debug, Serialize)]
pub struct OrderDto {
    pub id: String,
    pub customer_id: Option<String>,
    pub customer_name: String,
    pub customer_whatsapp: String,
    pub delivery_type: String,
    pub neighborhood: Option<String>,
    pub address: Option<String>,
    pub payment_method: String,
    pub payment_status: String,
    pub status: String,
    pub shipping_price: f64,
    pub total: f64,
    pub discount_amount: f64,
    pub motoboy_id: Option<String>,
    pub pix_payment_id: Option<String>,
    pub pix_qr_base64: Option<String>,
    pub pix_copia_cola: Option<String>,
    pub pix_provider: Option<String>,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
    pub sold_by_role: Option<String>,
    pub sold_by_id: Option<String>,
    pub sold_by_name: Option<String>,
    pub cancel_reason: Option<String>,
    pub cancel_by: Option<String>,
    pub cancel_note: Option<String>,
    pub canceled_at: Option<String>,
    pub refund_status: Option<String>,
    pub refund_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<OrderItemDto>,
}

impl OrderDto {
    pub fn from_row(row: OrderRow, items: Vec<OrderItemDto>) -> Self {
        let sold_by_role = row.sold_by_role.clone();
        let sold_by_id = row.sold_by_id.clone();
        let sold_by_name = match sold_by_role.as_deref() {
            Some("admin") => Some("Admin".to_string()),
            Some("vendedor") => sold_by_id
                .as_ref()
                .map(|id| format!("Vendedor {}", &id[..id.len().min(8)])),
            _ => None,
        };
        OrderDto {
            id: row.id,
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            customer_whatsapp: row.customer_whatsapp,
            delivery_type: row.delivery_type,
            neighborhood: row.neighborhood,
            address: row.address,
            payment_method: row.payment_method,
            payment_status: row.payment_status,
            status: row.status,
            shipping_price: row.shipping_price,
            total: row.total,
            discount_amount: row.discount_amount,
            motoboy_id: row.motoboy_id,
            pix_payment_id: row.pix_payment_id,
            pix_qr_base64: row.pix_qr_base64,
            pix_copia_cola: row.pix_copia_cola,
            pix_provider: row.pix_provider,
            customer_lat: row.customer_lat,
            customer_lng: row.customer_lng,
            sold_by_role,
            sold_by_id,
            sold_by_name,
            cancel_reason: row.cancel_reason,
            cancel_by: row.cancel_by,
            cancel_note: row.cancel_note,
            canceled_at: row.canceled_at,
            refund_status: row.refund_status,
            refund_id: row.refund_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            items,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AdminCancelInput {
    /// "A pedido do cliente" | "Outro"
    pub reason: String,
    /// Required when reason is "Outro".
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CustomerCancelInput {
    /// WhatsApp used on the order — ownership proof for /consultar (no JWT).
    pub whatsapp: String,
}

#[derive(Debug, Deserialize)]
pub struct PdvSaleInput {
    pub items: Vec<PdvSaleItemInput>,
    pub payment_method: String,
    pub customer_name: Option<String>,
    pub customer_whatsapp: Option<String>,
    pub discount_type: Option<String>,
    pub discount_value: Option<f64>,
    /// Só quando `payment_method = 'cartao'` E o lojista escolheu "Link de
    /// pagamento"/"Conectar cartão aqui" (não NFC) — nesses dois casos a
    /// venda nasce pendente (mesmo espírito do Pix com QR), só vira 'pago'
    /// depois que o cliente completar. Omitido (ou `nfc`) preserva o
    /// comportamento de sempre: cartão nasce pago na hora.
    #[serde(default)]
    pub card_payment_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PdvSaleItemInput {
    pub product_id: String,
    pub quantity: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatusInput {
    pub status: String,
    #[serde(default)]
    pub payment_confirmed: Option<bool>,
    /// Optional settlement override (pay-at-pickup / baixa na retirada).
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub customer_name: Option<String>,
    #[serde(default)]
    pub customer_whatsapp: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestLocationInput {
    pub order_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SkippedOrder {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct RequestLocationResult {
    pub updated: Vec<OrderDto>,
    pub skipped: Vec<SkippedOrder>,
}

// ---------- Auth ----------

#[derive(Debug, Deserialize)]
pub struct LoginInput {
    /// Optional store slug (deep link from Resolutoo "Entrar no painel").
    /// When omitted, admin login resolves the tenant from email+password.
    /// Email is unique per tenant (`UNIQUE (tenant_id, email)`); if the same
    /// email+password matches more than one store, the client must pass a slug.
    #[serde(default)]
    pub tenant_slug: Option<String>,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub name: String,
    /// Tenant the session belongs to (always set so the client can persist it
    /// after credential-based resolution without a prior `?tenant=`).
    pub tenant_slug: String,
}

// ---------- Financeiro ----------

#[derive(Debug, Serialize)]
pub struct StatusCount {
    pub status: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct TopProduct {
    pub product_id: String,
    pub product_name: String,
    pub quantity_sold: i64,
    pub revenue: f64,
}

#[derive(Debug, Serialize)]
pub struct FinanceiroSummary {
    pub total_revenue: f64,
    pub total_orders: i64,
    pub orders_by_status: Vec<StatusCount>,
    pub top_products: Vec<TopProduct>,
    pub recent_orders: Vec<OrderDto>,
    /// Vendas `delivery_type = balcao` (PDV) — mesma fonte do histórico,
    /// pra o card de Relatórios não depender de outro endpoint/RPC.
    #[serde(default)]
    pub pdv_sales: Vec<OrderDto>,
    pub pdv_total_sales: f64,
    pub pdv_total_count: i64,
    /// Campos extras que o frontend espera (RPC Supabase); no caminho
    /// Railway devolvemos zero/lista vazia pra não crashar a UI.
    #[serde(default)]
    pub total_discount_given: f64,
    #[serde(default)]
    pub motoboys: Vec<serde_json::Value>,
    #[serde(default)]
    pub avg_delivery_minutes: f64,
}

/// Custo + lucro no intervalo [from, to] (datas ISO YYYY-MM-DD, inclusive).
/// custo = Σ qty × COALESCE(product.cost_price, 0) nos pedidos pagos;
/// receita = Σ order.total pagos (site + PDV/balcão); lucro = receita − custo.
#[derive(Debug, Serialize)]
pub struct LucroSummary {
    pub from: String,
    pub to: String,
    pub receita: f64,
    pub custo: f64,
    pub lucro: f64,
    pub orders_count: i64,
    /// true quando algum item vendido não tem cost_price cadastrado.
    pub incomplete_cost: bool,
}

// ---------- Horário / status da loja ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoreHourInterval {
    pub opens_at: String,
    pub closes_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoreHourDay {
    pub day_of_week: i16,
    pub is_open: bool,
    pub intervals: Vec<StoreHourInterval>,
}

#[derive(Debug, Serialize)]
pub struct StoreStatusDto {
    pub hours: Vec<StoreHourDay>,
    pub manually_closed: bool,
    pub manual_closed_reason: Option<String>,
    /// Etapa 2 do painel: horário já foi salvo pelo lojista pelo menos uma vez.
    #[serde(default)]
    pub onboarding_hours_done: bool,
}

#[derive(Debug, Deserialize)]
pub struct SetStoreHoursInput {
    pub hours: Vec<StoreHourDay>,
}

#[derive(Debug, Deserialize)]
pub struct SetStoreManualStatusInput {
    pub manually_closed: bool,
    #[serde(default)]
    pub reason: Option<String>,
}
