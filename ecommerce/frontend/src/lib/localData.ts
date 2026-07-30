import { distanciaKm } from './geo/rotas'
import { FALLBACK as STORE_LOCATION } from './geo/mapa'
import { getDemoPlano, isDemoModeActive, planoIncludes } from './demoMode'
import type {
  BadgesLayout,
  BgFit,
  BgMode,
  CampanhaOrientation,
  CarouselStyle,
  Category,
  Coupon,
  CrmFilterCriteria,
  CrmSegment,
  LandingBadge,
  Motoboy,
  MotoboyRun,
  MotoboySettlement,
  Order,
  PageDecoration,
  Product,
  Promotion,
  StoreHourDay,
  Vendedor,
} from '../types'

export interface LocalMotoboy extends Motoboy {
  password: string
}

// Conta de cliente em modo demonstração — senha em texto puro, mesmo
// padrão já usado em LocalMotoboy/LocalVendedor (sem backend de verdade
// pra hashear, e não faz diferença nenhuma nesse modo).
export interface LocalCustomer {
  id: string
  name: string
  whatsapp: string
  email: string | null
  birthdate: string | null
  password: string | null
  createdAt: string
}
export interface LocalPasswordReset {
  id: string
  customerId: string
  code: string
  expiresAt: string
  used: boolean
}

export interface LocalVendedor extends Vendedor {
  password: string
}

export interface LocalSettlement extends MotoboySettlement {
  motoboy_id: string
}

export interface LocalRun extends Omit<MotoboyRun, 'orders'> {
  motoboy_id: string
}

// Concessão de cupom alvo (criado a partir de filtro no CRM) — intransferível,
// só o whatsapp exato pode usar, até granted_uses vezes.
export interface LocalCouponGrant {
  id: string
  coupon_id: string
  customer_whatsapp: string
  granted_uses: number
  used_count: number
  created_at: string
  // null/undefined = ainda não resgatado (ver botão "Resgatar cupom" em
  // /cliente/cupons) — não aparece em Ativos/Inativos até resgatar.
  claimed_at?: string | null
}

// "Campanha": notificação de WhatsApp + cupom exclusivo, atrelada a um
// segmento — ver CrmCampanhaCoupon em types.ts.
export interface LocalCampanhaCoupon {
  id: string
  segment_id: string
  coupon_id: string | null
  orientation: CampanhaOrientation
  name: string
  description: string | null
  starts_at: string | null
  ends_at: string | null
  trigger_criteria: CrmFilterCriteria | null
  trigger_description: string | null
  end_criteria: CrmFilterCriteria | null
  end_description: string | null
  message_template: string
  uses_per_customer: number
  active: boolean
  fired_at: string | null
  created_at: string
  last_synced_segment_criteria: CrmFilterCriteria | null
  schedule_delay_days: number | null
  schedule_hour: number | null
}

// Cupom extra de uma campanha (além do principal em LocalCampanhaCoupon.coupon_id).
export interface LocalCampanhaExtraCoupon {
  id: string
  campanha_id: string
  coupon_id: string
  message_template: string
  end_criteria: CrmFilterCriteria | null
  created_at: string
  schedule_delay_days: number | null
  schedule_hour: number | null
}

export interface LocalDb {
  categories: Category[]
  products: Product[]
  motoboys: LocalMotoboy[]
  vendedores: LocalVendedor[]
  orders: Order[]
  settlements: LocalSettlement[]
  runs: LocalRun[]
  promotions: Promotion[]
  coupons: Coupon[]
  couponGrants: LocalCouponGrant[]
  segments: CrmSegment[]
  campanhaCoupons: LocalCampanhaCoupon[]
  campanhaExtraCoupons: LocalCampanhaExtraCoupon[]
  customers: LocalCustomer[]
  customerPasswordResets: LocalPasswordReset[]
  customerFavorites: { customerId: string; productId: string; createdAt: string }[]
  pricePerKm: number
  maxKm: number | null
  heroImageUrl: string | null
  bgMode: BgMode
  bgImageUrl: string | null
  bgScale: number
  bgX: number
  bgY: number
  bgFit: BgFit
  smokeSpeed: number
  smokeCount: number
  smokeWidth: number
  smokeHeight: number
  badges: LandingBadge[]
  badgesLayout: BadgesLayout
  badgesGap: number
  badgesOffsetY: number
  carouselStyle: CarouselStyle
  pageDecorations: PageDecoration[]
  storeHours: StoreHourDay[]
  storeManuallyClosed: boolean
  storeManualClosedReason: string | null
  seedVersion?: number
}

