// Frontend-only "backend": persists everything in localStorage instead of
// calling a real API. Used when no backend is configured (see api.ts) so the
// site can be demoed on Vercel alone. Mirrors the Rust backend's business
// rules (status flow, stock checks, shipping calc, financeiro aggregation)
// as closely as practical — see backend/src/status_flow.rs and
// backend/src/routes/*.rs for the source of truth this was ported from.
import QRCode from 'qrcode'
import { ApiError } from './apiError'
import {
  ADMIN_CREDENTIALS,
  FAKE_MOTOBOY_ID,
  loadDb,
  saveDb,
  nowIso,
  uid,
  estimateShippingLocal,
  type LocalCampanhaCoupon,
  type LocalCustomer,
  type LocalDb,
  type LocalMotoboy,
  type LocalRun,
  type LocalVendedor,
} from './localData'
import type { PromotionalProduct } from './supabasePublicApi'
import { distanciaKm } from './geo/rotas'
import { FALLBACK as STORE_LOCATION } from './geo/mapa'
import { isScheduledOpenNow } from './storeHours'
import { useVendedorAuth } from '../store/vendedorAuth'
import { useMotoboyAuth } from '../store/motoboyAuth'
import type {
  BadgesLayout,
  BadgesSettings,
  BgFit,
  BgMode,
  BgSettings,
  CarouselStyle,
  LandingBadge,
  PageDecoration,
  PageDecorationElement,
  PageKey,
  Promotion,
  Category,
  Coupon,
  CouponGrant,
  Customer,
  CustomerAuthResult,
  DeliveryPosition,
  FinanceiroSummary,
  Motoboy,
  MotoboyRun,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  Product,
  ShippingEstimate,
  ShippingSettings,
  SmokeSettings,
  StatusCount,
  StoreHourDay,
  StoreStatus,
  TopProduct,
  Vendedor,
  VendedorRelatorio,
} from './types'

function notifyLocal(phone: string, message: string) {
  console.info(`[demo] WhatsApp para ${phone}: ${message}`)
}

function productDto(db: LocalDb, p: Product): Product {
  const cat = db.categories.find((c) => c.id === p.category_id)
  return { ...p, category_name: cat?.name ?? null }
}

function stripPassword(m: LocalMotoboy): Motoboy {
  const { password: _password, ...rest } = m
  return rest
}

function currentMotoboyId(): string {
  const token = useMotoboyAuth.getState().token
  if (!token || !token.startsWith('local-motoboy:')) {
    throw new ApiError(401, 'not authenticated')
  }
  return token.slice('local-motoboy:'.length)
}

function fakePixCode(): string {
  const rand = uid().replace(/-/g, '').slice(0, 25).toUpperCase()
  return `00020126580014BR.GOV.BCB.PIX0136${rand}5204000053039865802BR5912SUNSET TABAS6009SAO PAULO62070503***6304ABCD`
}

// ---------- status flow (mirrors backend/src/status_flow.rs) ----------

function confirmPaymentIfNeeded(
  paymentMethod: PaymentMethod,
  paymentStatus: string,
  paymentConfirmed?: boolean
): boolean {
  if (paymentMethod === 'pix') {
    if (paymentStatus !== 'pago') throw new ApiError(400, 'pix payment has not been confirmed yet')
    return false
  }
  if (paymentConfirmed !== true) {
    throw new ApiError(400, 'payment_confirmed: true is required to complete this order')
  }
  return true
}

function adminApplyTransition(order: Order, target: string, paymentConfirmed?: boolean): boolean {
  const current = order.status
  if (current === 'pendente' && target === 'montando_pedido') return false
  if (current === 'montando_pedido' && target === 'pedido_pronto') return false
  if (current === 'pedido_pronto' && target === 'retiradas') {
    if (order.delivery_type !== 'retirada') {
      throw new ApiError(400, 'only retirada orders can move to retiradas')
    }
    return false
  }
  if (current === 'retiradas' && target === 'concluido') {
    if (order.delivery_type !== 'retirada') {
      throw new ApiError(400, 'only retirada orders can be concluded from retiradas')
    }
    return confirmPaymentIfNeeded(order.payment_method, order.payment_status, paymentConfirmed)
  }
  throw new ApiError(400, `invalid status transition: ${current} -> ${target}`)
}

// ---------- public / customer-facing ----------

async function listCategoriesPublic(): Promise<Category[]> {
  const db = loadDb()
  return [...db.categories].sort((a, b) => a.name.localeCompare(b.name))
}

async function listProducts(categoryId?: string): Promise<Product[]> {
  const db = loadDb()
  return db.products
    .filter((p) => p.active && (!categoryId || p.category_id === categoryId))
    .map((p) => productDto(db, p))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function getProduct(id: string): Promise<Product> {
  const db = loadDb()
  const p = db.products.find((x) => x.id === id && x.active)
  if (!p) throw new ApiError(404, 'product not found')
  return productDto(db, p)
}

async function productSalesCounts(): Promise<{ product_id: string; sold_count: number }[]> {
  const db = loadDb()
  const counts = new Map<string, number>()
  for (const o of db.orders) {
    if (o.payment_status !== 'pago') continue
    for (const item of o.items) counts.set(item.product_id, (counts.get(item.product_id) ?? 0) + item.quantity)
  }
  return Array.from(counts, ([product_id, sold_count]) => ({ product_id, sold_count }))
}

async function createOrder(payload: {
  customer_name: string
  customer_whatsapp: string
  customer_birthdate: string
  delivery_type: 'entrega' | 'retirada'
  neighborhood?: string
  address?: string
  reference_point?: string
  customer_lat?: number
  customer_lng?: number
  payment_method: 'pix' | 'cartao' | 'dinheiro'
  items: { product_id: string; quantity: number }[]
  coupon_code?: string
  promotion_id?: string
}): Promise<Order> {
  const db = loadDb()

  if (!payload.items || payload.items.length === 0) {
    throw new ApiError(400, 'order must have at least one item')
  }
  if (!['entrega', 'retirada'].includes(payload.delivery_type)) {
    throw new ApiError(400, 'invalid delivery_type')
  }
  if (!['pix', 'cartao', 'dinheiro'].includes(payload.payment_method)) {
    throw new ApiError(400, 'invalid payment_method')
  }
  if (!payload.customer_name.trim() || !payload.customer_whatsapp.trim()) {
    throw new ApiError(400, 'customer_name and customer_whatsapp are required')
  }
  if (!payload.customer_birthdate) {
    throw new ApiError(400, 'birthdate is required')
  }
  const birthdate = new Date(payload.customer_birthdate)
  const age = (Date.now() - birthdate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  if (age < 18) {
    throw new ApiError(400, 'you must be 18 or older to purchase tobacco products')
  }

  let promotion: Promotion | undefined
  if (payload.promotion_id) {
    promotion = (db.promotions ?? []).find((c) => c.id === payload.promotion_id && c.active !== false)
    if (!promotion) throw new ApiError(400, 'promotion is not available')
    if (payload.items.some((item) => !promotion!.product_ids.includes(item.product_id))) {
      throw new ApiError(400, 'this promotion checkout can only contain the promotion products')
    }
    if (promotion.promotion_type === 'kit') {
      const submittedIds = new Set(payload.items.map((i) => i.product_id))
      const promotionIds = new Set(promotion.product_ids)
      const sameSet = submittedIds.size === promotionIds.size && [...promotionIds].every((id) => submittedIds.has(id))
      if (!sameSet) throw new ApiError(400, 'this kit promotion can only be purchased as the full bundle')
    }
  }

  let subtotal = 0
  const items = []
  for (const item of payload.items) {
    if (item.quantity <= 0) throw new ApiError(400, 'item quantity must be positive')
    const product = db.products.find((p) => p.id === item.product_id)
    if (!product) throw new ApiError(400, `product ${item.product_id} not found`)
    if (!product.active) throw new ApiError(400, `product ${product.name} is not available`)
    if (product.quantity < item.quantity) {
      throw new ApiError(400, `insufficient stock for product ${product.name}`)
    }
    subtotal += product.price * item.quantity
    items.push({
      product_id: product.id,
      product_name: product.name,
      unit_price: product.price,
      quantity: item.quantity,
    })
  }

  // selfie_service: desconto por produto, somado durante o loop de itens
  // (mesma lógica de coupon kind='produto') — kit usa discount_type/value
  // sobre o subtotal somado, tratado mais abaixo.
  let selfieServiceDiscount = 0
  if (promotion?.promotion_type === 'selfie_service') {
    for (const item of payload.items) {
      const pd = (promotion.product_discounts ?? []).find((p) => p.product_id === item.product_id)
      if (!pd) continue
      const product = db.products.find((p) => p.id === item.product_id)!
      const lineTotal = product.price * item.quantity
      selfieServiceDiscount += pd.discount_type === 'percent' ? (lineTotal * pd.discount_value) / 100 : Math.min(pd.discount_value * item.quantity, lineTotal)
    }
  }

  let shippingPrice = 0
  if (payload.delivery_type === 'entrega') {
    if (payload.customer_lat == null || payload.customer_lng == null) {
      throw new ApiError(400, 'customer_lat and customer_lng are required for delivery orders')
    }
    const estimate = estimateShippingLocal(payload.customer_lat, payload.customer_lng, db.pricePerKm, db.maxKm ?? null)
    if (!estimate.within_range) {
      throw new ApiError(400, `delivery address is ${estimate.km} km away, which exceeds the maximum delivery range of ${estimate.max_km} km`)
    }
    shippingPrice = estimate.price
  }

  let discountAmount = 0
  let shippingDiscount = 0

  if (promotion) {
    if (promotion.promotion_type === 'kit') {
      if (promotion.discount_type === 'percent') discountAmount += (subtotal * (promotion.discount_value ?? 0)) / 100
      else if (promotion.discount_type === 'fixed') discountAmount += promotion.discount_value ?? 0
    } else {
      discountAmount += selfieServiceDiscount
    }
    if (promotion.shipping_discount_type === 'percent') shippingDiscount += (shippingPrice * (promotion.shipping_discount_value ?? 0)) / 100
    else if (promotion.shipping_discount_type === 'fixed') shippingDiscount += promotion.shipping_discount_value ?? 0
  }

  const birthMonth = new Date(payload.customer_birthdate).getMonth()
  let couponCode: string | null = null
  if (payload.coupon_code && payload.coupon_code.trim()) {
    const coupon = (db.coupons ?? []).find((c) => c.code.toUpperCase() === payload.coupon_code!.trim().toUpperCase())
    if (!coupon) throw new ApiError(400, 'coupon not found')
    if (!coupon.active) throw new ApiError(400, 'coupon is not active')
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) {
      throw new ApiError(400, 'coupon has expired')
    }
    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
      throw new ApiError(400, 'coupon usage limit reached')
    }
    if (promotion && !coupon.allow_promotion_checkout) {
      throw new ApiError(400, 'this coupon cannot be combined with a promotion checkout')
    }
    if (coupon.kind === 'aniversario' && new Date().getMonth() !== birthMonth) {
      throw new ApiError(400, 'this coupon is only valid during your birthday month')
    }
    // Cupom alvo (com concessões, ou nascido de uma campanha orientation=
    // evento que ainda não disparou pra ninguém): intransferível, consome a
    // concessão do whatsapp exato em vez do contador global.
    const grants = (db.couponGrants ?? []).filter((g) => g.coupon_id === coupon.id)
    const isCampanhaCoupon = (db.campanhaCoupons ?? []).some((c) => c.coupon_id === coupon.id)
    if (grants.length > 0 || isCampanhaCoupon) {
      const grant = grants.find((g) => g.customer_whatsapp === payload.customer_whatsapp && g.used_count < g.granted_uses)
      if (!grant) throw new ApiError(400, 'this coupon is not available for your account')
      grant.used_count += 1
    }
    if (coupon.kind === 'frete') {
      // legado: discount_type/value É a taxa de frete
      if (coupon.discount_type === 'percent') shippingDiscount += (shippingPrice * (coupon.discount_value ?? 0)) / 100
      else shippingDiscount += coupon.discount_value ?? 0
    } else {
      if (coupon.kind === 'desconto' && coupon.discount_type) {
        discountAmount +=
          coupon.discount_type === 'percent' ? (subtotal * (coupon.discount_value ?? 0)) / 100 : coupon.discount_value ?? 0
      }
      if (coupon.kind === 'produto') {
        for (const item of payload.items) {
          const pd = (coupon.product_discounts ?? []).find((p) => p.product_id === item.product_id)
          if (!pd) continue
          const product = db.products.find((p) => p.id === item.product_id)!
          const lineTotal = product.price * item.quantity
          discountAmount += pd.discount_type === 'percent' ? (lineTotal * pd.discount_value) / 100 : Math.min(pd.discount_value * item.quantity, lineTotal)
        }
      }
      if (coupon.shipping_discount_type) {
        shippingDiscount +=
          coupon.shipping_discount_type === 'percent'
            ? (shippingPrice * (coupon.shipping_discount_value ?? 0)) / 100
            : coupon.shipping_discount_value ?? 0
      }
    }
    coupon.used_count += 1
    couponCode = coupon.code
  }

  discountAmount = Math.min(Math.max(discountAmount, 0), subtotal)
  shippingDiscount = Math.min(Math.max(shippingDiscount, 0), shippingPrice)
  const total = subtotal - discountAmount + shippingPrice - shippingDiscount

  for (const item of payload.items) {
    const product = db.products.find((p) => p.id === item.product_id)!
    product.quantity -= item.quantity
  }

  const order: Order = {
    id: uid(),
    customer_name: payload.customer_name.trim(),
    customer_whatsapp: payload.customer_whatsapp.trim(),
    delivery_type: payload.delivery_type,
    neighborhood: payload.delivery_type === 'retirada' ? null : payload.neighborhood ?? null,
    address: payload.delivery_type === 'retirada' ? null : payload.address ?? null,
    reference_point: payload.delivery_type === 'retirada' ? null : payload.reference_point ?? null,
    customer_lat: payload.delivery_type === 'retirada' ? null : payload.customer_lat ?? null,
    customer_lng: payload.delivery_type === 'retirada' ? null : payload.customer_lng ?? null,
    payment_method: payload.payment_method,
    payment_status: 'pendente',
    status: 'pendente',
    shipping_price: shippingPrice,
    total,
    discount_amount: discountAmount,
    shipping_discount: shippingDiscount,
    coupon_code: couponCode,
    promotion_id: promotion?.id ?? null,
    motoboy_id: null,
    pix_payment_id: null,
    pix_qr_base64: null,
    pix_copia_cola: null,
    items,
    created_at: nowIso(),
    updated_at: nowIso(),
  }

  if (payload.payment_method === 'pix') {
    const copiaCola = fakePixCode()
    order.pix_payment_id = `local-${uid()}`
    order.pix_copia_cola = copiaCola
    order.pix_qr_base64 = await QRCode.toDataURL(copiaCola)
  }

  db.orders.push(order)
  saveDb(db)
  return order
}

