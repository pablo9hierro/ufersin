export type OrderStatus =
  | 'pendente'
  | 'montando_pedido'
  | 'pedido_pronto'
  | 'aguardando_localizacao'
  | 'em_rota_de_entrega'
  | 'entregue'
  | 'retiradas'
  | 'concluido'

export type DeliveryType = 'entrega' | 'retirada' | 'balcao'
export type PaymentMethod = 'pix' | 'cartao' | 'dinheiro'
export type PaymentStatus = 'pendente' | 'pago'

export interface Category {
  id: string
  name: string
}

export interface Product {
  id: string
  name: string
  description: string | null
  price: number
  quantity: number
  image_url: string | null
  category_id: string | null
  category_name?: string | null
  active?: boolean
  barcode?: string | null
}

export type CouponKind = 'desconto' | 'frete' | 'aniversario' | 'produto'
export type DiscountType = 'percent' | 'fixed'

export interface ProductDiscount {
  product_id: string
  discount_type: DiscountType
  discount_value: number
  // Só existe no client — marca que esse produto entrou na lista via
  // seleção de categoria inteira (pra agrupar visualmente como "Categoria:
  // X" com um desconto só). O backend ignora esse campo, sempre grava
  // linha por produto.
  category_id?: string
}

export interface Coupon {
  id: string
  code: string
  kind: CouponKind
  // Texto livre, só interno (nunca vai pro cliente) — anotação do admin
  // sobre o cupom.
  description?: string | null
  // kind='frete': discount_type/value É a taxa de frete (legado, cupom
  // avulso). kind='desconto': desconto flat sobre o subtotal. kind='produto':
  // discount_type/value ficam null, o desconto mora em product_discounts.
  discount_type: DiscountType | null
  discount_value: number | null
  // Desconto de frete ADICIONAL, independente do kind — antes só cupom
  // exclusivo (CRM) combinava frete com desconto/produto; agora cupom
  // avulso também usa isso pro checkbox "Também dar desconto no frete".
  shipping_discount_type: DiscountType | null
  shipping_discount_value: number | null
  product_discounts?: ProductDiscount[]
  allow_promotion_checkout: boolean
  // Só relevante pra cupom alvo (com concessões) — se pode ser combinado
  // com um cupom avulso digitado manualmente no checkout.
  combinable_with_public?: boolean
  active: boolean
  // Vale pra QUALQUER cupom avulso (não só aniversário) — antes do
  // cadastro, não é aceito no checkout.
  starts_at: string | null
  expires_at: string | null
  max_uses: number | null
  used_count: number
  created_at: string
  // > 0 quando o cupom nasceu de um filtro no CRM (cupom alvo,
  // intransferível) — 0 é cupom avulso, qualquer um pode digitar o código.
  grant_count?: number
  // Mensagem de WhatsApp — só usada quando algum dos campos de
  // aniversário abaixo está preenchido (cupom vira "alvo", concedido
  // automaticamente em vez de digitado manualmente).
  message_template?: string | null
  // Concede automaticamente N dias antes do aniversário de CADA cliente.
  bday_customer_days_before?: number | null
  // Concede automaticamente pra TODOS os clientes, N dias antes de uma
  // data fixa da loja (formato 'MM-DD').
  bday_store_date?: string | null
  bday_store_days_before?: number | null
}

// Critério salvo do filtro avançado do CRM — mesmo shape do FilterState
// do front (AdminCrm.tsx), guardado como jsonb opaco (o servidor nunca
// interpreta o conteúdo, só persiste).
export type CrmFilterCriteria = Record<string, unknown>

export interface CrmSegment {
  id: string
  name: string
  description: string | null
  filter_criteria: CrmFilterCriteria
  created_at: string
}

// "Campanha" (novo conceito): notifica os clientes de um segmento via
// WhatsApp com um cupom exclusivo — 'segmento' dispara uma vez só, pros
// clientes que casam com o critério do segmento no momento da criação;
// 'evento' fica de olho num critério DIFERENTE do critério original do
// segmento (trigger_criteria) e dispara (uma vez por cliente) assim que
// esse critério mais apertado/diferente passar a valer pra ele.
export type CampanhaOrientation = 'segmento' | 'evento'

// Cupom "extra" — a campanha pode entregar mais de um cupom junto com o
// principal (coupon_id), cada um com seu próprio código/desconto/prazo,
// mas todos ligados/desligados e concedidos juntos.
export interface CrmCampanhaExtraCoupon {
  id: string
  coupon: Coupon
  message_template: string
  // Critério "por evento" pra encerrar SÓ este cupom extra (decoupled do
  // segmento, mesmo mecanismo do gatilho) — null = sem encerramento
  // automático.
  end_criteria: CrmFilterCriteria | null
  // Agendamento de disparo — null = notifica na hora que concede (de
  // sempre). Preenchido = espera N dias (a partir da concessão) e só
  // dispara na hora configurada (0-23, horário de Brasília).
  schedule_delay_days: number | null
  schedule_hour: number | null
}

