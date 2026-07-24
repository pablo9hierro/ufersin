import { distanciaKm } from './geo/rotas'
import { FALLBACK as STORE_LOCATION } from './geo/mapa'
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
} from './types'

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

const STORAGE_KEY = 'sonset_local_db_v1'

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

  const products: Product[] = [
    { id: uid(), name: 'Refrigerante Lata', description: 'Refrigerante gelado 350ml', price: 6.0, quantity: 50, image_url: null, category_id: catBebidas, active: true },
    { id: uid(), name: 'Suco Natural', description: 'Suco de frutas da estação 500ml', price: 8.5, quantity: 30, image_url: null, category_id: catBebidas, active: true },
    { id: uid(), name: 'Sanduíche Natural', description: 'Pão integral, frango desfiado e salada', price: 14.9, quantity: 20, image_url: null, category_id: catLanches, active: true },
    { id: uid(), name: 'Hambúrguer Artesanal', description: 'Pão brioche, carne 180g, queijo e molho da casa', price: 24.9, quantity: 15, image_url: null, category_id: catLanches, active: true },
    { id: uid(), name: 'Pudim de Leite', description: 'Fatia individual de pudim caseiro', price: 9.9, quantity: 25, image_url: null, category_id: catSobremesas, active: true },
    { id: uid(), name: 'Brownie com Sorvete', description: 'Brownie de chocolate com bola de sorvete', price: 12.9, quantity: 18, image_url: null, category_id: catSobremesas, active: true },
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

  return {
    categories,
    products,
    motoboys,
    vendedores: [],
    orders: [],
    settlements: [],
    runs: [],
    promotions: [],
    coupons: [],
    couponGrants: [],
    segments: [],
    campanhaCoupons: [],
    campanhaExtraCoupons: [],
    customers: [],
    customerPasswordResets: [],
    customerFavorites: [],
    pricePerKm: 1.5,
    maxKm: null,
    heroImageUrl: null,
    bgMode: 'svg1',
    bgImageUrl: null,
    bgScale: 1,
    bgX: 0,
    bgY: 0,
    bgFit: 'meet',
    smokeSpeed: 3,
    smokeCount: 9,
    smokeWidth: 64,
    smokeHeight: 70,
    badges: [
      { id: '1', text: 'SUNSET • Desde 2023', bold: true },
      { id: '2', text: '🔥 Experiência, vibe e essência', bold: false },
      { id: '3', text: '👇 A vibe começa aqui', bold: false },
    ],
    badgesLayout: 'row',
    badgesGap: 8,
    badgesOffsetY: 0,
    carouselStyle: 'atual',
    pageDecorations: [],
    storeHours: Array.from({ length: 7 }, (_, day_of_week) => ({
      day_of_week,
      is_open: true,
      intervals: [{ opens_at: '09:00', closes_at: '18:00' }],
    })),
    storeManuallyClosed: false,
    storeManualClosedReason: null,
  }
}

export function loadDb(): LocalDb {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as LocalDb
    } catch {
      // corrupted, fall through to reseed
    }
  }
  const fresh = seedDb()
  saveDb(fresh)
  return fresh
}

export function saveDb(db: LocalDb) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

export { uid, nowIso }