async function getOrder(id: string): Promise<Order> {
  const db = loadDb()
  const order = db.orders.find((o) => o.id === id)
  if (!order) throw new ApiError(404, 'order not found')
  return order
}

async function trackOrders(whatsapp: string): Promise<Order[]> {
  const db = loadDb()
  return db.orders
    .filter((o) => o.customer_whatsapp === whatsapp)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ---------- campanhas / cupons (público) ----------

function promotionIsActive(c: Promotion): boolean {
  const now = Date.now()
  if (c.active === false) return false
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return false
  if (c.expires_at && new Date(c.expires_at).getTime() <= now) return false
  return true
}

async function listActivePromotions(): Promise<Promotion[]> {
  const db = loadDb()
  return (db.promotions ?? []).filter(promotionIsActive).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

async function getPromotionPublic(id: string): Promise<Promotion> {
  const db = loadDb()
  const c = (db.promotions ?? []).find((x) => x.id === id && promotionIsActive(x))
  if (!c) throw new ApiError(404, 'promotion not found')
  return c
}

type CouponPreviewLocal = Pick<
  Coupon,
  | 'code'
  | 'kind'
  | 'discount_type'
  | 'discount_value'
  | 'shipping_discount_type'
  | 'shipping_discount_value'
  | 'product_discounts'
  | 'allow_promotion_checkout'
  | 'combinable_with_public'
>

function couponPreview(c: Coupon): CouponPreviewLocal {
  return {
    code: c.code,
    kind: c.kind,
    discount_type: c.discount_type,
    discount_value: c.discount_value,
    shipping_discount_type: c.shipping_discount_type,
    shipping_discount_value: c.shipping_discount_value,
    product_discounts: c.product_discounts ?? [],
    allow_promotion_checkout: c.allow_promotion_checkout,
    combinable_with_public: c.combinable_with_public,
  }
}

async function validateCouponPublic(
  code: string,
  promotionId?: string,
  customerBirthdate?: string,
  customerWhatsapp?: string
): Promise<CouponPreviewLocal> {
  const db = loadDb()
  const coupon = (db.coupons ?? []).find((c) => c.code.toUpperCase() === code.trim().toUpperCase())
  if (!coupon) throw new ApiError(400, 'coupon not found')
  if (!coupon.active) throw new ApiError(400, 'coupon is not active')
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) {
    throw new ApiError(400, 'coupon has expired')
  }
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
    throw new ApiError(400, 'coupon usage limit reached')
  }
  if (promotionId && !coupon.allow_promotion_checkout) {
    throw new ApiError(400, 'this coupon cannot be combined with a promotion checkout')
  }
  if (coupon.kind === 'aniversario') {
    const birthMonth = customerBirthdate ? new Date(customerBirthdate).getMonth() : null
    if (birthMonth == null || birthMonth !== new Date().getMonth()) {
      throw new ApiError(400, 'this coupon is only valid during your birthday month')
    }
  }
  const grants = (db.couponGrants ?? []).filter((g) => g.coupon_id === coupon.id)
  const isCampanhaCoupon = (db.campanhaCoupons ?? []).some((c) => c.coupon_id === coupon.id)
  if (grants.length > 0 || isCampanhaCoupon) {
    const grant = grants.find((g) => g.customer_whatsapp === customerWhatsapp && g.used_count < g.granted_uses)
    if (!grant) throw new ApiError(400, 'this coupon is not available for your account')
  }
  return couponPreview(coupon)
}

async function listCustomerCouponsPublic(customerWhatsapp: string): Promise<CouponPreviewLocal[]> {
  const db = loadDb()
  const now = Date.now()
  return (db.couponGrants ?? [])
    .filter((g) => g.customer_whatsapp === customerWhatsapp && g.used_count < g.granted_uses)
    .map((g) => (db.coupons ?? []).find((c) => c.id === g.coupon_id))
    .filter((c): c is Coupon => !!c && c.active && (!c.expires_at || new Date(c.expires_at).getTime() > now))
    .map(couponPreview)
}

async function listPromotionalProducts(): Promise<PromotionalProduct[]> {
  const db = loadDb()
  const now = Date.now()
  const grantedCouponIds = new Set((db.couponGrants ?? []).map((g) => g.coupon_id))
  const campanhaCouponIds = new Set((db.campanhaCoupons ?? []).map((c) => c.coupon_id))
  const out: PromotionalProduct[] = []
  for (const c of db.coupons ?? []) {
    if (c.kind !== 'produto' || !c.active) continue
    if (c.expires_at && new Date(c.expires_at).getTime() <= now) continue
    if (c.max_uses != null && c.used_count >= c.max_uses) continue
    if (grantedCouponIds.has(c.id) || campanhaCouponIds.has(c.id)) continue
    for (const pd of c.product_discounts ?? []) {
      out.push({ product_id: pd.product_id, coupon_code: c.code, discount_type: pd.discount_type, discount_value: pd.discount_value })
    }
  }
  return out
}

// Modo demo já gera o QR na hora de criar o pedido (ver createOrder) — não
// existe uma etapa separada de "criar cobrança" aqui, então isso só devolve
// o pedido como já está, só pra bater com a assinatura do backend real.
async function createPixPayment(id: string): Promise<Order> {
  return getOrder(id)
}

async function refreshPayment(id: string): Promise<Order> {
  // Nenhuma AbacatePay de verdade pra consultar em modo demo — espelha o
  // modo mock do backend, que também nunca confirma sozinho sem
  // simulate-pix-paid.
  return getOrder(id)
}

async function simulatePixPaid(id: string): Promise<Order> {
  const db = loadDb()
  const order = db.orders.find((o) => o.id === id)
  if (!order) throw new ApiError(404, 'order not found')
  if (order.payment_method !== 'pix') throw new ApiError(400, 'order is not a pix payment')
  if (order.payment_status !== 'pago') {
    order.payment_status = 'pago'
    order.updated_at = nowIso()
    notifyLocal(
      order.customer_whatsapp,
      `Recebemos seu pagamento! Seu pedido #${order.id.slice(0, 8)} já está sendo preparado. 🌇`
    )
    saveDb(db)
  }
  return order
}

// ---------- auth ----------

async function adminLogin(email: string, password: string): Promise<{ token: string; name: string }> {
  if (email === ADMIN_CREDENTIALS.email && password === ADMIN_CREDENTIALS.password) {
    return { token: 'local-admin-token', name: ADMIN_CREDENTIALS.name }
  }
  throw new ApiError(401, 'invalid credentials')
}

async function motoboyLogin(email: string, password: string): Promise<{ token: string; name: string }> {
  const db = loadDb()
  const m = db.motoboys.find((x) => x.email === email)
  if (!m || !m.active || m.password !== password) throw new ApiError(401, 'invalid credentials')
  return { token: `local-motoboy:${m.id}`, name: m.name }
}

async function setAdminPassword(newPassword: string): Promise<void> {
  if (newPassword.trim().length < 6) throw new ApiError(400, 'new password must be at least 6 characters')
  ADMIN_CREDENTIALS.password = newPassword
}

// ---------- customer auth ----------
// Sem sunset.sessions em modo demo: o token já carrega o id direto
// ("local-customer:<id>"), mesmo truque do motoboyLogin acima.

function toCustomer(c: LocalCustomer): Customer {
  return { id: c.id, name: c.name, whatsapp: c.whatsapp, email: c.email, birthdate: c.birthdate }
}

function customerIdFromToken(token: string): string {
  return token.startsWith('local-customer:') ? token.slice('local-customer:'.length) : ''
}

async function customerRegister(payload: {
  whatsapp: string
  password: string
  name: string
  email: string
  birthdate: string
}): Promise<CustomerAuthResult> {
  if (!payload.name.trim()) throw new ApiError(400, 'name is required')
  if (payload.whatsapp.replace(/\D/g, '').length < 10) throw new ApiError(400, 'a valid whatsapp is required')
  if (!payload.email.trim()) throw new ApiError(400, 'email is required')
  if (!payload.birthdate.trim()) throw new ApiError(400, 'birthdate is required')
  if (!/^[0-9]{4}$/.test(payload.password)) throw new ApiError(400, 'password must be exactly 4 digits')

  const db = loadDb()
  db.customers = db.customers ?? []
  let c = db.customers.find((x) => x.whatsapp === payload.whatsapp)
  if (c?.password) throw new ApiError(400, 'this whatsapp is already registered')
  if (c) {
    c.name = payload.name.trim()
    c.email = payload.email.trim()
    c.birthdate = payload.birthdate
    c.password = payload.password
  } else {
    c = {
      id: uid(),
      name: payload.name.trim(),
      whatsapp: payload.whatsapp,
      email: payload.email.trim(),
      birthdate: payload.birthdate,
      password: payload.password,
      createdAt: nowIso(),
    }
    db.customers.push(c)
  }
  saveDb(db)
  return { token: `local-customer:${c.id}`, customer: toCustomer(c) }
}

async function customerLogin(whatsapp: string, password: string): Promise<CustomerAuthResult> {
  const db = loadDb()
  const c = (db.customers ?? []).find((x) => x.whatsapp === whatsapp)
  if (!c || !c.password || c.password !== password) throw new ApiError(401, 'invalid credentials')
  return { token: `local-customer:${c.id}`, customer: toCustomer(c) }
}

async function customerMe(token: string): Promise<Customer> {
  const db = loadDb()
  const c = (db.customers ?? []).find((x) => x.id === customerIdFromToken(token))
  if (!c) throw new ApiError(401, 'unauthorized')
  return toCustomer(c)
}

// Modo demo não tem WhatsApp de verdade — gera e loga o código no console
// (mesmo padrão do resto do app, ver README "[demo] WhatsApp para ...").
async function customerRequestPasswordReset(whatsapp: string): Promise<void> {
  const db = loadDb()
  const c = (db.customers ?? []).find((x) => x.whatsapp === whatsapp && x.password)
  if (!c) return
  db.customerPasswordResets = db.customerPasswordResets ?? []
  const code = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  db.customerPasswordResets.push({
    id: uid(),
    customerId: c.id,
    code,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    used: false,
  })
  saveDb(db)
  console.info(`[demo] WhatsApp para ${whatsapp}: seu código de recuperação é ${code}`)
}

function findValidResetCode(db: LocalDb, customerId: string, code: string) {
  return (db.customerPasswordResets ?? []).find(
    (r) => r.customerId === customerId && r.code === code && !r.used && new Date(r.expiresAt).getTime() > Date.now()
  )
}

async function customerVerifyResetCode(whatsapp: string, code: string): Promise<void> {
  const db = loadDb()
  const c = (db.customers ?? []).find((x) => x.whatsapp === whatsapp)
  if (!c || !findValidResetCode(db, c.id, code)) throw new ApiError(400, 'invalid code')
}

async function customerResetPassword(whatsapp: string, code: string, newPassword: string): Promise<void> {
  if (!/^[0-9]{4}$/.test(newPassword)) throw new ApiError(400, 'password must be exactly 4 digits')
  const db = loadDb()
  const c = (db.customers ?? []).find((x) => x.whatsapp === whatsapp)
  const reset = c && findValidResetCode(db, c.id, code)
  if (!c || !reset) throw new ApiError(400, 'invalid code')
  c.password = newPassword
  reset.used = true
  saveDb(db)
}

// /cliente/favoritos, /cliente/cupons, /cliente/historico.

async function customerToggleFavorite(token: string, productId: string): Promise<boolean> {
  const db = loadDb()
  const customerId = customerIdFromToken(token)
  db.customerFavorites = db.customerFavorites ?? []
  const idx = db.customerFavorites.findIndex((f) => f.customerId === customerId && f.productId === productId)
  if (idx >= 0) {
    db.customerFavorites.splice(idx, 1)
    saveDb(db)
    return false
  }
  db.customerFavorites.push({ customerId, productId, createdAt: nowIso() })
  saveDb(db)
  return true
}

async function customerListFavorites(token: string): Promise<Product[]> {
  const db = loadDb()
  const customerId = customerIdFromToken(token)
  const ids = new Set((db.customerFavorites ?? []).filter((f) => f.customerId === customerId).map((f) => f.productId))
  return db.products.filter((p) => ids.has(p.id))
}

function couponIsUsable(grant: import('./localData').LocalCouponGrant, coupon: Coupon | undefined) {
  if (!coupon) return false
  if (grant.used_count >= grant.granted_uses) return false
  if (!coupon.active) return false
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) return false
  return true
}

// Igual sunset.customer_has_claimable_coupon / customer_claim_coupon no
// banco de verdade — grant concedido mas ainda não resgatado na raspadinha
// não conta como usável nem aparece em Ativos/Inativos.
function couponIsClaimable(grant: import('./localData').LocalCouponGrant, coupon: Coupon | undefined) {
  return !grant.claimed_at && couponIsUsable(grant, coupon)
}