export interface CrmCampanhaCoupon {
  id: string
  segment_id: string
  // NULL até o primeiro cupom ser criado — campanha nasce só com
  // cadastro (nome/descrição/duração), gatilho e cupom(s) são passos
  // separados depois.
  coupon_id: string | null
  orientation: CampanhaOrientation
  name: string
  description: string | null
  starts_at: string | null
  ends_at: string | null
  trigger_criteria: CrmFilterCriteria | null
  // Texto livre, só interno — anotação do admin sobre o gatilho.
  trigger_description?: string | null
  // Critério "por evento" pra encerrar a campanha INTEIRA (principal +
  // extras) — mesmo mecanismo do gatilho, decoupled do segmento.
  end_criteria: CrmFilterCriteria | null
  // Texto livre, só interno — anotação do admin sobre o gatilho de encerramento.
  end_description?: string | null
  message_template: string
  uses_per_customer: number
  active: boolean
  fired_at: string | null
  created_at: string
  extra_coupons: CrmCampanhaExtraCoupon[]
  // Agendamento de disparo do cupom PRINCIPAL — mesma regra do extra
  // (ver CrmCampanhaExtraCoupon.schedule_delay_days).
  schedule_delay_days: number | null
  schedule_hour: number | null
  // "Retrato" do filter_criteria do segmento no momento em que o
  // trigger_criteria foi calibrado pela última vez (criação ou edição) —
  // compara com o filter_criteria ATUAL do segmento pra saber exatamente
  // quais campos mudaram desde então (campanha 'evento' desatualizada).
  last_synced_segment_criteria: CrmFilterCriteria | null
}

export interface CouponGrant {
  id: string
  customer_whatsapp: string
  customer_name: string | null
  granted_uses: number
  used_count: number
  created_at: string
}

// Conta de cliente (login por whatsapp+senha de 4 dígitos) — desacoplada
// do rascunho de checkout em store/customer.ts (esse é só o formulário,
// não exige login pra existir).
export interface Customer {
  id: string
  name: string
  whatsapp: string
  email: string | null
  birthdate: string | null
}
export interface CustomerAuthResult {
  token: string
  customer: Customer
}

export interface CustomerCouponEntry {
  grant_id: string
  coupon_id: string
  code: string
  kind: CouponKind
  discount_type: DiscountType | null
  discount_value: number | null
  shipping_discount_type: DiscountType | null
  shipping_discount_value: number | null
  granted_uses: number
  used_count: number
  expires_at: string | null
  created_at: string
}
export interface CustomerCouponHistoryEntry {
  order_id: string
  coupon_code: string
  created_at: string
  total: number
  discount_amount: number | null
  shipping_discount: number | null
}
export interface CustomerCoupons {
  active: CustomerCouponEntry[]
  inactive: CustomerCouponEntry[]
  history: CustomerCouponHistoryEntry[]
}
// Retorno de customer_claim_coupon — só existe DEPOIS de confirmar o
// resgate em /cliente/cupons, nada disso é visível antes.
// (description NÃO entra aqui: é nota interna do admin, nunca vai pro cliente.)
export interface ClaimedCoupon {
  grant_id: string
  coupon_id: string
  code: string
  kind: CouponKind
  discount_type: DiscountType | null
  discount_value: number | null
  shipping_discount_type: DiscountType | null
  shipping_discount_value: number | null
  granted_uses: number
  used_count: number
  expires_at: string | null
}

export type PromotionType = 'selfie_service' | 'kit'

// "Promoção" — o antigo "campanha": banner/carrossel da landing, kit ou
// selfie-service, leva pro checkout de /banner. Renomeado pra abrir
// espaço pro novo conceito de "campanha" (ver CrmCampanhaCoupon).
export interface Promotion {
  id: string
  title: string
  // Segunda linha do rodapé do card na landing (era fixo "Promoções");
  // null/vazio cai no padrão "Promoções" no componente que renderiza.
  subtitle: string | null
  image_url: string
  product_ids: string[]
  promotion_type: PromotionType
  // kit: desconto sobre o valor total somado (discount_type/value).
  // selfie_service: desconto por produto (product_discounts) — cliente
  // monta o próprio carrinho em /banner com só os itens que quiser.
  discount_type: DiscountType | null
  discount_value: number | null
  shipping_discount_type: DiscountType | null
  shipping_discount_value: number | null
  product_discounts?: ProductDiscount[]
  // Regras "categoria inteira" (produto novo/recategorizado na categoria
  // entra em promoção sozinho, via trigger no backend) — usado só pra
  // reconstruir a tag category_id de product_discounts ao reabrir a
  // promoção pra editar.
  category_discounts?: { category_id: string; discount_type: DiscountType; discount_value: number }[]
  active?: boolean
  starts_at: string | null
  expires_at: string | null
  created_at?: string
}