// Mesma conta de sunset._distance_km/estimate_shipping do backend, só que
// em memória (modo demonstração, sem banco de verdade).
export function estimateShippingLocal(lat: number, lng: number, pricePerKm: number, maxKm: number | null = null) {
  const km = distanciaKm(STORE_LOCATION, { lat, lng })
  const roundedKm = Math.round(km * 100) / 100
  return {
    km: roundedKm,
    price: Math.round(km * pricePerKm * 100) / 100,
    max_km: maxKm,
    within_range: maxKm == null || roundedKm <= maxKm,
  }
}

export const ADMIN_CREDENTIALS = { email: 'pablo2@gmail.com', password: '123456', name: 'Admin Sunset Tabas' }
export const FAKE_MOTOBOY_ID = 'local-motoboy-seed'

// Fora do modo demo, sempre a mesma chave de sempre (não muda nada do
// modo demonstração original do Sunset). Em modo demo, uma chave por
// plano — pra alternar entre /demo/essential, /demo/management e
// /demo/premium sempre pra dados frescos, sem um "vazar" pro outro nem
// pro modo local normal.
function storageKey(): string {
  if (isDemoModeActive()) return `rodoletas_demo_db_v1_${getDemoPlano() ?? 'essential'}`
  return 'sonset_local_db_v1'
}

function uid() {
  return crypto.randomUUID()
}

function nowIso() {
  return new Date().toISOString()
}