async function customerHasClaimableCoupon(token: string): Promise<boolean> {
  const db = loadDb()
  const c = db.customers.find((x) => x.id === customerIdFromToken(token))
  const whatsapp = c?.whatsapp ?? ''
  const couponById = new Map(db.coupons.map((x) => [x.id, x]))
  return (db.couponGrants ?? []).some((g) => g.customer_whatsapp === whatsapp && couponIsClaimable(g, couponById.get(g.coupon_id)))
}

// Só PRÉ-VISUALIZA (não marca claimed_at) -- pode ser chamada quantas
// vezes o cliente recarregar a página da raspadinha, sem gastar cupom
// nenhum. Resgate de verdade só acontece em customerClaimCoupon, chamada
// apenas quando ele termina de raspar.
async function customerPeekClaimableCoupon(token: string): Promise<import('./types').ClaimedCoupon> {
  const db = loadDb()
  const c = db.customers.find((x) => x.id === customerIdFromToken(token))
  const whatsapp = c?.whatsapp ?? ''
  const couponById = new Map(db.coupons.map((x) => [x.id, x]))
  const grants = (db.couponGrants ?? [])
    .filter((g) => g.customer_whatsapp === whatsapp && couponIsClaimable(g, couponById.get(g.coupon_id)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const grant = grants[0]
  if (!grant) throw new ApiError(400, 'no coupon available to claim')

  const coupon = couponById.get(grant.coupon_id)
  return {
    grant_id: grant.id,
    coupon_id: grant.coupon_id,
    code: coupon?.code ?? '',
    kind: coupon?.kind ?? 'desconto',
    discount_type: coupon?.discount_type ?? null,
    discount_value: coupon?.discount_value ?? null,
    shipping_discount_type: coupon?.shipping_discount_type ?? null,
    shipping_discount_value: coupon?.shipping_discount_value ?? null,
    granted_uses: grant.granted_uses,
    used_count: grant.used_count,
    expires_at: coupon?.expires_at ?? null,
  }
}

async function customerClaimCoupon(token: string): Promise<import('./types').ClaimedCoupon> {
  const db = loadDb()
  const c = db.customers.find((x) => x.id === customerIdFromToken(token))
  const whatsapp = c?.whatsapp ?? ''
  const couponById = new Map(db.coupons.map((x) => [x.id, x]))
  const grants = (db.couponGrants ?? [])
    .filter((g) => g.customer_whatsapp === whatsapp && couponIsClaimable(g, couponById.get(g.coupon_id)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const grant = grants[0]
  if (!grant) throw new ApiError(400, 'no coupon available to claim')

  grant.claimed_at = nowIso()
  saveDb(db)

  // description NUNCA vai pro cliente (nota interna do admin sobre o cupom).
  const coupon = couponById.get(grant.coupon_id)
  return {
    grant_id: grant.id,
    coupon_id: grant.coupon_id,
    code: coupon?.code ?? '',
    kind: coupon?.kind ?? 'desconto',
    discount_type: coupon?.discount_type ?? null,
    discount_value: coupon?.discount_value ?? null,
    shipping_discount_type: coupon?.shipping_discount_type ?? null,
    shipping_discount_value: coupon?.shipping_discount_value ?? null,
    granted_uses: grant.granted_uses,
    used_count: grant.used_count,
    expires_at: coupon?.expires_at ?? null,
  }
}

async function customerListCoupons(token: string): Promise<import('./types').CustomerCoupons> {
  const db = loadDb()
  const customerId = customerIdFromToken(token)
  const c = db.customers.find((x) => x.id === customerId)
  const whatsapp = c?.whatsapp ?? ''
  const couponById = new Map(db.coupons.map((x) => [x.id, x]))
  const grants = (db.couponGrants ?? []).filter((g) => g.customer_whatsapp === whatsapp)

  const toEntry = (g: (typeof grants)[number]) => {
    const coupon = couponById.get(g.coupon_id)
    return {
      grant_id: g.id,
      coupon_id: g.coupon_id,
      code: coupon?.code ?? '',
      kind: coupon?.kind ?? 'desconto',
      discount_type: coupon?.discount_type ?? null,
      discount_value: coupon?.discount_value ?? null,
      shipping_discount_type: coupon?.shipping_discount_type ?? null,
      shipping_discount_value: coupon?.shipping_discount_value ?? null,
      granted_uses: g.granted_uses,
      used_count: g.used_count,
      expires_at: coupon?.expires_at ?? null,
      created_at: g.created_at,
    }
  }

  // Grant ainda não resgatado na raspadinha (claimed_at null) não aparece
  // em nenhuma das duas abas -- só some da lista até ser resgatado.
  const active = grants.filter((g) => g.claimed_at && couponIsUsable(g, couponById.get(g.coupon_id))).map(toEntry)
  const inactive = grants.filter((g) => g.claimed_at && !couponIsUsable(g, couponById.get(g.coupon_id))).map(toEntry)
  const history = db.orders
    .filter((o) => o.customer_whatsapp === whatsapp && o.coupon_code)
    .map((o) => ({
      order_id: o.id,
      coupon_code: o.coupon_code as string,
      created_at: o.created_at,
      total: o.total,
      discount_amount: o.discount_amount ?? null,
      shipping_discount: o.shipping_discount ?? null,
    }))

  return { active, inactive, history }
}

async function customerListOrders(token: string): Promise<Order[]> {
  const db = loadDb()
  const c = db.customers.find((x) => x.id === customerIdFromToken(token))
  if (!c) return []
  return trackOrders(c.whatsapp)
}

// ---------- admin ----------

async function adminListCategories(): Promise<Category[]> {
  return listCategoriesPublic()
}

async function createCategory(name: string): Promise<Category> {
  if (!name.trim()) throw new ApiError(400, 'name is required')
  const db = loadDb()
  if (db.categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new ApiError(400, 'category name already exists')
  }
  const category = { id: uid(), name: name.trim() }
  db.categories.push(category)
  saveDb(db)
  return category
}

async function deleteCategory(id: string): Promise<void> {
  const db = loadDb()
  const idx = db.categories.findIndex((c) => c.id === id)
  if (idx === -1) throw new ApiError(404, 'category not found')
  db.categories.splice(idx, 1)
  for (const p of db.products) if (p.category_id === id) p.category_id = null
  saveDb(db)
}

async function adminListProducts(): Promise<Product[]> {
  const db = loadDb()
  return db.products.map((p) => productDto(db, p)).sort((a, b) => a.name.localeCompare(b.name))
}

async function createProduct(payload: Partial<Product>): Promise<Product> {
  if (!payload.name?.trim()) throw new ApiError(400, 'name is required')
  const db = loadDb()
  const product: Product = {
    id: uid(),
    name: payload.name.trim(),
    description: payload.description ?? null,
    price: payload.price ?? 0,
    quantity: payload.quantity ?? 0,
    image_url: payload.image_url ?? null,
    category_id: payload.category_id ?? null,
    active: payload.active ?? true,
  }
  db.products.push(product)
  saveDb(db)
  return productDto(db, product)
}

async function updateProduct(id: string, payload: Partial<Product>): Promise<Product> {
  const db = loadDb()
  const product = db.products.find((p) => p.id === id)
  if (!product) throw new ApiError(404, 'product not found')
  product.name = payload.name ?? product.name
  product.description = payload.description ?? null
  product.price = payload.price ?? product.price
  product.quantity = payload.quantity ?? product.quantity
  product.image_url = payload.image_url ?? null
  product.category_id = payload.category_id ?? null
  product.active = payload.active ?? true
  saveDb(db)
  return productDto(db, product)
}

// Sem backend real no modo demo: converte pra data URL direto no navegador,
// funciona como preview mas não persiste em lugar nenhum de verdade.
async function uploadProductImage(file: File): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ url: reader.result as string })
    reader.onerror = () => reject(new ApiError(400, 'Erro ao ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

async function deleteProduct(id: string): Promise<void> {
  const db = loadDb()
  const idx = db.products.findIndex((p) => p.id === id)
  if (idx === -1) throw new ApiError(404, 'product not found')
  db.products.splice(idx, 1)
  saveDb(db)
}

async function adminListMotoboys(): Promise<Motoboy[]> {
  const db = loadDb()
  return db.motoboys.map(stripPassword).sort((a, b) => a.name.localeCompare(b.name))
}

async function createMotoboy(payload: {
  name: string
  phone: string
  email: string
  password: string
  whatsapp?: string
}): Promise<Motoboy> {
  if (!payload.password) throw new ApiError(400, 'password is required to create a motoboy')
  const db = loadDb()
  if (db.motoboys.some((m) => m.email === payload.email)) {
    throw new ApiError(400, 'email already in use')
  }
  const motoboy: LocalMotoboy = {
    id: uid(),
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    password: payload.password,
    whatsapp: payload.whatsapp ?? null,
    active: true,
  }
  db.motoboys.push(motoboy)
  saveDb(db)
  return stripPassword(motoboy)
}

async function updateMotoboy(
  id: string,
  payload: Partial<Motoboy> & { password?: string }
): Promise<Motoboy> {
  const db = loadDb()
  const motoboy = db.motoboys.find((m) => m.id === id)
  if (!motoboy) throw new ApiError(404, 'motoboy not found')
  if (payload.name !== undefined) motoboy.name = payload.name
  if (payload.phone !== undefined) motoboy.phone = payload.phone
  if (payload.email !== undefined) motoboy.email = payload.email
  if (payload.active !== undefined) motoboy.active = payload.active
  if (payload.whatsapp !== undefined) motoboy.whatsapp = payload.whatsapp
  if (payload.password) motoboy.password = payload.password
  saveDb(db)
  return stripPassword(motoboy)
}

// Entregas concluídas de um motoboy que ainda não foram repassadas
// (motoboy_paid_at ainda não setado) — 100% do frete é dele, sem comissão.
function pendingForMotoboy(db: LocalDb, motoboyId: string) {
  const pending = db.orders.filter(
    (o) => o.motoboy_id === motoboyId && o.status === 'concluido' && o.delivery_type === 'entrega' && !o.motoboy_paid_at
  )
  const amount = Math.round(pending.reduce((sum, o) => sum + o.shipping_price, 0) * 100) / 100
  return { orderIds: pending.map((o) => o.id), amount }
}

function durationMinutes(o: Order): number | null {
  if (!o.delivery_started_at || !o.delivered_at) return null
  const ms = new Date(o.delivered_at).getTime() - new Date(o.delivery_started_at).getTime()
  return Math.round((ms / 60000) * 10) / 10
}

function avgDeliveryMinutes(orders: Order[]): number {
  const durations = orders.map(durationMinutes).filter((d): d is number => d != null)
  if (durations.length === 0) return 0
  return Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
}

async function motoboyPending(id: string): Promise<import('./types').MotoboyPending> {
  const db = loadDb()
  const { orderIds, amount } = pendingForMotoboy(db, id)
  return { pending_amount: amount, pending_deliveries: orderIds.length || null }
}

async function payMotoboy(id: string, paymentMethod: PaymentMethod): Promise<import('./types').MotoboySettlement> {
  const db = loadDb()
  const { orderIds, amount } = pendingForMotoboy(db, id)
  if (amount <= 0) throw new ApiError(400, 'motoboy has nothing pending to pay')
  const paidAt = nowIso()
  for (const orderId of orderIds) {
    const order = db.orders.find((o) => o.id === orderId)
    if (order) order.motoboy_paid_at = paidAt
  }
  const settlement = { id: uid(), motoboy_id: id, amount, payment_method: paymentMethod, paid_at: paidAt }
  db.settlements.push(settlement)
  saveDb(db)
  return settlement
}

async function getMotoboyPassword(id: string): Promise<string | null> {
  const db = loadDb()
  const motoboy = db.motoboys.find((m) => m.id === id)
  if (!motoboy) throw new ApiError(404, 'motoboy not found')
  return motoboy.password ?? null
}

async function deleteMotoboy(id: string): Promise<void> {
  const db = loadDb()
  const idx = db.motoboys.findIndex((m) => m.id === id)
  if (idx === -1) throw new ApiError(404, 'motoboy not found')
  db.motoboys.splice(idx, 1)
  for (const o of db.orders) if (o.motoboy_id === id) o.motoboy_id = null
  saveDb(db)
}

// ---------- vendedor + PDV ----------

function stripVendedorPassword(v: LocalVendedor): Vendedor {
  const { password: _password, ...rest } = v
  return rest
}

async function vendedorLogin(email: string, password: string): Promise<{ token: string; name: string }> {
  const db = loadDb()
  const v = (db.vendedores ?? []).find((x) => x.email === email)
  if (!v || !v.active || v.password !== password) throw new ApiError(401, 'invalid credentials')
  return { token: `local-vendedor:${v.id}`, name: v.name }
}

async function adminListVendedores(): Promise<Vendedor[]> {
  const db = loadDb()
  return (db.vendedores ?? []).map(stripVendedorPassword).sort((a, b) => a.name.localeCompare(b.name))
}

async function createVendedor(payload: {
  name: string
  email: string
  password: string
  commission_active?: boolean
  commission_percent?: number
}): Promise<Vendedor> {
  if (!payload.password) throw new ApiError(400, 'password is required to create a vendedor')
  const db = loadDb()
  db.vendedores = db.vendedores ?? []
  if (db.vendedores.some((v) => v.email === payload.email)) throw new ApiError(400, 'email already in use')
  const vendedor: LocalVendedor = {
    id: uid(),
    name: payload.name,
    email: payload.email,
    password: payload.password,
    active: true,
    commission_active: payload.commission_active ?? false,
    commission_percent: payload.commission_active ? payload.commission_percent ?? null : null,
  }
  db.vendedores.push(vendedor)
  saveDb(db)
  return stripVendedorPassword(vendedor)
}

async function updateVendedor(
  id: string,
  payload: {
    name: string
    email: string
    active: boolean
    password?: string
    commission_active?: boolean
    commission_percent?: number
  }
): Promise<Vendedor> {
  const db = loadDb()
  const vendedor = (db.vendedores ?? []).find((v) => v.id === id)
  if (!vendedor) throw new ApiError(404, 'vendedor not found')
  vendedor.name = payload.name
  vendedor.email = payload.email
  vendedor.active = payload.active
  vendedor.commission_active = payload.commission_active ?? false
  vendedor.commission_percent = payload.commission_active ? payload.commission_percent ?? null : null
  if (payload.password) vendedor.password = payload.password
  saveDb(db)
  return stripVendedorPassword(vendedor)
}

async function getVendedorPassword(id: string): Promise<string | null> {
  const db = loadDb()
  const vendedor = (db.vendedores ?? []).find((v) => v.id === id)
  if (!vendedor) throw new ApiError(404, 'vendedor not found')
  return vendedor.password ?? null
}

async function deleteVendedor(id: string): Promise<void> {
  const db = loadDb()
  const idx = (db.vendedores ?? []).findIndex((v) => v.id === id)
  if (idx === -1) throw new ApiError(404, 'vendedor not found')
  db.vendedores.splice(idx, 1)
  saveDb(db)
}

// ---------- cupons (admin) ----------

function withGrantCount(db: LocalDb, coupon: Coupon): Coupon {
  return { ...coupon, grant_count: (db.couponGrants ?? []).filter((g) => g.coupon_id === coupon.id).length }
}

async function adminListCoupons(): Promise<Coupon[]> {
  const db = loadDb()
  return [...(db.coupons ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((c) => withGrantCount(db, c))
}

async function createCoupon(payload: {
  code: string
  discount_type?: 'percent' | 'fixed'
  discount_value?: number
  shipping_discount_type?: 'percent' | 'fixed'
  shipping_discount_value?: number
  allow_promotion_checkout?: boolean
  combinable_with_public?: boolean
  starts_at?: string
  expires_at?: string
  max_uses?: number
  product_discounts?: import('./types').ProductDiscount[]
  message_template?: string
  bday_customer_days_before?: number
  bday_store_date?: string
  bday_store_days_before?: number
  description?: string
}): Promise<Coupon> {
  const db = loadDb()
  db.coupons = db.coupons ?? []
  const code = payload.code.trim().toUpperCase()
  if (!code) throw new ApiError(400, 'code is required')
  if (db.coupons.some((c) => c.code === code)) throw new ApiError(400, 'a coupon with this code already exists')
  const hasProducts = payload.product_discounts && payload.product_discounts.length > 0
  if (!hasProducts && !payload.discount_type && !payload.shipping_discount_type) {
    throw new ApiError(400, 'a coupon needs at least one discount (produto, desconto and/or frete)')
  }
  const hasBday = payload.bday_customer_days_before != null || !!payload.bday_store_date
  if (hasBday && (!payload.message_template?.trim() || !payload.message_template.includes('/nome') || !payload.message_template.includes('/cupom'))) {
    throw new ApiError(400, 'message_template must mention /nome and /cupom')
  }
  const kind: 'desconto' | 'produto' = hasProducts ? 'produto' : 'desconto'
  const coupon: Coupon = {
    id: uid(),
    code,
    kind,
    discount_type: kind === 'produto' ? null : payload.discount_type ?? null,
    discount_value: kind === 'produto' ? null : payload.discount_value ?? null,
    shipping_discount_type: payload.shipping_discount_type ?? null,
    shipping_discount_value: payload.shipping_discount_value ?? null,
    product_discounts: hasProducts ? payload.product_discounts! : [],
    allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
    combinable_with_public: payload.combinable_with_public ?? false,
    active: true,
    starts_at: payload.starts_at || null,
    expires_at: payload.expires_at || null,
    max_uses: payload.max_uses ?? null,
    used_count: 0,
    created_at: nowIso(),
    message_template: payload.message_template?.trim() || null,
    bday_customer_days_before: payload.bday_customer_days_before ?? null,
    bday_store_date: payload.bday_store_date || null,
    bday_store_days_before: payload.bday_store_days_before ?? null,
    description: payload.description?.trim() || null,
  }
  db.coupons.push(coupon)
  saveDb(db)
  return withGrantCount(db, coupon)
}

async function updateCoupon(
  id: string,
  payload: {
    active: boolean
    allow_promotion_checkout: boolean
    combinable_with_public?: boolean
    starts_at?: string
    expires_at?: string
    max_uses?: number
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    shipping_discount_type?: 'percent' | 'fixed'
    shipping_discount_value?: number
    product_discounts?: import('./types').ProductDiscount[]
    message_template?: string
    bday_customer_days_before?: number
    bday_store_date?: string
    bday_store_days_before?: number
    description?: string
  }
): Promise<Coupon> {
  const db = loadDb()
  const coupon = (db.coupons ?? []).find((c) => c.id === id)
  if (!coupon) throw new ApiError(404, 'coupon not found')
  const hasProducts = payload.product_discounts && payload.product_discounts.length > 0
  if (!hasProducts && !payload.discount_type && !payload.shipping_discount_type) {
    throw new ApiError(400, 'a coupon needs at least one discount (produto, desconto and/or frete)')
  }
  const hasBday = payload.bday_customer_days_before != null || !!payload.bday_store_date
  if (hasBday && (!payload.message_template?.trim() || !payload.message_template.includes('/nome') || !payload.message_template.includes('/cupom'))) {
    throw new ApiError(400, 'message_template must mention /nome and /cupom')
  }
  const kind: 'desconto' | 'produto' = hasProducts ? 'produto' : 'desconto'
  coupon.kind = kind
  coupon.active = payload.active
  coupon.discount_type = kind === 'produto' ? null : payload.discount_type ?? null
  coupon.discount_value = kind === 'produto' ? null : payload.discount_value ?? null
  coupon.shipping_discount_type = payload.shipping_discount_type ?? null
  coupon.shipping_discount_value = payload.shipping_discount_value ?? null
  coupon.product_discounts = hasProducts ? payload.product_discounts! : []
  coupon.allow_promotion_checkout = payload.allow_promotion_checkout
  coupon.combinable_with_public = payload.combinable_with_public ?? false
  coupon.starts_at = payload.starts_at || null
  coupon.expires_at = payload.expires_at || null
  coupon.max_uses = payload.max_uses ?? null
  coupon.message_template = payload.message_template?.trim() || null
  coupon.bday_customer_days_before = payload.bday_customer_days_before ?? null
  coupon.bday_store_date = payload.bday_store_date || null
  coupon.bday_store_days_before = payload.bday_store_days_before ?? null
  coupon.description = payload.description?.trim() || null
  saveDb(db)
  return withGrantCount(db, coupon)
}

// Concede (idempotente) os cupons de aniversário cujo dia de disparo é
// HOJE — espelha admin_check_birthday_coupons. Modo demonstração não tem
// uma tabela de clientes com data de nascimento (só pedidos), então não
// há como calcular aniversário aqui — fica de fora só no modo local; a
// versão de produção (Supabase) usa sunset.customers.birthdate de verdade.
async function checkBirthdayCoupons(): Promise<{ coupon_id: string; message_template: string; newly_granted: string[] }[]> {
  return []
}

async function updateTargetedCoupon(
  id: string,
  payload: {
    active: boolean
    uses_per_customer?: number
    combinable_with_public?: boolean
    allow_promotion_checkout?: boolean
    expires_at?: string
    max_uses?: number
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    shipping_discount_type?: 'percent' | 'fixed'
    shipping_discount_value?: number
    product_discounts?: import('./types').ProductDiscount[]
  }
): Promise<Coupon> {
  const db = loadDb()
  const coupon = (db.coupons ?? []).find((c) => c.id === id)
  if (!coupon) throw new ApiError(404, 'coupon not found')
  const hasProducts = payload.product_discounts && payload.product_discounts.length > 0
  const kind: 'desconto' | 'frete' | 'produto' = hasProducts ? 'produto' : payload.discount_type ? 'desconto' : 'frete'
  coupon.active = payload.active
  coupon.kind = kind
  coupon.discount_type = kind === 'produto' ? null : payload.discount_type ?? null
  coupon.discount_value = kind === 'produto' ? null : payload.discount_value ?? null
  coupon.shipping_discount_type = payload.shipping_discount_type ?? null
  coupon.shipping_discount_value = payload.shipping_discount_value ?? null
  coupon.product_discounts = hasProducts ? payload.product_discounts! : []
  coupon.combinable_with_public = payload.combinable_with_public ?? false
  coupon.allow_promotion_checkout = payload.allow_promotion_checkout ?? false
  coupon.expires_at = payload.expires_at || null
  coupon.max_uses = payload.max_uses ?? null
  for (const g of db.couponGrants ?? []) {
    if (g.coupon_id === id) g.granted_uses = payload.uses_per_customer ?? 1
  }
  saveDb(db)
  return withGrantCount(db, coupon)
}

async function deleteCoupon(id: string): Promise<void> {
  const db = loadDb()
  const idx = (db.coupons ?? []).findIndex((c) => c.id === id)
  if (idx === -1) throw new ApiError(404, 'coupon not found')
  db.coupons.splice(idx, 1)
  saveDb(db)
}

async function createTargetedCoupon(payload: {
  code: string
  customer_whatsapps: string[]
  uses_per_customer?: number
  notify_customers?: boolean
  custom_message?: string
  combinable_with_public?: boolean
  allow_promotion_checkout?: boolean
  starts_at?: string
  expires_at?: string
  max_uses?: number
  discount_type?: 'percent' | 'fixed'
  discount_value?: number
  shipping_discount_type?: 'percent' | 'fixed'
  shipping_discount_value?: number
  product_discounts?: import('./types').ProductDiscount[]
  description?: string
}): Promise<Coupon> {
  const db = loadDb()
  db.coupons = db.coupons ?? []
  db.couponGrants = db.couponGrants ?? []
  const code = payload.code.trim().toUpperCase()
  if (!code) throw new ApiError(400, 'code is required')
  if (db.coupons.some((c) => c.code === code)) throw new ApiError(400, 'a coupon with this code already exists')
  const hasProducts = payload.product_discounts && payload.product_discounts.length > 0
  if (hasProducts && payload.discount_type) {
    throw new ApiError(400, 'use either a flat product discount or per-product discounts, not both')
  }
  if (!hasProducts && !payload.discount_type && !payload.shipping_discount_type) {
    throw new ApiError(400, 'a targeted coupon needs at least one discount (produto, desconto and/or frete)')
  }
  const kind: 'desconto' | 'frete' | 'produto' = hasProducts ? 'produto' : payload.discount_type ? 'desconto' : 'frete'
  const coupon: Coupon = {
    id: uid(),
    code,
    kind,
    discount_type: kind === 'frete' ? payload.shipping_discount_type ?? null : payload.discount_type ?? null,
    discount_value: kind === 'frete' ? payload.shipping_discount_value ?? null : payload.discount_value ?? null,
    shipping_discount_type: kind === 'frete' ? null : payload.shipping_discount_type ?? null,
    shipping_discount_value: kind === 'frete' ? null : payload.shipping_discount_value ?? null,
    product_discounts: payload.product_discounts ?? [],
    allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
    combinable_with_public: payload.combinable_with_public ?? false,
    active: true,
    starts_at: payload.starts_at || null,
    expires_at: payload.expires_at || null,
    max_uses: payload.max_uses ?? null,
    description: payload.description?.trim() || null,
    used_count: 0,
    created_at: nowIso(),
  }
  db.coupons.push(coupon)
  for (const whatsapp of payload.customer_whatsapps) {
    db.couponGrants.push({
      id: uid(),
      coupon_id: coupon.id,
      customer_whatsapp: whatsapp,
      granted_uses: payload.uses_per_customer ?? 1,
      used_count: 0,
      created_at: nowIso(),
    })
  }
  saveDb(db)
  return withGrantCount(db, coupon)
}

async function adminListCouponGrants(couponId: string): Promise<CouponGrant[]> {
  const db = loadDb()
  return (db.couponGrants ?? [])
    .filter((g) => g.coupon_id === couponId)
    .map((g) => {
      const order = db.orders.find((o) => o.customer_whatsapp === g.customer_whatsapp)
      return {
        id: g.id,
        customer_whatsapp: g.customer_whatsapp,
        customer_name: order?.customer_name ?? null,
        granted_uses: g.granted_uses,
        used_count: g.used_count,
        created_at: g.created_at,
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ---------- segmentações do CRM (admin) ----------

async function adminListSegments(): Promise<import('./types').CrmSegment[]> {
  const db = loadDb()
  return [...(db.segments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

async function createSegment(payload: {
  name: string
  description?: string
  filter_criteria: import('./types').CrmFilterCriteria
}): Promise<import('./types').CrmSegment> {
  const db = loadDb()
  db.segments = db.segments ?? []
  if (!payload.name.trim()) throw new ApiError(400, 'name is required')
  const segment: import('./types').CrmSegment = {
    id: uid(),
    name: payload.name.trim(),
    description: payload.description?.trim() || null,
    filter_criteria: payload.filter_criteria,
    created_at: nowIso(),
  }
  db.segments.push(segment)
  saveDb(db)
  return segment
}

async function updateSegment(
  id: string,
  payload: { name: string; description?: string; filter_criteria: import('./types').CrmFilterCriteria }
): Promise<import('./types').CrmSegment> {
  const db = loadDb()
  const segment = (db.segments ?? []).find((s) => s.id === id)
  if (!segment) throw new ApiError(404, 'segment not found')
  if (!payload.name.trim()) throw new ApiError(400, 'name is required')
  const criteriaChanged = JSON.stringify(segment.filter_criteria) !== JSON.stringify(payload.filter_criteria)
  segment.name = payload.name.trim()
  segment.description = payload.description?.trim() || null
  segment.filter_criteria = payload.filter_criteria
  if (criteriaChanged) {
    for (const cc of db.campanhaCoupons ?? []) {
      if (cc.segment_id === id && cc.orientation === 'evento') cc.active = false
    }
  }
  saveDb(db)
  return segment
}

async function deleteSegment(id: string): Promise<void> {
  const db = loadDb()
  const idx = (db.segments ?? []).findIndex((s) => s.id === id)
  if (idx === -1) throw new ApiError(404, 'segment not found')
  db.segments.splice(idx, 1)
  db.campanhaCoupons = (db.campanhaCoupons ?? []).filter((c) => c.segment_id !== id)
  saveDb(db)
}

// ---------- campanhas (segmento + cupom exclusivo) ----------

function campanhaExtraCoupons(db: LocalDb, campanhaId: string): import('./types').CrmCampanhaExtraCoupon[] {
  return (db.campanhaExtraCoupons ?? [])
    .filter((ec) => ec.campanha_id === campanhaId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((ec) => {
      const coupon = (db.coupons ?? []).find((c) => c.id === ec.coupon_id)
      return coupon
        ? {
            id: ec.id,
            coupon: withGrantCount(db, coupon),
            message_template: ec.message_template,
            end_criteria: ec.end_criteria ?? null,
            schedule_delay_days: ec.schedule_delay_days ?? null,
            schedule_hour: ec.schedule_hour ?? null,
          }
        : null
    })
    .filter((x): x is import('./types').CrmCampanhaExtraCoupon => !!x)
}

async function adminListCampanhaCoupons(segmentId: string): Promise<import('./types').CrmCampanhaCoupon[]> {
  const db = loadDb()
  return (db.campanhaCoupons ?? [])
    .filter((c) => c.segment_id === segmentId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((c) => ({ ...c, extra_coupons: campanhaExtraCoupons(db, c.id) }))
}

// Cria só o cadastro da campanha — sem gatilho, sem cupom nenhum. Gatilho
// (setCampanhaGatilho) e cupom(s) (createCampanhaExtraCoupon) são passos
// separados depois, cada um pelo próprio subcard.
async function createCampanha(payload: {
  segment_id: string
  orientation: import('./types').CampanhaOrientation
  name: string
  description?: string
  starts_at?: string
  ends_at?: string
}): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  db.segments = db.segments ?? []
  db.campanhaCoupons = db.campanhaCoupons ?? []
  const segment = db.segments.find((s) => s.id === payload.segment_id)
  if (!segment) throw new ApiError(404, 'segment not found')
  if (!payload.name.trim()) throw new ApiError(400, 'name is required')

  const row: LocalCampanhaCoupon = {
    id: uid(),
    segment_id: payload.segment_id,
    coupon_id: null,
    orientation: payload.orientation,
    name: payload.name.trim(),
    description: payload.description?.trim() || null,
    starts_at: payload.starts_at || null,
    ends_at: payload.ends_at || null,
    trigger_criteria: null,
    trigger_description: null,
    end_criteria: null,
    end_description: null,
    message_template: '',
    uses_per_customer: 1,
    active: true,
    fired_at: null,
    created_at: nowIso(),
    last_synced_segment_criteria: segment.filter_criteria,
    schedule_delay_days: null,
    schedule_hour: null,
  }
  db.campanhaCoupons.push(row)
  saveDb(db)
  return { ...row, extra_coupons: [] }
}

// Define/edita o gatilho (trigger_criteria) de uma campanha 'evento' —
// decoupled do cadastro e de qualquer cupom. null limpa (volta pra "sem
// critério ainda").
async function setCampanhaGatilho(
  id: string,
  triggerCriteria: import('./types').CrmFilterCriteria | null,
  description?: string
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha not found')
  if (row.orientation !== 'evento') throw new ApiError(400, 'only orientation=evento campanhas have a gatilho')
  if (triggerCriteria === null) {
    row.trigger_criteria = null
    row.last_synced_segment_criteria = null
    row.trigger_description = description?.trim() || null
    saveDb(db)
    return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
  }
  const segment = (db.segments ?? []).find((s) => s.id === row.segment_id)
  if (segment && JSON.stringify(triggerCriteria) === JSON.stringify(segment.filter_criteria)) {
    throw new ApiError(400, "trigger_criteria must differ from the segment's current filter in at least one field")
  }
  row.trigger_criteria = triggerCriteria
  row.trigger_description = description?.trim() || null
  if (segment) row.last_synced_segment_criteria = segment.filter_criteria
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

// "Encerrar por evento" da campanha inteira — null limpa.
async function setCampanhaEndCriteria(
  id: string,
  endCriteria: import('./types').CrmFilterCriteria | null,
  description?: string
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha not found')
  row.end_criteria = endCriteria
  row.end_description = description?.trim() || null
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

// Desvincula o cupom principal (volta pra "aguardando cupom").
async function deleteCampanhaPrimaryCoupon(id: string): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha not found')
  row.coupon_id = null
  row.message_template = ''
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

// "Encerrar por evento" de UM cupom extra — null limpa.
async function setExtraCouponEndCriteria(
  id: string,
  endCriteria: import('./types').CrmFilterCriteria | null
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const ec = (db.campanhaExtraCoupons ?? []).find((x) => x.id === id)
  if (!ec) throw new ApiError(404, 'extra coupon not found')
  ec.end_criteria = endCriteria
  saveDb(db)
  const campanha = (db.campanhaCoupons ?? []).find((c) => c.id === ec.campanha_id)
  if (!campanha) throw new ApiError(404, 'campanha not found')
  return { ...campanha, extra_coupons: campanhaExtraCoupons(db, campanha.id) }
}

async function deactivateCampanhaExtraCoupon(id: string): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const ec = (db.campanhaExtraCoupons ?? []).find((x) => x.id === id)
  if (!ec) throw new ApiError(404, 'extra coupon not found')
  const coupon = (db.coupons ?? []).find((c) => c.id === ec.coupon_id)
  if (coupon) coupon.active = false
  saveDb(db)
  const campanha = (db.campanhaCoupons ?? []).find((c) => c.id === ec.campanha_id)
  if (!campanha) throw new ApiError(404, 'campanha not found')
  return { ...campanha, extra_coupons: campanhaExtraCoupons(db, campanha.id) }
}

async function fireCampanhaEvent(
  id: string,
  customerWhatsapps: string[]
): Promise<{ newly_granted: string[]; to_notify: { coupon_id: string; message_template: string; whatsapps: string[] }[] }> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha coupon not found')
  if (row.orientation !== 'evento') throw new ApiError(400, 'only orientation=evento campanhas can be re-fired')
  if (!row.active) throw new ApiError(400, 'this campanha is paused')
  db.couponGrants = db.couponGrants ?? []
  const couponDefs: { coupon_id: string; message_template: string; delay: number | null; is_primary: boolean }[] = []
  if (row.coupon_id) {
    couponDefs.push({ coupon_id: row.coupon_id, message_template: row.message_template, delay: row.schedule_delay_days ?? null, is_primary: true })
  }
  for (const ec of campanhaExtraCoupons(db, row.id)) {
    couponDefs.push({ coupon_id: ec.coupon.id, message_template: ec.message_template, delay: ec.schedule_delay_days ?? null, is_primary: false })
  }
  const newlyGranted: string[] = []
  const toNotify = new Map<string, { coupon_id: string; message_template: string; whatsapps: string[] }>()
  for (const def of couponDefs) {
    for (const whatsapp of customerWhatsapps) {
      if (!whatsapp?.trim()) continue
      const exists = db.couponGrants.some((g) => g.coupon_id === def.coupon_id && g.customer_whatsapp === whatsapp)
      if (!exists) {
        db.couponGrants.push({ id: uid(), coupon_id: def.coupon_id, customer_whatsapp: whatsapp, granted_uses: row.uses_per_customer, used_count: 0, created_at: nowIso() })
        if (def.is_primary) newlyGranted.push(whatsapp)
        if (def.delay == null) {
          const entry = toNotify.get(def.coupon_id) ?? { coupon_id: def.coupon_id, message_template: def.message_template, whatsapps: [] }
          entry.whatsapps.push(whatsapp)
          toNotify.set(def.coupon_id, entry)
        }
      }
    }
  }
  if (newlyGranted.length > 0) row.fired_at = nowIso()
  saveDb(db)
  return { newly_granted: newlyGranted, to_notify: Array.from(toNotify.values()) }
}

function assertValidSchedule(delayDays: number | null, hour: number | null) {
  if (delayDays != null && hour == null) throw new ApiError(400, 'hour is required when delay is set')
  if (hour != null && (hour < 0 || hour > 23)) throw new ApiError(400, 'hour must be between 0 and 23')
}

// Agendamento de disparo do cupom PRINCIPAL da campanha — delay/hour nulos
// volta a notificar na hora que a concessão é criada (comportamento padrão).
async function setCampanhaCouponSchedule(
  id: string,
  delayDays: number | null,
  hour: number | null
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha not found')
  assertValidSchedule(delayDays, hour)
  row.schedule_delay_days = delayDays
  row.schedule_hour = hour
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

async function setExtraCouponSchedule(id: string, delayDays: number | null, hour: number | null): Promise<void> {
  const db = loadDb()
  const ec = (db.campanhaExtraCoupons ?? []).find((x) => x.id === id)
  if (!ec) throw new ApiError(404, 'extra coupon not found')
  assertValidSchedule(delayDays, hour)
  ec.schedule_delay_days = delayDays
  ec.schedule_hour = hour
  saveDb(db)
}

// Modo demonstração não roda um "relógio" de verdade — concessões agendadas
// só são notificadas de fato no modo remoto (Supabase). Aqui não há nada pendente.
async function dispatchScheduledCouponNotifications(): Promise<
  { coupon_id: string; customer_whatsapp: string; message_template: string }[]
> {
  return []
}

async function deleteCampanhaCoupon(id: string): Promise<void> {
  const db = loadDb()
  const idx = (db.campanhaCoupons ?? []).findIndex((c) => c.id === id)
  if (idx === -1) throw new ApiError(404, 'campanha coupon not found')
  db.campanhaCoupons.splice(idx, 1)
  saveDb(db)
}

// Liga/desliga a campanha inteira — junto com ela o cupom exclusivo por
// trás (não existe on/off separado só do cupom de uma campanha).
async function toggleCampanhaCoupon(id: string, active: boolean): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha coupon not found')
  row.active = active
  const extraCouponIds = (db.campanhaExtraCoupons ?? []).filter((ec) => ec.campanha_id === id).map((ec) => ec.coupon_id)
  for (const coupon of db.coupons ?? []) {
    if (coupon.id === row.coupon_id || extraCouponIds.includes(coupon.id)) coupon.active = active
  }
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

async function updateCampanhaCoupon(
  id: string,
  payload: {
    message_template: string
    uses_per_customer?: number
    combinable_with_public?: boolean
    allow_promotion_checkout?: boolean
    starts_at?: string
    expires_at?: string
    max_uses?: number
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    shipping_discount_type?: 'percent' | 'fixed'
    shipping_discount_value?: number
    product_discounts?: import('./types').ProductDiscount[]
    description?: string
  }
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha coupon not found')
  if (!payload.message_template.trim() || !payload.message_template.includes('/nome') || !payload.message_template.includes('/cupom')) {
    throw new ApiError(400, 'message_template must mention /nome and /cupom')
  }
  const coupon = (db.coupons ?? []).find((c) => c.id === row.coupon_id)
  if (!coupon) throw new ApiError(404, 'coupon not found')
  const hasProducts = payload.product_discounts && payload.product_discounts.length > 0
  const kind: 'desconto' | 'frete' | 'produto' = hasProducts ? 'produto' : payload.discount_type ? 'desconto' : 'frete'
  coupon.kind = kind
  coupon.discount_type = kind === 'produto' ? null : payload.discount_type ?? null
  coupon.discount_value = kind === 'produto' ? null : payload.discount_value ?? null
  coupon.shipping_discount_type = payload.shipping_discount_type ?? null
  coupon.shipping_discount_value = payload.shipping_discount_value ?? null
  coupon.product_discounts = hasProducts ? payload.product_discounts! : []
  coupon.combinable_with_public = payload.combinable_with_public ?? false
  coupon.allow_promotion_checkout = payload.allow_promotion_checkout ?? false
  coupon.starts_at = payload.starts_at || null
  coupon.expires_at = payload.expires_at || null
  coupon.max_uses = payload.max_uses ?? null
  coupon.description = payload.description?.trim() || null
  for (const g of db.couponGrants ?? []) {
    if (g.coupon_id === row.coupon_id) g.granted_uses = payload.uses_per_customer ?? 1
  }
  row.message_template = payload.message_template.trim()
  row.uses_per_customer = payload.uses_per_customer ?? 1
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

// Se a campanha ainda não tem cupom nenhum (coupon_id null), este vira o
// PRINCIPAL — e se for 'segmento', dispara na hora pra quem já bate o
// critério (customer_whatsapps). Senão entra como mais um extra, igual
// já funcionava.
async function createCampanhaExtraCoupon(
  campanhaId: string,
  payload: {
    code: string
    message_template: string
    uses_per_customer?: number
    combinable_with_public?: boolean
    allow_promotion_checkout?: boolean
    starts_at?: string
    expires_at?: string
    max_uses?: number
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    shipping_discount_type?: 'percent' | 'fixed'
    shipping_discount_value?: number
    product_discounts?: import('./types').ProductDiscount[]
    customer_whatsapps?: string[]
    description?: string
  }
): Promise<Coupon> {
  const campanhaCheck = (loadDb().campanhaCoupons ?? []).find((c) => c.id === campanhaId)
  if (!campanhaCheck) throw new ApiError(404, 'campanha not found')
  if (!payload.message_template.trim() || !payload.message_template.includes('/nome') || !payload.message_template.includes('/cupom')) {
    throw new ApiError(400, 'message_template must mention /nome and /cupom')
  }
  const isPrimary = !campanhaCheck.coupon_id
  const coupon = await createTargetedCoupon({ ...payload, customer_whatsapps: [] })
  // createTargetedCoupon já salvou o cupom novo — recarrega pra não
  // sobrescrever esse save com um snapshot antigo do db.
  const db = loadDb()
  const campanha = (db.campanhaCoupons ?? []).find((c) => c.id === campanhaId)!
  if (!campanha.active) {
    const savedCoupon = db.coupons.find((c) => c.id === coupon.id)
    if (savedCoupon) savedCoupon.active = false
    coupon.active = false
  }
  db.couponGrants = db.couponGrants ?? []
  const inWindow = !payload.starts_at || new Date(payload.starts_at) <= new Date()

  if (isPrimary) {
    campanha.coupon_id = coupon.id
    campanha.message_template = payload.message_template.trim()
    campanha.uses_per_customer = payload.uses_per_customer ?? 1
    if (campanha.orientation === 'segmento' && inWindow) {
      campanha.fired_at = nowIso()
      for (const whatsapp of payload.customer_whatsapps ?? []) {
        if (!whatsapp?.trim()) continue
        const exists = db.couponGrants.some((g) => g.coupon_id === coupon.id && g.customer_whatsapp === whatsapp)
        if (!exists) {
          db.couponGrants.push({
            id: uid(), coupon_id: coupon.id, customer_whatsapp: whatsapp,
            granted_uses: payload.uses_per_customer ?? 1, used_count: 0, created_at: nowIso(),
          })
        }
      }
    }
  } else {
    db.campanhaExtraCoupons = db.campanhaExtraCoupons ?? []
    db.campanhaExtraCoupons.push({
      id: uid(),
      campanha_id: campanhaId,
      coupon_id: coupon.id,
      message_template: payload.message_template.trim(),
      end_criteria: null,
      created_at: nowIso(),
      schedule_delay_days: null,
      schedule_hour: null,
    })
    // A campanha já disparou antes (tem concessão do cupom principal)?
    // Esse cupom novo entra pra mesma turma na hora — desde que a
    // janela dele já tenha começado.
    if (inWindow) {
      const existingGrants = db.couponGrants.filter((g) => g.coupon_id === campanha.coupon_id)
      for (const g of existingGrants) {
        db.couponGrants.push({
          id: uid(),
          coupon_id: coupon.id,
          customer_whatsapp: g.customer_whatsapp,
          granted_uses: payload.uses_per_customer ?? 1,
          used_count: 0,
          created_at: nowIso(),
        })
      }
    }
  }
  saveDb(db)
  return withGrantCount(db, coupon)
}

async function deleteCampanhaExtraCoupon(id: string): Promise<void> {
  const db = loadDb()
  const idx = (db.campanhaExtraCoupons ?? []).findIndex((ec) => ec.id === id)
  if (idx === -1) throw new ApiError(404, 'extra coupon not found')
  db.campanhaExtraCoupons.splice(idx, 1)
  saveDb(db)
}

// Edita nome/descrição/duração do cadastro — não mexe em gatilho nem em
// cupom nenhum.
async function updateCampanhaCadastro(
  id: string,
  payload: { name: string; description?: string; starts_at?: string; ends_at?: string }
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const row = (db.campanhaCoupons ?? []).find((c) => c.id === id)
  if (!row) throw new ApiError(404, 'campanha not found')
  if (!payload.name.trim()) throw new ApiError(400, 'name is required')
  row.name = payload.name.trim()
  row.description = payload.description?.trim() || null
  row.starts_at = payload.starts_at || null
  row.ends_at = payload.ends_at || null
  saveDb(db)
  return { ...row, extra_coupons: campanhaExtraCoupons(db, row.id) }
}

// Edita mensagem/desconto/prazo de um cupom extra já existente.
async function updateCampanhaExtraCoupon(
  id: string,
  payload: {
    message_template: string
    uses_per_customer?: number
    combinable_with_public?: boolean
    allow_promotion_checkout?: boolean
    starts_at?: string
    expires_at?: string
    max_uses?: number
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    shipping_discount_type?: 'percent' | 'fixed'
    shipping_discount_value?: number
    product_discounts?: import('./types').ProductDiscount[]
    description?: string
  }
): Promise<import('./types').CrmCampanhaCoupon> {
  const db = loadDb()
  const ec = (db.campanhaExtraCoupons ?? []).find((x) => x.id === id)
  if (!ec) throw new ApiError(404, 'extra coupon not found')
  if (!payload.message_template.trim() || !payload.message_template.includes('/nome') || !payload.message_template.includes('/cupom')) {
    throw new ApiError(400, 'message_template must mention /nome and /cupom')
  }
  const coupon = (db.coupons ?? []).find((c) => c.id === ec.coupon_id)
  if (!coupon) throw new ApiError(404, 'coupon not found')
  const hasProducts = payload.product_discounts && payload.product_discounts.length > 0
  const kind: 'desconto' | 'frete' | 'produto' = hasProducts ? 'produto' : payload.discount_type ? 'desconto' : 'frete'
  coupon.kind = kind
  coupon.discount_type = kind === 'produto' ? null : payload.discount_type ?? null
  coupon.discount_value = kind === 'produto' ? null : payload.discount_value ?? null
  coupon.shipping_discount_type = payload.shipping_discount_type ?? null
  coupon.shipping_discount_value = payload.shipping_discount_value ?? null
  coupon.product_discounts = hasProducts ? payload.product_discounts! : []
  coupon.combinable_with_public = payload.combinable_with_public ?? false
  coupon.allow_promotion_checkout = payload.allow_promotion_checkout ?? false
  coupon.starts_at = payload.starts_at || null
  coupon.expires_at = payload.expires_at || null
  coupon.max_uses = payload.max_uses ?? null
  coupon.description = payload.description?.trim() || null
  for (const g of db.couponGrants ?? []) {
    if (g.coupon_id === ec.coupon_id) g.granted_uses = payload.uses_per_customer ?? 1
  }
  ec.message_template = payload.message_template.trim()
  saveDb(db)
  const campanha = (db.campanhaCoupons ?? []).find((c) => c.id === ec.campanha_id)
  if (!campanha) throw new ApiError(404, 'campanha not found')
  return { ...campanha, extra_coupons: campanhaExtraCoupons(db, campanha.id) }
}

// ---------- campanhas (admin) ----------

async function adminListPromotions(): Promise<Promotion[]> {
  const db = loadDb()
  return [...(db.promotions ?? [])].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

async function createPromotion(payload: {
  title: string
  subtitle?: string
  image_url: string
  product_ids: string[]
  promotion_type: import('./types').PromotionType
  discount_type?: 'percent' | 'fixed'
  discount_value?: number
  shipping_discount_type?: 'percent' | 'fixed'
  shipping_discount_value?: number
  starts_at?: string
  expires_at?: string
  product_discounts?: import('./types').ProductDiscount[]
}): Promise<Promotion> {
  const db = loadDb()
  db.promotions = db.promotions ?? []
  if (!payload.title.trim()) throw new ApiError(400, 'title is required')
  if (!payload.image_url) throw new ApiError(400, 'image is required to create a promotion')
  if (!payload.product_ids || payload.product_ids.length === 0) throw new ApiError(400, 'at least one product is required')
  const hasProductDiscounts = payload.promotion_type === 'selfie_service' && payload.product_discounts && payload.product_discounts.length > 0
  if (payload.promotion_type === 'selfie_service') {
    if (!hasProductDiscounts) throw new ApiError(400, 'at least one product discount is required for a selfie-service promotion')
  } else {
    const hasProductDiscount = payload.discount_type && payload.discount_value != null
    const hasShippingDiscount = payload.shipping_discount_type && payload.shipping_discount_value != null
    if (!hasProductDiscount && !hasShippingDiscount) {
      throw new ApiError(400, 'a kit promotion needs a product discount and/or a shipping discount')
    }
  }
  const promotion: Promotion = {
    id: uid(),
    title: payload.title.trim(),
    subtitle: payload.subtitle?.trim() || null,
    image_url: payload.image_url,
    product_ids: payload.product_ids,
    promotion_type: payload.promotion_type,
    discount_type: payload.promotion_type === 'selfie_service' ? null : payload.discount_type ?? null,
    discount_value: payload.promotion_type === 'selfie_service' ? null : payload.discount_value ?? null,
    shipping_discount_type: payload.shipping_discount_type ?? null,
    shipping_discount_value: payload.shipping_discount_value ?? null,
    product_discounts: hasProductDiscounts ? payload.product_discounts! : [],
    active: true,
    starts_at: payload.starts_at || null,
    expires_at: payload.expires_at || null,
    created_at: nowIso(),
  }
  db.promotions.push(promotion)
  saveDb(db)
  return promotion
}

async function updatePromotion(
  id: string,
  payload: {
    title: string
    subtitle?: string
    image_url: string
    product_ids: string[]
    promotion_type: import('./types').PromotionType
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    shipping_discount_type?: 'percent' | 'fixed'
    shipping_discount_value?: number
    active: boolean
    starts_at?: string
    expires_at?: string
    product_discounts?: import('./types').ProductDiscount[]
  }
): Promise<Promotion> {
  const db = loadDb()
  const promotion = (db.promotions ?? []).find((c) => c.id === id)
  if (!promotion) throw new ApiError(404, 'promotion not found')
  if (!payload.image_url) throw new ApiError(400, 'image is required')
  if (!payload.product_ids || payload.product_ids.length === 0) throw new ApiError(400, 'at least one product is required')
  const hasProductDiscounts = payload.promotion_type === 'selfie_service' && payload.product_discounts && payload.product_discounts.length > 0
  if (payload.promotion_type === 'selfie_service') {
    if (!hasProductDiscounts) throw new ApiError(400, 'at least one product discount is required for a selfie-service promotion')
  } else {
    const hasProductDiscount = payload.discount_type && payload.discount_value != null
    const hasShippingDiscount = payload.shipping_discount_type && payload.shipping_discount_value != null
    if (!hasProductDiscount && !hasShippingDiscount) {
      throw new ApiError(400, 'a kit promotion needs a product discount and/or a shipping discount')
    }
  }
  promotion.title = payload.title.trim()
  promotion.subtitle = payload.subtitle?.trim() || null
  promotion.image_url = payload.image_url
  promotion.product_ids = payload.product_ids
  promotion.promotion_type = payload.promotion_type
  promotion.discount_type = payload.promotion_type === 'selfie_service' ? null : payload.discount_type ?? null
  promotion.discount_value = payload.promotion_type === 'selfie_service' ? null : payload.discount_value ?? null
  promotion.shipping_discount_type = payload.shipping_discount_type ?? null
  promotion.shipping_discount_value = payload.shipping_discount_value ?? null
  promotion.product_discounts = hasProductDiscounts ? payload.product_discounts! : []
  promotion.active = payload.active
  promotion.starts_at = payload.starts_at || null
  promotion.expires_at = payload.expires_at || null
  saveDb(db)
  return promotion
}

async function deletePromotion(id: string): Promise<void> {
  const db = loadDb()
  const idx = (db.promotions ?? []).findIndex((c) => c.id === id)
  if (idx === -1) throw new ApiError(404, 'promotion not found')
  db.promotions.splice(idx, 1)
  saveDb(db)
}

// Admin e vendedor têm sessões locais separadas (useAdminAuth/
// useVendedorAuth, cada uma com sua chave de localStorage) — o
// suficiente pra reconhecer quem fez a venda nos relatórios em modo
// demonstração.
function pdvActorFromToken(): { role: 'admin' | 'vendedor'; id: string } {
  const vendedorToken = useVendedorAuth.getState().token
  if (vendedorToken) {
    return { role: 'vendedor', id: vendedorToken.replace('local-vendedor:', '') }
  }
  return { role: 'admin', id: 'admin' }
}

async function pdvCreateSale(payload: {
  items: { product_id: string; quantity: number }[]
  payment_method: PaymentMethod
  customer_name?: string
  customer_whatsapp?: string
}): Promise<Order> {
  if (!payload.items.length) throw new ApiError(400, 'sale must have at least one item')
  const db = loadDb()
  const actor = pdvActorFromToken()

  let total = 0
  const items: OrderItem[] = []
  for (const item of payload.items) {
    if (item.quantity <= 0) throw new ApiError(400, 'item quantity must be positive')
    const product = db.products.find((p) => p.id === item.product_id)
    if (!product) throw new ApiError(400, `product ${item.product_id} not found`)
    if (!product.active) throw new ApiError(400, `product ${product.name} is not available`)
    if (product.quantity < item.quantity) throw new ApiError(400, `insufficient stock for product ${product.name}`)
    total += product.price * item.quantity
    items.push({ product_id: product.id, product_name: product.name, unit_price: product.price, quantity: item.quantity })
  }
  for (const item of payload.items) {
    const product = db.products.find((p) => p.id === item.product_id)!
    product.quantity -= item.quantity
  }

  const order: Order = {
    id: uid(),
    customer_name: payload.customer_name?.trim() || 'Cliente balcão',
    customer_whatsapp: payload.customer_whatsapp?.trim() || '',
    delivery_type: 'balcao',
    neighborhood: null,
    address: null,
    payment_method: payload.payment_method,
    payment_status: 'pago',
    status: 'concluido',
    shipping_price: 0,
    total,
    motoboy_id: null,
    items,
    created_at: nowIso(),
    updated_at: nowIso(),
    sold_by_role: actor.role,
    sold_by_id: actor.id,
  } as Order
  db.orders.push(order)
  saveDb(db)
  return order
}

async function vendedorRelatorio(): Promise<VendedorRelatorio> {
  const db = loadDb()
  const actor = pdvActorFromToken()
  const sales = db.orders.filter((o) => {
    if (o.delivery_type !== 'balcao') return false
    if (actor.role === 'admin') return true
    return o.sold_by_role === 'vendedor' && o.sold_by_id === actor.id
  })
  return {
    total_sales: sales.reduce((sum, o) => sum + o.total, 0),
    total_count: sales.length,
    sales: sales
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100)
      .map((o) => ({
        id: o.id,
        total: o.total,
        payment_method: o.payment_method,
        customer_name: o.customer_name,
        created_at: o.created_at,
        sold_by_role: (o.sold_by_role as 'admin' | 'vendedor') ?? 'admin',
        sold_by_id: o.sold_by_id ?? null,
        sold_by_name:
          o.sold_by_role === 'admin'
            ? 'Admin'
            : o.sold_by_role === 'vendedor'
              ? (db.vendedores ?? []).find((v) => v.id === o.sold_by_id)?.name ?? null
              : null,
        items: o.items.map((i) => ({ product_name: i.product_name, quantity: i.quantity, unit_price: i.unit_price })),
      })),
  }
}

// sold_by_name é resolvido só aqui (admin_list_orders/admin_update_order_status
// locais) — nunca em getOrder/trackOrders, que são os caminhos públicos usados
// pelo cliente e pelo motoboy.
function withSoldByName(db: LocalDb, order: Order): Order {
  if (order.sold_by_role === 'admin') return { ...order, sold_by_name: 'Admin' }
  if (order.sold_by_role === 'vendedor') {
    const vendedor = (db.vendedores ?? []).find((v) => v.id === order.sold_by_id)
    return { ...order, sold_by_name: vendedor?.name ?? null }
  }
  return { ...order, sold_by_name: null }
}

async function adminListOrders(status?: string): Promise<Order[]> {
  const db = loadDb()
  const filtered = status ? db.orders.filter((o) => o.status === status) : db.orders
  return [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((o) => withSoldByName(db, o))
}

async function adminUpdateStatus(id: string, status: string, paymentConfirmed?: boolean): Promise<Order> {
  const db = loadDb()
  const order = db.orders.find((o) => o.id === id)
  if (!order) throw new ApiError(404, 'order not found')
  const setPaid = adminApplyTransition(order, status, paymentConfirmed)
  order.status = status as OrderStatus
  if (setPaid) order.payment_status = 'pago'
  order.updated_at = nowIso()
  if (status === 'retiradas') {
    notifyLocal(
      order.customer_whatsapp,
      'Seu pedido está pronto! Pode vir buscar 😊 Combine o endereço pelo WhatsApp da loja.'
    )
  }
  saveDb(db)
  return withSoldByName(db, order)
}

async function getShippingSettings(): Promise<ShippingSettings> {
  const db = loadDb()
  return { price_per_km: db.pricePerKm, max_km: db.maxKm ?? null }
}

async function updateShippingSettings(pricePerKm: number, maxKm: number | null): Promise<ShippingSettings> {
  const db = loadDb()
  db.pricePerKm = pricePerKm
  db.maxKm = maxKm
  saveDb(db)
  return { price_per_km: db.pricePerKm, max_km: db.maxKm }
}

async function getSiteSettings(): Promise<{
  hero_image_url: string | null
  bg_mode: BgMode
  bg_image_url: string | null
  bg_scale: number
  bg_x: number
  bg_y: number
  bg_fit: BgFit
  smoke_speed: number
  smoke_count: number
  smoke_width: number
  smoke_height: number
  badges: LandingBadge[]
  badges_layout: BadgesLayout
  badges_gap: number
  badges_offset_y: number
  carousel_style: CarouselStyle
}> {
  const db = loadDb()
  return {
    hero_image_url: db.heroImageUrl ?? null,
    carousel_style: db.carouselStyle ?? 'atual',
    bg_mode: db.bgMode ?? 'svg1',
    bg_image_url: db.bgImageUrl ?? null,
    bg_scale: db.bgScale ?? 1,
    bg_x: db.bgX ?? 0,
    bg_y: db.bgY ?? 0,
    bg_fit: db.bgFit ?? 'meet',
    smoke_speed: db.smokeSpeed ?? 3,
    smoke_count: db.smokeCount ?? 9,
    smoke_width: db.smokeWidth ?? 64,
    smoke_height: db.smokeHeight ?? 70,
    badges: db.badges ?? [],
    badges_layout: db.badgesLayout ?? 'row',
    badges_gap: db.badgesGap ?? 8,
    badges_offset_y: db.badgesOffsetY ?? 0,
  }
}

async function updateHeroImage(imageUrl: string): Promise<{ hero_image_url: string }> {
  const db = loadDb()
  if (!imageUrl.trim()) throw new ApiError(400, 'image is required')
  db.heroImageUrl = imageUrl
  saveDb(db)
  return { hero_image_url: imageUrl }
}

async function updateBackground(settings: BgSettings): Promise<BgSettings> {
  const db = loadDb()
  db.bgMode = settings.bg_mode
  db.bgImageUrl = settings.bg_image_url
  db.bgScale = settings.bg_scale
  db.bgX = settings.bg_x
  db.bgY = settings.bg_y
  db.bgFit = settings.bg_fit
  saveDb(db)
  return settings
}

async function updateSmokeSettings(settings: SmokeSettings): Promise<SmokeSettings> {
  const db = loadDb()
  db.smokeSpeed = settings.smoke_speed
  db.smokeCount = settings.smoke_count
  db.smokeWidth = settings.smoke_width
  db.smokeHeight = settings.smoke_height
  saveDb(db)
  return settings
}

async function updateBadges(settings: BadgesSettings): Promise<BadgesSettings> {
  const db = loadDb()
  db.badges = settings.badges
  db.badgesLayout = settings.badges_layout
  db.badgesGap = settings.badges_gap
  db.badgesOffsetY = settings.badges_offset_y
  saveDb(db)
  return settings
}

async function updateCarouselStyle(style: CarouselStyle): Promise<{ carousel_style: CarouselStyle }> {
  const db = loadDb()
  db.carouselStyle = style
  saveDb(db)
  return { carousel_style: style }
}

async function listPageDecorations(): Promise<PageDecoration[]> {
  const db = loadDb()
  return db.pageDecorations ?? []
}

async function savePageDecoration(
  pageKey: PageKey,
  backgroundImageUrl: string | null,
  elements: PageDecorationElement[]
): Promise<PageDecoration> {
  const db = loadDb()
  const list = db.pageDecorations ?? []
  const updated: PageDecoration = { page_key: pageKey, background_image_url: backgroundImageUrl, elements }
  const idx = list.findIndex((d) => d.page_key === pageKey)
  if (idx >= 0) list[idx] = updated
  else list.push(updated)
  db.pageDecorations = list
  saveDb(db)
  return updated
}

const DEFAULT_STORE_HOURS: StoreHourDay[] = Array.from({ length: 7 }, (_, day_of_week) => ({
  day_of_week,
  is_open: true,
  intervals: [{ opens_at: '09:00', closes_at: '18:00' }],
}))

async function getStoreStatus(): Promise<StoreStatus> {
  const db = loadDb()
  return {
    hours: db.storeHours ?? DEFAULT_STORE_HOURS,
    manually_closed: db.storeManuallyClosed ?? false,
    manual_closed_reason: db.storeManualClosedReason ?? null,
  }
}

async function setStoreHours(hours: StoreHourDay[]): Promise<{ ok: boolean }> {
  const db = loadDb()
  db.storeHours = hours
  saveDb(db)
  return { ok: true }
}

async function setStoreManualStatus(manuallyClosed: boolean, reason?: string): Promise<{ ok: boolean }> {
  const db = loadDb()
  if (manuallyClosed) {
    const current = await getStoreStatus()
    if (isScheduledOpenNow(current) && !reason?.trim()) {
      throw new ApiError(400, 'a justification is required to close the store during scheduled open hours')
    }
  }
  db.storeManuallyClosed = manuallyClosed
  db.storeManualClosedReason = manuallyClosed ? reason?.trim() || null : null
  saveDb(db)
  return { ok: true }
}

async function estimateShipping(lat: number, lng: number): Promise<ShippingEstimate> {
  const db = loadDb()
  return estimateShippingLocal(lat, lng, db.pricePerKm, db.maxKm ?? null)
}

async function financeiro(): Promise<FinanceiroSummary> {
  const db = loadDb()
  const paid = db.orders.filter((o) => o.payment_status === 'pago')
  const total_revenue = paid.reduce((sum, o) => sum + o.total, 0)
  const total_discount_given = paid.reduce((sum, o) => sum + (o.discount_amount ?? 0) + (o.shipping_discount ?? 0), 0)
  const total_orders = db.orders.length

  const statusCounts = new Map<OrderStatus, number>()
  for (const o of db.orders) statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1)
  const orders_by_status: StatusCount[] = Array.from(statusCounts.entries()).map(([status, count]) => ({
    status,
    count,
  }))

  const productAgg = new Map<string, TopProduct>()
  for (const o of paid) {
    for (const item of o.items) {
      const cur = productAgg.get(item.product_id) ?? {
        product_id: item.product_id,
        product_name: item.product_name,
        quantity_sold: 0,
        revenue: 0,
      }
      cur.quantity_sold += item.quantity
      cur.revenue += item.unit_price * item.quantity
      productAgg.set(item.product_id, cur)
    }
  }
  const top_products = Array.from(productAgg.values())
    .sort((a, b) => b.quantity_sold - a.quantity_sold)
    .slice(0, 10)

  const recent_orders = [...db.orders].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)

  const allDelivered = db.orders.filter((o) => o.status === 'concluido' && o.delivery_type === 'entrega')

  const motoboys = db.motoboys.map((m) => {
    const delivered = allDelivered.filter((o) => o.motoboy_id === m.id)
    const total_shipping = delivered.reduce((sum, o) => sum + o.shipping_price, 0)
    const total_paid = db.settlements
      .filter((s) => s.motoboy_id === m.id)
      .reduce((sum, s) => sum + s.amount, 0)
    return {
      id: m.id,
      name: m.name,
      total_deliveries: delivered.length,
      total_shipping,
      pending_amount: pendingForMotoboy(db, m.id).amount,
      total_paid: Math.round(total_paid * 100) / 100,
      avg_delivery_minutes: avgDeliveryMinutes(delivered),
    }
  })

  return {
    total_revenue,
    total_discount_given,
    total_orders,
    orders_by_status,
    top_products,
    recent_orders,
    motoboys,
    avg_delivery_minutes: avgDeliveryMinutes(allDelivered),
  }
}

async function financeiroTimeseries(days = 30): Promise<import('./types').FinanceiroTimeseriesPoint[]> {
  const db = loadDb()
  const paid = db.orders.filter((o) => o.payment_status === 'pago')
  const n = Math.max(1, Math.min(days, 180))
  const points: import('./types').FinanceiroTimeseriesPoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - i)
    const dateStr = day.toISOString().slice(0, 10)
    const dayOrders = paid.filter((o) => o.created_at.slice(0, 10) === dateStr)
    const couponOrders = dayOrders.filter((o) => o.coupon_code)
    const promotionOrders = dayOrders.filter((o) => o.promotion_id)
    points.push({
      date: dateStr,
      quantity_sold: dayOrders.reduce((sum, o) => sum + o.items.reduce((s, it) => s + it.quantity, 0), 0),
      revenue: dayOrders.reduce((sum, o) => sum + o.total, 0),
      orders_count: dayOrders.length,
      coupon_orders: couponOrders.length,
      coupon_discount: couponOrders.reduce((sum, o) => sum + (o.discount_amount ?? 0) + (o.shipping_discount ?? 0), 0),
      promotion_orders: promotionOrders.length,
      promotion_discount: promotionOrders.reduce((sum, o) => sum + (o.discount_amount ?? 0) + (o.shipping_discount ?? 0), 0),
    })
  }
  return points
}

// Modo demo não tem uma tabela de clientes separada (o pedido já embute
// nome/whatsapp) — agrupa direto pelos pedidos. birthdate não é rastreado
// localmente, sempre null aqui (só existe de verdade no Supabase).
async function adminCrmCustomers(): Promise<import('./types').CrmCustomer[]> {
  const db = loadDb()
  const byWhatsapp = new Map<string, import('./types').CrmCustomer>()
  for (const o of db.orders) {
    if (!o.customer_whatsapp) continue
    const existing = byWhatsapp.get(o.customer_whatsapp)
    const entry: import('./types').CrmCustomer = existing ?? {
      id: o.customer_whatsapp,
      name: o.customer_name,
      whatsapp: o.customer_whatsapp,
      birthdate: null,
      total_spent: 0,
      order_count: 0,
      total_items: 0,
      first_order_at: null,
      last_order_at: null,
      neighborhoods: [],
      purchases: [],
      orders: [],
      distance_km: null,
    }
    entry.name = o.customer_name
    if (o.payment_status === 'pago') {
      entry.total_spent += o.total
      entry.order_count += 1
      entry.orders.push({ total: o.total, created_at: o.created_at })
      if (!entry.first_order_at || o.created_at < entry.first_order_at) entry.first_order_at = o.created_at
      if (!entry.last_order_at || o.created_at > entry.last_order_at) {
        entry.last_order_at = o.created_at
        if (o.customer_lat != null && o.customer_lng != null) {
          entry.distance_km = distanciaKm(STORE_LOCATION, { lat: o.customer_lat, lng: o.customer_lng })
        }
      }
      if (o.neighborhood && !entry.neighborhoods.includes(o.neighborhood)) entry.neighborhoods.push(o.neighborhood)
      for (const item of o.items) {
        entry.purchases.push({ product_id: item.product_id, created_at: o.created_at, quantity: item.quantity })
        entry.total_items += item.quantity
      }
    }
    byWhatsapp.set(o.customer_whatsapp, entry)
  }
  return Array.from(byWhatsapp.values()).sort((a, b) => a.name.localeCompare(b.name))
}

async function motoboyFinanceiro(): Promise<import('./types').MotoboyFinanceiro> {
  const db = loadDb()
  const delivered = db.orders.filter(
    (o) => o.motoboy_id === FAKE_MOTOBOY_ID && o.status === 'concluido' && o.delivery_type === 'entrega'
  )
  const deliveries = delivered
    .map((o) => ({
      id: o.id,
      customer_name: o.customer_name,
      neighborhood: o.neighborhood,
      shipping_price: o.shipping_price,
      earned: o.shipping_price,
      paid: !!o.motoboy_paid_at,
      duration_minutes: durationMinutes(o),
      updated_at: o.updated_at ?? o.created_at,
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const total_shipping = delivered.reduce((sum, o) => sum + o.shipping_price, 0)
  const total_paid = Math.round(
    db.settlements.filter((s) => s.motoboy_id === FAKE_MOTOBOY_ID).reduce((sum, s) => sum + s.amount, 0) * 100
  ) / 100
  const settlements = db.settlements
    .filter((s) => s.motoboy_id === FAKE_MOTOBOY_ID)
    .map(({ id, amount, payment_method, paid_at }) => ({ id, amount, payment_method, paid_at }))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
  return {
    pending_amount: pendingForMotoboy(db, FAKE_MOTOBOY_ID).amount,
    total_paid,
    total_deliveries: deliveries.length,
    total_shipping,
    avg_delivery_minutes: avgDeliveryMinutes(delivered),
    deliveries,
    settlements,
  }
}

// ---------- motoboy ----------

async function motoboyListOrders(status: string): Promise<Order[]> {
  const db = loadDb()
  const selfId = currentMotoboyId()
  if (status === 'pedido_pronto') {
    return db.orders
      .filter((o) => o.delivery_type === 'entrega' && o.status === 'pedido_pronto' && !o.motoboy_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  if (status === 'em_rota_de_entrega') {
    return db.orders
      .filter(
        (o) =>
          o.delivery_type === 'entrega' &&
          (o.status === 'em_rota_de_entrega' || o.status === 'entregue') &&
          o.motoboy_id === selfId
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  return db.orders
    .filter((o) => o.delivery_type === 'entrega' && o.status === status && o.motoboy_id === selfId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ---------- corrida do motoboy (mesma lógica de supabase/sunset_motoboy_runs.sql) ----------

function runToDto(db: LocalDb, run: LocalRun): MotoboyRun {
  const orders = run.order_ids.map((id) => db.orders.find((o) => o.id === id)).filter((o): o is Order => !!o)
  return { ...run, orders }
}

// Nearest-neighbor guloso a partir da loja — mesma ideia de sunset._optimize_route.
function optimizeRouteLocal(db: LocalDb, orderIds: string[]): string[] {
  const remaining = [...orderIds]
  const result: string[] = []
  let cur = STORE_LOCATION
  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const order = db.orders.find((o) => o.id === remaining[i])
      if (!order || order.customer_lat == null || order.customer_lng == null) continue
      const dist = distanciaKm(cur, { lat: order.customer_lat, lng: order.customer_lng })
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    const [chosenId] = remaining.splice(bestIdx, 1)
    result.push(chosenId)
    const chosenOrder = db.orders.find((o) => o.id === chosenId)
    if (chosenOrder?.customer_lat != null && chosenOrder?.customer_lng != null) {
      cur = { lat: chosenOrder.customer_lat, lng: chosenOrder.customer_lng }
    }
  }
  return result
}

async function motoboyActiveRun(): Promise<MotoboyRun | null> {
  const db = loadDb()
  const selfId = currentMotoboyId()
  const run = db.runs.find((r) => r.motoboy_id === selfId && r.status === 'ativo')
  return run ? runToDto(db, run) : null
}

async function motoboyStartRun(orderIds: string[]): Promise<MotoboyRun> {
  const db = loadDb()
  const selfId = currentMotoboyId()
  if (!orderIds || orderIds.length === 0) {
    throw new ApiError(400, 'select at least one order to start a run')
  }
  if (db.runs.some((r) => r.motoboy_id === selfId && r.status === 'ativo')) {
    throw new ApiError(400, 'you already have an active run — finish it before starting another')
  }
  const distinctIds = [...new Set(orderIds)]
  for (const id of distinctIds) {
    const order = db.orders.find((o) => o.id === id)
    if (!order || order.delivery_type !== 'entrega' || order.status !== 'pedido_pronto' || order.motoboy_id) {
      throw new ApiError(400, `order ${id} is not available to start a delivery run`)
    }
  }

  const sequence = optimizeRouteLocal(db, distinctIds)
  const startedAt = nowIso()
  for (const id of distinctIds) {
    const order = db.orders.find((o) => o.id === id)!
    order.motoboy_id = selfId
    order.status = 'em_rota_de_entrega'
    order.delivery_started_at = startedAt
    order.updated_at = startedAt
    notifyLocal(order.customer_whatsapp, `Olá ${order.customer_name}! Seu pedido saiu pra entrega 🛵 Acompanhe em tempo real.`)
  }

  const run: LocalRun = {
    id: uid(),
    motoboy_id: selfId,
    status: 'ativo',
    current_index: 0,
    order_ids: sequence,
    motoboy_lat: null,
    motoboy_lng: null,
    motoboy_heading: null,
    started_at: startedAt,
    finished_at: null,
  }
  db.runs.push(run)
  saveDb(db)
  return runToDto(db, run)
}

async function motoboyUpdateRunPosition(lat: number, lng: number, heading?: number | null): Promise<void> {
  const db = loadDb()
  const selfId = currentMotoboyId()
  const run = db.runs.find((r) => r.motoboy_id === selfId && r.status === 'ativo')
  if (!run) return
  run.motoboy_lat = lat
  run.motoboy_lng = lng
  run.motoboy_heading = heading ?? null
  saveDb(db)
}

async function motoboyCompleteCurrentDelivery(paymentConfirmed?: boolean): Promise<MotoboyRun> {
  const db = loadDb()
  const selfId = currentMotoboyId()
  const run = db.runs.find((r) => r.motoboy_id === selfId && r.status === 'ativo')
  if (!run) throw new ApiError(400, 'no active run')
  const orderId = run.order_ids[run.current_index]
  const order = db.orders.find((o) => o.id === orderId)
  if (!order) throw new ApiError(404, 'order not found')

  const setPaid = confirmPaymentIfNeeded(order.payment_method, order.payment_status, paymentConfirmed)
  order.status = 'concluido'
  if (setPaid) order.payment_status = 'pago'
  order.delivered_at = nowIso()
  order.updated_at = nowIso()

  if (run.current_index + 1 >= run.order_ids.length) {
    run.status = 'concluido'
    run.finished_at = nowIso()
  } else {
    run.current_index += 1
  }
  saveDb(db)
  return runToDto(db, run)
}

async function trackDeliveryPositionLocal(orderId: string): Promise<DeliveryPosition | null> {
  const db = loadDb()
  const order = db.orders.find((o) => o.id === orderId)
  if (!order || order.status !== 'em_rota_de_entrega' || !order.motoboy_id) return null
  const run = db.runs.find(
    (r) => r.motoboy_id === order.motoboy_id && r.status === 'ativo' && r.order_ids.includes(orderId)
  )
  if (!run) return null

  const isNextStop = run.order_ids[run.current_index] === orderId
  if (!isNextStop) return { is_next_stop: false }
  if (run.motoboy_lat == null || run.motoboy_lng == null) return { is_next_stop: true }

  return {
    is_next_stop: true,
    lat: run.motoboy_lat,
    lng: run.motoboy_lng,
    heading: run.motoboy_heading,
    updated_at: nowIso(),
  }
}

export const localApi = {
  categories: { list: listCategoriesPublic },
  products: { list: listProducts, get: getProduct, salesCounts: productSalesCounts },
  shippingSettings: { get: getShippingSettings },
  siteSettings: { get: getSiteSettings },
  storeStatus: { get: getStoreStatus },
  estimateShipping,
  trackDeliveryPosition: trackDeliveryPositionLocal,
  promotions: { listActive: listActivePromotions, get: getPromotionPublic },
  pageDecorations: { list: listPageDecorations },
  coupons: { validate: validateCouponPublic, listForCustomer: listCustomerCouponsPublic, listPromotionalProducts },
  orders: {
    create: createOrder,
    get: getOrder,
    track: trackOrders,
    createPixPayment,
    refreshPayment,
    simulatePixPaid,
    notifyCreated: async () => {},
  },
  auth: { adminLogin, motoboyLogin, vendedorLogin, setAdminPassword },
  customerAuth: {
    register: customerRegister,
    login: customerLogin,
    me: customerMe,
    verifyResetCode: customerVerifyResetCode,
    resetPassword: customerResetPassword,
    requestPasswordReset: customerRequestPasswordReset,
    toggleFavorite: customerToggleFavorite,
    listFavorites: customerListFavorites,
    listCoupons: customerListCoupons,
    listOrders: customerListOrders,
    hasClaimableCoupon: customerHasClaimableCoupon,
    peekClaimableCoupon: customerPeekClaimableCoupon,
    claimCoupon: customerClaimCoupon,
  },
  pdv: {
    createSale: pdvCreateSale,
    notifySale: async () => {},
    relatorio: vendedorRelatorio,
  },
  admin: {
    categories: { list: adminListCategories, create: createCategory, delete: deleteCategory },
    products: {
      list: adminListProducts,
      create: createProduct,
      update: updateProduct,
      delete: deleteProduct,
      uploadImage: uploadProductImage,
    },
    motoboys: {
      list: adminListMotoboys,
      create: createMotoboy,
      update: updateMotoboy,
      delete: deleteMotoboy,
      getPassword: getMotoboyPassword,
      pending: motoboyPending,
      pay: payMotoboy,
    },
    vendedores: {
      list: adminListVendedores,
      create: createVendedor,
      update: updateVendedor,
      delete: deleteVendedor,
      getPassword: getVendedorPassword,
    },
    coupons: {
      list: adminListCoupons,
      create: createCoupon,
      update: updateCoupon,
      delete: deleteCoupon,
      createTargeted: createTargetedCoupon,
      updateTargeted: updateTargetedCoupon,
      listGrants: adminListCouponGrants,
      checkBirthdays: checkBirthdayCoupons,
    },
    promotions: {
      list: adminListPromotions,
      create: createPromotion,
      update: updatePromotion,
      delete: deletePromotion,
    },
    pageDecorations: { save: savePageDecoration },
    orders: { list: adminListOrders, updateStatus: adminUpdateStatus, notifyReady: async () => {} },
    shippingSettings: { get: getShippingSettings, update: updateShippingSettings },
    siteSettings: { updateHeroImage, updateBackground, updateSmoke: updateSmokeSettings, updateBadges, updateCarouselStyle },
    storeStatus: { get: getStoreStatus, setHours: setStoreHours, setManualStatus: setStoreManualStatus },
    financeiro: { get: financeiro, timeseries: financeiroTimeseries },
    crm: { customers: adminCrmCustomers },
    segments: { list: adminListSegments, create: createSegment, update: updateSegment, delete: deleteSegment },
    campanhaCoupons: {
      list: adminListCampanhaCoupons,
      create: createCampanha,
      setGatilho: setCampanhaGatilho,
      setEndCriteria: setCampanhaEndCriteria,
      deletePrimary: deleteCampanhaPrimaryCoupon,
      updateCadastro: updateCampanhaCadastro,
      fireEvent: fireCampanhaEvent,
      delete: deleteCampanhaCoupon,
      toggleActive: toggleCampanhaCoupon,
      update: updateCampanhaCoupon,
      createExtra: createCampanhaExtraCoupon,
      updateExtra: updateCampanhaExtraCoupon,
      deleteExtra: deleteCampanhaExtraCoupon,
      setExtraEndCriteria: setExtraCouponEndCriteria,
      deactivateExtra: deactivateCampanhaExtraCoupon,
      setSchedule: setCampanhaCouponSchedule,
      setExtraSchedule: setExtraCouponSchedule,
      dispatchScheduledNotifications: dispatchScheduledCouponNotifications,
    },
    whatsapp: {
      status: async () => ({ instance: { state: 'close' } }),
      connect: async () => {
        throw new ApiError(400, 'WhatsApp não disponível no modo demonstração.')
      },
      logout: async () => {},
      notifyCouponGrant: async () => {},
    },
  },
  motoboy: {
    orders: {
      list: motoboyListOrders,
      counts: async () => {
        const db = loadDb()
        const forMotoboy = (status: string, unassigned = false) =>
          db.orders.filter(
            (o) =>
              o.delivery_type === 'entrega' &&
              (status === 'em_rota_de_entrega' ? ['em_rota_de_entrega', 'entregue'].includes(o.status) : o.status === status) &&
              (unassigned ? o.motoboy_id == null : o.motoboy_id === FAKE_MOTOBOY_ID)
          ).length
        return {
          pedido_pronto: forMotoboy('pedido_pronto', true),
          em_rota_de_entrega: forMotoboy('em_rota_de_entrega'),
          concluido: forMotoboy('concluido'),
        }
      },
    },
    runs: {
      active: motoboyActiveRun,
      start: motoboyStartRun,
      updatePosition: motoboyUpdateRunPosition,
      completeCurrent: motoboyCompleteCurrentDelivery,
    },
    financeiro: { get: motoboyFinanceiro },
    whatsapp: {
      status: async () => ({ instance: { state: 'close' } }),
      connect: async () => {
        throw new ApiError(400, 'WhatsApp não disponível no modo demonstração.')
      },
      logout: async () => {},
      notifyEnRoute: async () => {},
    },
  },
}