export interface OrderItem {
  id?: string
  product_id: string
  product_name: string
  unit_price: number
  quantity: number
}

export interface CrmPurchaseEvent {
  product_id: string
  created_at: string
  quantity: number
}

export interface CrmOrderEvent {
  total: number
  created_at: string
}

export interface CrmCustomer {
  id: string
  name: string
  whatsapp: string
  birthdate: string | null
  total_spent: number
  order_count: number
  total_items: number
  first_order_at: string | null
  last_order_at: string | null
  neighborhoods: string[]
  purchases: CrmPurchaseEvent[]
  orders: CrmOrderEvent[]
  // Calculada no servidor (as coordenadas da loja nunca saem do banco) —
  // distância até o endereço de entrega mais recente do cliente.
  distance_km: number | null
}

export interface Order {
  id: string
  customer_name: string
  customer_whatsapp: string
  delivery_type: DeliveryType
  neighborhood: string | null
  address: string | null
  reference_point?: string | null
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  status: OrderStatus
  shipping_price: number
  total: number
  discount_amount?: number
  shipping_discount?: number
  coupon_code?: string | null
  promotion_id?: string | null
  motoboy_id: string | null
  motoboy_name?: string | null
  motoboy_whatsapp?: string | null
  // Origem do pedido — só vem preenchido pra admin/vendedor (admin_list_orders/
  // admin_update_order_status); nunca aparece pro cliente nem pro motoboy,
  // é controle interno de equipe.
  sold_by_role?: 'admin' | 'vendedor' | null
  sold_by_id?: string | null
  sold_by_name?: string | null
  pix_payment_id?: string | null
  pix_qr_base64?: string | null
  pix_copia_cola?: string | null
  customer_lat?: number | null
  customer_lng?: number | null
  motoboy_paid_at?: string | null
  delivery_started_at?: string | null
  delivered_at?: string | null
  items: OrderItem[]
  created_at: string
  updated_at?: string
}

export interface Motoboy {
  id: string
  name: string
  phone: string
  email: string
  whatsapp: string | null
  active: boolean
}

export interface Vendedor {
  id: string
  name: string
  email: string
  active: boolean
  commission_active: boolean
  commission_percent: number | null
}

export interface PdvSaleItemInput {
  product_id: string
  quantity: number
}

export interface PdvSale {
  id: string
  total: number
  payment_method: PaymentMethod
  customer_name: string
  created_at: string
  sold_by_role: 'admin' | 'vendedor'
  sold_by_id?: string | null
  sold_by_name?: string | null
  items: { product_name: string; quantity: number; unit_price: number }[]
}

export interface VendedorRelatorio {
  total_sales: number
  total_count: number
  sales: PdvSale[]
}

export interface MotoboyDelivery {
  id: string
  customer_name: string
  neighborhood: string | null
  shipping_price: number
  earned: number
  paid: boolean
  duration_minutes: number | null
  updated_at: string
}

export interface MotoboySettlement {
  id: string
  amount: number
  payment_method: PaymentMethod
  paid_at: string
}

export interface MotoboyFinanceiro {
  pending_amount: number
  total_paid: number
  total_deliveries: number
  total_shipping: number
  avg_delivery_minutes: number
  deliveries: MotoboyDelivery[]
  settlements: MotoboySettlement[]
}

export interface AdminMotoboyFinanceiro {
  id: string
  name: string
  total_deliveries: number
  total_shipping: number
  pending_amount: number
  total_paid: number
  avg_delivery_minutes: number
}

export interface MotoboyPending {
  pending_amount: number
  pending_deliveries: number | null
}

export interface MotoboyRun {
  id: string
  status: 'ativo' | 'concluido'
  current_index: number
  order_ids: string[]
  motoboy_lat: number | null
  motoboy_lng: number | null
  motoboy_heading: number | null
  started_at: string
  finished_at: string | null
  orders: Order[]
}

export interface DeliveryPosition {
  is_next_stop: boolean
  // Só vêm preenchidos quando is_next_stop é true — enquanto o motoboy
  // ainda está terminando outra entrega do lote, a posição dele fica
  // oculta pra esse pedido (mesma lógica do Uber/99: só mostra o
  // entregador quando ele já está a caminho de você).
  lat?: number
  lng?: number
  heading?: number | null
  updated_at?: string
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendente: 'Pendente',
  montando_pedido: 'Montando pedido',
  pedido_pronto: 'Pedido pronto',
  aguardando_localizacao: 'Aguardando localização',
  em_rota_de_entrega: 'Em rota de entrega',
  entregue: 'Entregue',
  retiradas: 'Aguardando retirada',
  concluido: 'Concluído',
}