function seedDb(): LocalDb {
  const catBebidas = uid()
  const catLanches = uid()
  const catSobremesas = uid()

  const categories: Category[] = [
    { id: catBebidas, name: 'Bebidas' },
    { id: catLanches, name: 'Lanches' },
    { id: catSobremesas, name: 'Sobremesas' },
  ]

  const prodRefri = uid()
  const prodSuco = uid()
  const prodMilkshake = uid()
  const prodSanduiche = uid()
  const prodBurger = uid()
  const prodBatata = uid()
  const prodPudim = uid()
  const prodBrownie = uid()

  // Imagens de fotografia pública (Unsplash), testadas uma a uma antes de
  // entrar aqui -- catálogo de demo não pode ter imagem quebrada.
  const products: Product[] = [
    { id: prodRefri, name: 'Refrigerante Lata', description: 'Refrigerante gelado 350ml', price: 6.0, quantity: 50, image_url: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800&q=80', category_id: catBebidas, active: true, cost_price: 2.5, low_stock_threshold: 15 },
    { id: prodSuco, name: 'Suco Natural', description: 'Suco de frutas da estação 500ml', price: 8.5, quantity: 30, image_url: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=800&q=80', category_id: catBebidas, active: true, cost_price: 3.5, low_stock_threshold: 10 },
    { id: prodMilkshake, name: 'Milk-shake', description: 'Cremoso, feito na hora — várias opções de sabor', price: 13.9, quantity: 24, image_url: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=800&q=80', category_id: catBebidas, active: true, cost_price: 6.0, low_stock_threshold: 8 },
    // Estoque baixo de propósito (5 <= ponto de reposição 8) -- pra aba
    // "Baixo estoque" de /admin/produtos já ter o que mostrar na demo.
    { id: prodSanduiche, name: 'Sanduíche Natural', description: 'Pão integral, frango desfiado e salada', price: 14.9, quantity: 5, image_url: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=800&q=80', category_id: catLanches, active: true, cost_price: 7.0, low_stock_threshold: 8 },
    { id: prodBurger, name: 'Hambúrguer Artesanal', description: 'Pão brioche, carne 180g, queijo e molho da casa', price: 24.9, quantity: 15, image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80', category_id: catLanches, active: true, cost_price: 11.0, low_stock_threshold: 5 },
    // Estoque zerado de propósito -- pra aba "Em falta" já ter o que
    // mostrar (e pra já demonstrar o "Esgotado" nas promoções que usam
    // este produto, dinâmica que já existia e continua valendo).
    { id: prodBatata, name: 'Batata Frita', description: 'Porção generosa, crocante por fora, macia por dentro', price: 16.9, quantity: 0, image_url: 'https://images.unsplash.com/photo-1481070555726-e2fe8357725c?w=800&q=80', category_id: catLanches, active: true, cost_price: 6.5, low_stock_threshold: 10 },
    { id: prodPudim, name: 'Pudim de Leite', description: 'Fatia individual de pudim caseiro', price: 9.9, quantity: 25, image_url: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=800&q=80', category_id: catSobremesas, active: true, cost_price: 4.0, low_stock_threshold: 10 },
    { id: prodBrownie, name: 'Brownie com Sorvete', description: 'Brownie de chocolate com bola de sorvete', price: 12.9, quantity: 18, image_url: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=800&q=80', category_id: catSobremesas, active: true, cost_price: 5.5, low_stock_threshold: 6 },
  ]

  const motoboys: LocalMotoboy[] = [
    {
      id: FAKE_MOTOBOY_ID,
      name: 'Motoboy Teste',
      phone: '83999990000',
      email: 'motoboy@sonset.com',
      password: 'motoboy123',
      whatsapp: '83999990000',
      active: true,
    },
  ]

  // Um pedido em cada etapa do fluxo, só pra /admin/pedidos e a fila do
  // motoboy não aparecerem vazios — no modo local "de verdade" (sem
  // demo) isso também passa a valer, já que a lista era sempre vazia
  // antes; nenhuma tela ganhou lógica nova, só teve dado de exemplo a mais.
  const orderBase = (over: Partial<Order>): Order => ({
    id: uid(),
    customer_name: 'Cliente Demo',
    customer_whatsapp: '5583999997777',
    delivery_type: 'entrega',
    neighborhood: 'Centro',
    address: 'Rua Demo, 456',
    payment_method: 'pix',
    payment_status: 'pago',
    status: 'pendente',
    shipping_price: 5,
    total: 0,
    motoboy_id: null,
    items: [],
    created_at: nowIso(),
    ...over,
  })

  const orders: Order[] = [
    orderBase({
      status: 'pendente',
      payment_method: 'pix',
      payment_status: 'pendente',
      total: 24.9 * 2,
      items: [{ product_id: prodBurger, product_name: 'Hambúrguer Artesanal', unit_price: 24.9, quantity: 2 }],
    }),
    orderBase({
      status: 'montando_pedido',
      total: 14.9,
      items: [{ product_id: prodSanduiche, product_name: 'Sanduíche Natural', unit_price: 14.9, quantity: 1 }],
    }),
    orderBase({
      status: 'pedido_pronto',
      payment_method: 'dinheiro',
      payment_status: 'pendente',
      total: 6.0 * 3,
      items: [{ product_id: prodRefri, product_name: 'Refrigerante Lata', unit_price: 6.0, quantity: 3 }],
    }),
    orderBase({
      status: 'em_rota_de_entrega',
      payment_method: 'dinheiro',
      payment_status: 'pendente',
      motoboy_id: FAKE_MOTOBOY_ID,
      total: 9.9 * 2,
      items: [{ product_id: prodPudim, product_name: 'Pudim de Leite', unit_price: 9.9, quantity: 2 }],
    }),
    orderBase({
      status: 'concluido',
      delivery_type: 'retirada',
      neighborhood: null,
      address: null,
      shipping_price: 0,
      total: 12.9,
      items: [{ product_id: prodBrownie, product_name: 'Brownie com Sorvete', unit_price: 12.9, quantity: 1 }],
    }),
  ]

  // Cupons avulsos (qualquer um digita o código) + os dois usados pelas
  // campanhas abaixo (esses só chegam ao cliente via concessão/grant, não
  // tem como digitar o código sem ganhar primeiro).
  const couponBemVindo = uid()
  const couponFrete = uid()
  const couponVolta15 = uid()
  const couponFiel20 = uid()

  const coupons: Coupon[] = [
    {
      id: couponBemVindo,
      code: 'BEMVINDO10',
      kind: 'desconto',
      description: 'Cupom avulso de boas-vindas',
      discount_type: 'percent',
      discount_value: 10,
      shipping_discount_type: null,
      shipping_discount_value: null,
      allow_promotion_checkout: true,
      combinable_with_public: false,
      active: true,
      starts_at: null,
      expires_at: null,
      max_uses: null,
      used_count: 3,
      created_at: nowIso(),
      grant_count: 0,
    },
    {
      id: couponFrete,
      code: 'FRETEGRATIS',
      kind: 'frete',
      description: 'Cupom avulso de frete grátis',
      discount_type: 'percent',
      discount_value: 100,
      shipping_discount_type: null,
      shipping_discount_value: null,
      allow_promotion_checkout: true,
      combinable_with_public: false,
      active: true,
      starts_at: null,
      expires_at: null,
      max_uses: null,
      used_count: 1,
      created_at: nowIso(),
      grant_count: 0,
    },
    {
      id: couponVolta15,
      code: 'VOLTA15',
      kind: 'desconto',
      description: 'Cupom exclusivo da campanha "Sentimos sua falta"',
      discount_type: 'percent',
      discount_value: 15,
      shipping_discount_type: null,
      shipping_discount_value: null,
      allow_promotion_checkout: true,
      combinable_with_public: false,
      active: true,
      starts_at: null,
      expires_at: null,
      max_uses: null,
      used_count: 0,
      created_at: nowIso(),
      grant_count: 1,
    },
    {
      id: couponFiel20,
      code: 'FIEL20',
      kind: 'desconto',
      description: 'Cupom exclusivo da campanha "Recompensa fidelidade"',
      discount_type: 'percent',
      discount_value: 20,
      shipping_discount_type: null,
      shipping_discount_value: null,
      allow_promotion_checkout: true,
      combinable_with_public: false,
      active: true,
      starts_at: null,
      expires_at: null,
      max_uses: null,
      used_count: 0,
      created_at: nowIso(),
      grant_count: 1,
    },
  ]

  // Segmentos do CRM + 2 campanhas de exemplo: uma orientada a SEGMENTO
  // (dispara pra quem já está no grupo "clientes fiéis") e outra
  // orientada a EVENTO (dispara sozinha quando um cliente cruza o
  // critério "sumido há 30+ dias", independente de segmento fixo).
  const EMPTY_FILTER: CrmFilterCriteria = {
    minOrders: '', minOrdersDays: '', minItems: '', minItemsDays: '',
    spentBelowAmount: '', spentBelowDays: '', spentAboveAmount: '', spentAboveDays: '',
    frequencyDropPercent: '', frequencyIncreasePercent: '', newCustomerDays: '',
    maxDistanceKm: '', neighborhoods: [], birthdayMonth: '',
    recurringProductIds: [], recurringCategoryIds: [], recurringDays: '',
  }
  const fieisFilter: CrmFilterCriteria = { ...EMPTY_FILTER, minOrders: '3', minOrdersDays: '90' }
  const sumidosFilter: CrmFilterCriteria = { ...EMPTY_FILTER, spentAboveDays: '30' }

  const segmentFieis = uid()
  const segmentSumidos = uid()

  const segments: CrmSegment[] = [
    { id: segmentFieis, name: 'Clientes fiéis', description: '3 ou mais pedidos nos últimos 90 dias', filter_criteria: fieisFilter, created_at: nowIso() },
    { id: segmentSumidos, name: 'Clientes sumidos', description: 'Sem comprar há mais de 30 dias', filter_criteria: sumidosFilter, created_at: nowIso() },
  ]

  const campanhaCoupons: LocalCampanhaCoupon[] = [
    {
      id: uid(),
      segment_id: segmentFieis,
      coupon_id: couponFiel20,
      orientation: 'segmento',
      name: 'Recompensa fidelidade',
      description: 'Cupom automático pros clientes mais fiéis da casa.',
      starts_at: nowIso(),
      ends_at: null,
      trigger_criteria: null,
      trigger_description: null,
      end_criteria: null,
      end_description: null,
      message_template: 'Você é cliente fiel demais! 🎉 Toma 20% de desconto no seu próximo pedido: {codigo}',
      uses_per_customer: 1,
      active: true,
      fired_at: nowIso(),
      created_at: nowIso(),
      last_synced_segment_criteria: fieisFilter,
      schedule_delay_days: null,
      schedule_hour: null,
    },
    {
      id: uid(),
      segment_id: segmentSumidos,
      coupon_id: couponVolta15,
      orientation: 'evento',
      name: 'Sentimos sua falta',
      description: 'Dispara sozinha quando um cliente completa 30 dias sem comprar.',
      starts_at: nowIso(),
      ends_at: null,
      trigger_criteria: sumidosFilter,
      trigger_description: 'Cliente sem comprar há mais de 30 dias',
      end_criteria: null,
      end_description: null,
      message_template: 'Faz tempo que a gente não te vê por aqui 🥺 Volta com 15% de desconto: {codigo}',
      uses_per_customer: 1,
      active: true,
      fired_at: null,
      created_at: nowIso(),
      last_synced_segment_criteria: sumidosFilter,
      schedule_delay_days: null,
      schedule_hour: null,
    },
  ]

  // Cliente de demonstração já cadastrado (whatsapp 83 99999-9999, senha
  // 1234 — login em /catalogo, /cliente/* etc) — loga direto sem precisar
  // criar conta, com um favorito, um pedido no histórico e DOIS cupons
  // exclusivos esperando pra ser resgatados (mesmo fluxo de raspadinha de
  // sempre, só que sem precisar setar isso tudo na mão antes de mostrar a
  // demo). Dois grants em vez de um só pra dar pra testar o gesto de
  // arrastar + resgate do CouponSlot mais de uma vez seguida.
  const demoCustomerId = uid()
  const demoCustomerWhatsapp = '5583999999999'
  const customers: LocalCustomer[] = [
    { id: demoCustomerId, name: 'Ana Cliente', whatsapp: demoCustomerWhatsapp, email: 'ana@exemplo.com', birthdate: '1996-04-12', password: '1234', createdAt: nowIso() },
  ]
  const customerFavorites = [{ customerId: demoCustomerId, productId: prodBurger, createdAt: nowIso() }]
  const couponGrants: LocalCouponGrant[] = [
    { id: uid(), coupon_id: couponFiel20, customer_whatsapp: demoCustomerWhatsapp, granted_uses: 1, used_count: 0, created_at: nowIso(), claimed_at: null },
    { id: uid(), coupon_id: couponVolta15, customer_whatsapp: demoCustomerWhatsapp, granted_uses: 1, used_count: 0, created_at: nowIso(), claimed_at: null },
  ]

  // +55 concessões extras pra resgatar, só do cliente demo -- pra testar
  // o gesto de arrastar+revelar do CouponSlot muitas vezes seguidas sem
  // precisar recarregar a semente. Cada uma cria seu próprio Coupon (não
  // reaproveita os 4 de cima) pra variar valor/tipo/kind entre elas.
  const EXTRA_COUPON_TEMPLATES: Array<Pick<Coupon, 'kind' | 'discount_type' | 'discount_value' | 'shipping_discount_type' | 'shipping_discount_value'>> = [
    { kind: 'desconto', discount_type: 'percent', discount_value: 10, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'desconto', discount_type: 'percent', discount_value: 15, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'desconto', discount_type: 'percent', discount_value: 25, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'desconto', discount_type: 'fixed', discount_value: 5, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'desconto', discount_type: 'fixed', discount_value: 12, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'frete', discount_type: 'percent', discount_value: 100, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'frete', discount_type: 'percent', discount_value: 50, shipping_discount_type: null, shipping_discount_value: null },
    { kind: 'aniversario', discount_type: 'percent', discount_value: 20, shipping_discount_type: null, shipping_discount_value: null },
  ]
  for (let i = 1; i <= 55; i++) {
    const tpl = EXTRA_COUPON_TEMPLATES[(i - 1) % EXTRA_COUPON_TEMPLATES.length]
    const extraCouponId = uid()
    coupons.push({
      id: extraCouponId,
      code: `SEED${String(i).padStart(3, '0')}`,
      kind: tpl.kind,
      description: 'Cupom exclusivo de demonstração',
      discount_type: tpl.discount_type,
      discount_value: tpl.discount_value,
      shipping_discount_type: tpl.shipping_discount_type,
      shipping_discount_value: tpl.shipping_discount_value,
      allow_promotion_checkout: true,
      combinable_with_public: false,
      active: true,
      starts_at: null,
      expires_at: null,
      max_uses: null,
      used_count: 0,
      created_at: nowIso(),
      grant_count: 1,
    })
    couponGrants.push({ id: uid(), coupon_id: extraCouponId, customer_whatsapp: demoCustomerWhatsapp, granted_uses: 1, used_count: 0, created_at: nowIso(), claimed_at: null })
  }

  orders.push(
    orderBase({
      customer_whatsapp: demoCustomerWhatsapp,
      customer_name: 'Ana Cliente',
      status: 'concluido',
      total: 24.9 + 16.9,
      items: [
        { product_id: prodBurger, product_name: 'Hambúrguer Artesanal', unit_price: 24.9, quantity: 1 },
        { product_id: prodBatata, product_name: 'Batata Frita', unit_price: 16.9, quantity: 1 },
      ],
    })
  )

  // Pedido do cliente demo já EM ROTA DE ENTREGA, com motoboy de verdade
  // (corrida "ativa" abaixo) -- é o único jeito de /consultar (e o mapa
  // de rastreio, ANEXO A) terem algo pra mostrar sem precisar simular
  // manualmente uma corrida pelo /motoboy antes. customer_lat/lng perto
  // da loja (STORE_LOCATION em lib/geo/mapa.ts) pra o mapa enquadrar bem;
  // motoboy_lat/lng no meio do caminho, já se movendo.
  const emRotaOrderId = uid()
  orders.push({
    id: emRotaOrderId,
    customer_name: 'Ana Cliente',
    customer_whatsapp: demoCustomerWhatsapp,
    delivery_type: 'entrega',
    neighborhood: 'Tambaú',
    address: 'Av. Rui Carneiro, 320',
    payment_method: 'pix',
    payment_status: 'pago',
    status: 'em_rota_de_entrega',
    shipping_price: 6,
    total: 24.9 + 6.0,
    motoboy_id: FAKE_MOTOBOY_ID,
    customer_lat: -7.169,
    customer_lng: -34.849,
    items: [
      { product_id: prodBurger, product_name: 'Hambúrguer Artesanal', unit_price: 24.9, quantity: 1 },
      { product_id: prodRefri, product_name: 'Refrigerante Lata', unit_price: 6.0, quantity: 1 },
    ],
    created_at: nowIso(),
  })
  const runs: LocalRun[] = [
    {
      id: uid(),
      motoboy_id: FAKE_MOTOBOY_ID,
      status: 'ativo',
      current_index: 0,
      order_ids: [emRotaOrderId],
      motoboy_lat: -7.172,
      motoboy_lng: -34.8535,
      motoboy_heading: 45,
      started_at: nowIso(),
      finished_at: null,
    },
  ]

  // Banners da landing (carrossel) — 6 cards (imagem real testada uma a
  // uma antes de entrar aqui), pra o carrossel ter volume de verdade pra
  // rodar o loop contínuo + swipe (ver PromoCarousel.tsx de cada
  // uiux*). Cada card leva pra /banner?promocao=:id (kit = carrinho
  // fechado e tudo-ou-nada; selfie_service = "monte seu carrinho", o
  // cliente escolhe quanto de cada item quer).
  const promotions: Promotion[] = [
    {
      id: uid(),
      title: 'Combo Turbo: Burger + Batata + Refri',
      subtitle: 'Só até domingo',
      image_url: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=1200&q=80',
      product_ids: [prodBurger, prodBatata, prodRefri],
      promotion_type: 'kit',
      discount_type: 'percent',
      discount_value: 20,
      shipping_discount_type: null,
      shipping_discount_value: null,
      active: true,
      starts_at: null,
      expires_at: null,
      created_at: nowIso(),
    },
    {
      id: uid(),
      title: 'Sextou com Milk-shake',
      subtitle: '20% off em todos os sabores',
      image_url: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=1200&q=80',
      product_ids: [prodMilkshake],
      promotion_type: 'selfie_service',
      discount_type: null,
      discount_value: null,
      shipping_discount_type: null,
      shipping_discount_value: null,
      product_discounts: [{ product_id: prodMilkshake, discount_type: 'percent', discount_value: 20 }],
      active: true,
      starts_at: null,
      expires_at: null,
      created_at: nowIso(),
    },
    {
      id: uid(),
      title: 'Trio Faminto: Sanduíche + Batata + Refri',
      subtitle: 'Kit fechado com 15% off',
      image_url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1200&q=80',
      product_ids: [prodSanduiche, prodBatata, prodRefri],
      promotion_type: 'kit',
      discount_type: 'percent',
      discount_value: 15,
      shipping_discount_type: null,
      shipping_discount_value: null,
      active: true,
      starts_at: null,
      expires_at: null,
      created_at: nowIso(),
    },
    {
      id: uid(),
      title: 'Dupla Doce: Pudim + Suco',
      subtitle: '20% off no kit',
      image_url: 'https://images.unsplash.com/photo-1594007654729-407eedc4be65?w=1200&q=80',
      product_ids: [prodPudim, prodSuco],
      promotion_type: 'kit',
      discount_type: 'percent',
      discount_value: 20,
      shipping_discount_type: null,
      shipping_discount_value: null,
      active: true,
      starts_at: null,
      expires_at: null,
      created_at: nowIso(),
    },
    {
      id: uid(),
      title: 'Semana do Hambúrguer',
      subtitle: '18% off, monte seu pedido',
      image_url: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=1200&q=80',
      product_ids: [prodBurger],
      promotion_type: 'selfie_service',
      discount_type: null,
      discount_value: null,
      shipping_discount_type: null,
      shipping_discount_value: null,
      product_discounts: [{ product_id: prodBurger, discount_type: 'percent', discount_value: 18 }],
      active: true,
      starts_at: null,
      expires_at: null,
      created_at: nowIso(),
    },
    {
      id: uid(),
      title: 'Sobremesa em Dobro',
      subtitle: 'Pudim e brownie com 15% off',
      image_url: 'https://images.unsplash.com/photo-1622973536968-3ead9e780960?w=1200&q=80',
      product_ids: [prodPudim, prodBrownie],
      promotion_type: 'selfie_service',
      discount_type: null,
      discount_value: null,
      shipping_discount_type: null,
      shipping_discount_value: null,
      product_discounts: [
        { product_id: prodPudim, discount_type: 'percent', discount_value: 15 },
        { product_id: prodBrownie, discount_type: 'percent', discount_value: 15 },
      ],
      active: true,
      starts_at: null,
      expires_at: null,
      created_at: nowIso(),
    },
  ]

  const demo = isDemoModeActive()

  return {
    categories,
    products,
    motoboys,
    vendedores: [],
    orders,
    settlements: [],
    runs,
    promotions,
    coupons,
    couponGrants,
    segments,
    campanhaCoupons,
    campanhaExtraCoupons: [],
    customers,
    customerPasswordResets: [],
    customerFavorites,
    pricePerKm: 1.5,
    maxKm: null,
    heroImageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200&q=80',
    // Fundo padrão da demo é liso (a cor do tom escolhido na paleta
    // white-label, ver DemoPaletteSwitcher) -- a cena pôr-do-sol/palmeiras
    // é específica da marca Sunset. Continua editável pelo admin em
    // /admin/layout-cliente, exatamente como sempre foi.
    bgMode: demo ? 'custom' : 'svg1',
    bgImageUrl: null,
    bgScale: 1,
    bgX: 0,
    bgY: 0,
    bgFit: 'meet',
    smokeSpeed: 3,
    smokeCount: 9,
    smokeWidth: 64,
    smokeHeight: 70,
    badges: demo
      ? [
          { id: '1', text: '🔥 Mais de 5 mil pedidos entregues', bold: true },
          { id: '2', text: '⚡ Pedido pronto em até 20 minutos', bold: false },
          { id: '3', text: '⭐ 4,9 de 5 — o point mais pedido da cidade', bold: false },
        ]
      : [
          { id: '1', text: 'SUNSET • Desde 2023', bold: true },
          { id: '2', text: '🔥 Experiência, vibe e essência', bold: false },
          { id: '3', text: '👇 A vibe começa aqui', bold: false },
        ],
    badgesLayout: 'row',
    badgesGap: 8,
    badgesOffsetY: 0,
    // 'cards' (carrossel deslizante) como padrão pra quem tem direito a
    // promoção (management/premium) -- essential nem chega a buscar
    // promoção nenhuma (ver Landing.tsx), então não faz diferença pra ele.
    carouselStyle: demo && planoIncludes('management') ? 'cards' : 'atual',
    pageDecorations: [],
    // Aberta 24h no dado semeado -- sem isso a demo cai em "loja fechada"
    // fora do 09-18, dependendo de que horas são quando alguém testa.
    storeHours: Array.from({ length: 7 }, (_, day_of_week) => ({
      day_of_week,
      is_open: true,
      intervals: [{ opens_at: '00:00', closes_at: '23:59' }],
    })),
    storeManuallyClosed: false,
    storeManualClosedReason: null,
    seedVersion: DEMO_SEED_VERSION,
  }
}

// Sobe toda vez que seedDb() muda de um jeito que precisa forçar reseed
// (produto/cupom/campanha/promoção novos etc) — só em modo demo, senão
// quem já tinha dado de verdade digitado no modo local normal perdia
// tudo a cada mudança daqui. Sem isso, quem já tinha testado a demo antes
// ficava preso na versão antiga (salva no localStorage) pra sempre.
const DEMO_SEED_VERSION = 6

export function loadDb(): LocalDb {
  const raw = localStorage.getItem(storageKey())
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LocalDb & { seedVersion?: number }
      if (!isDemoModeActive() || parsed.seedVersion === DEMO_SEED_VERSION) return parsed
    } catch {
      // corrupted, fall through to reseed
    }
  }
  const fresh = seedDb()
  saveDb(fresh)
  return fresh
}

export function saveDb(db: LocalDb) {
  localStorage.setItem(storageKey(), JSON.stringify(db))
}

export { uid, nowIso }