export interface ShippingSettings {
  price_per_km: number
  max_km: number | null
}

// Fundo do site (SunsetBackdrop), ajustável em /admin/conta.
export type BgMode = 'svg1' | 'synthwave' | 'stars' | 'custom'
export type BgFit = 'meet' | 'slice'

export interface BgSettings {
  bg_mode: BgMode
  bg_image_url: string | null
  bg_scale: number
  bg_x: number
  bg_y: number
  bg_fit: BgFit
}

// Fumaça do botão do carrinho — velocidade, quantidade de baforadas,
// largura do container (onde elas se espalham) e altura (distância que
// sobem), ajustável em /admin/conta.
export interface SmokeSettings {
  smoke_speed: number
  smoke_count: number
  smoke_width: number
  smoke_height: number
}

// Badges de texto da landing (hero) — lista livre + layout lado a lado
// ou empilhado + espaçamento, ajustável em /admin/conta.
export interface LandingBadge {
  id: string
  text: string
  bold: boolean
}
export type BadgesLayout = 'row' | 'column'
export interface BadgesSettings {
  badges: LandingBadge[]
  badges_layout: BadgesLayout
  badges_gap: number
  badges_offset_y: number
}

// Estilo do carrossel de banners/promoções da landing, escolhido em
// /admin/promocoes — 'atual': um card só que troca de conteúdo sozinho;
// 'cards': cada card fica alguns segundos na tela e desliza pra esquerda
// pro próximo. Os dois aceitam arrastar manualmente (loop).
export type CarouselStyle = 'atual' | 'cards'

// Layout por página de cliente (imagem de fundo + elementos decorativos
// de fumaça/fogo), editável em /admin/layout-cliente. x/y são % da área
// de referência (0-100) — a tela toda pras 5 páginas, ou a própria
// caixinha do botão de carrinho pro alvo especial 'cart_icon' — com a
// BASE do elemento ancorada nesse ponto (fumaça/fogo sobem a partir
// dele). Mesmo sistema de coordenadas usado no preview do admin, pra
// posicionar lá renderizar EXATAMENTE no mesmo lugar proporcional na
// página/botão real. 'cart_icon' não tem imagem de fundo (não faz
// sentido pra um botão pequeno) e é global — aplica em toda tela que
// renderiza o CartFab, não numa rota específica.
export type PageKey = 'catalogo' | 'landing' | 'favoritos' | 'cupons' | 'historico' | 'cart_icon'
export type DecorElementType = 'smoke' | 'fire'
export interface PageDecorationElement {
  id: string
  type: DecorElementType
  x: number
  y: number
  width: number
  height: number
  blur: number
  opacity: number
  speed: number
  count: number
}
export interface PageDecoration {
  page_key: PageKey
  background_image_url: string | null
  elements: PageDecorationElement[]
}

export interface StoreHourInterval {
  opens_at: string // 'HH:MM', formato 24h (0-24)
  closes_at: string
}

export interface StoreHourDay {
  day_of_week: number // 0=domingo .. 6=sábado
  is_open: boolean
  intervals: StoreHourInterval[]
}

export interface StoreStatus {
  hours: StoreHourDay[]
  manually_closed: boolean
  manual_closed_reason: string | null
}

export interface ShippingEstimate {
  km: number
  price: number
  max_km: number | null
  within_range: boolean
}

// Formato exato varia entre versões da Evolution API — os campos abaixo
// cobrem as variações mais comuns; o componente que consome isso tenta
// vários caminhos possíveis em vez de confiar em um só.
export interface EvolutionStatus {
  instance?: { instanceName?: string; state?: string }
  state?: string
  [key: string]: unknown
}

export interface EvolutionConnect {
  base64?: string
  code?: string
  pairingCode?: string
  qrcode?: { base64?: string; code?: string; pairingCode?: string }
  [key: string]: unknown
}

export interface StatusCount {
  status: OrderStatus
  count: number
}

export interface TopProduct {
  product_id: string
  product_name: string
  quantity_sold: number
  revenue: number
}

export interface FinanceiroTimeseriesPoint {
  date: string
  quantity_sold: number
  revenue: number
  orders_count: number
  coupon_orders: number
  coupon_discount: number
  promotion_orders: number
  promotion_discount: number
}

export interface FinanceiroSummary {
  total_revenue: number
  // Soma de discount_amount + shipping_discount de pedidos pagos — quanto
  // foi "abrir mão da grana" em campanha/cupom. total_revenue já é líquido.
  total_discount_given: number
  total_orders: number
  orders_by_status: StatusCount[]
  top_products: TopProduct[]
  recent_orders: Order[]
  motoboys: AdminMotoboyFinanceiro[]
  avg_delivery_minutes: number
}
