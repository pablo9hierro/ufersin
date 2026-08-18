import { z } from 'zod'
import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import {
  AppointmentSchema,
  BadgesSettingsSchema,
  BgSettingsSchema,
  CategorySchema,
  CouponGrantSchema,
  CouponSchema,
  CrmCampanhaCouponSchema,
  CrmCustomerSchema,
  CrmSegmentSchema,
  FinanceiroSummarySchema,
  FinanceiroTimeseriesPointSchema,
  IngredientSchema,
  ServiceSchema,
  LucroSummarySchema,
  MotoboyPendingSchema,
  MotoboySchema,
  MotoboySettlementSchema,
  OrderSchema,
  PageDecorationSchema,
  ProductSchema,
  PromotionSchema,
  ShippingSettingsSchema,
  SmokeSettingsSchema,
  StoreStatusSchema,
  VendedorSchema,
  type BgSettings,
  type CampanhaOrientation,
  type CarouselStyle,
  type CrmFilterCriteria,
  type DiscountType,
  type PageDecorationElement,
  type PageKey,
  type PaymentMethod,
  type ProductDiscount,
  type PromotionType,
  type SmokeSettings,
  type StoreHourDay,
  type FormulatedProductPayload,
  type IngredientPayload,
  type ServicePayload,
} from '../../types'

// Módulo Admin — único ponto do app autorizado a chamar `api.admin.*`.
// Reusa os MESMOS schemas de domínio já validados no lado do cliente
// (Coupon, Product, Order, ...) -- é a mesma entidade, só que com
// visão/CRUD completo em vez do recorte público.

const UploadResultSchema = z.object({ url: z.string() })
const BirthdayGrantSchema = z.object({ coupon_id: z.string(), message_template: z.string(), newly_granted: z.array(z.string()) })
const FireEventResultSchema = z.object({
  newly_granted: z.array(z.string()),
  to_notify: z.array(z.object({ coupon_id: z.string(), message_template: z.string(), whatsapps: z.array(z.string()) })),
})
const ScheduledNotificationSchema = z.object({ coupon_id: z.string(), customer_whatsapp: z.string(), message_template: z.string() })

export const adminEndpoint = {
  categories: {
    list: async () => validateList(CategorySchema, await api.admin.categories.list(), 'admin.categories.list'),
    create: async (name: string) => validate(CategorySchema, await api.admin.categories.create(name), 'admin.categories.create'),
    update: async (id: string, name: string) => validate(CategorySchema, await api.admin.categories.update(id, name), 'admin.categories.update'),
    delete: async (id: string) => api.admin.categories.delete(id),
  },
  products: {
    list: async () => validateList(ProductSchema, await api.admin.products.list(), 'admin.products.list'),
    create: async (payload: Partial<ProductSchema0>) => validate(ProductSchema, await api.admin.products.create(payload), 'admin.products.create'),
    update: async (id: string, payload: Partial<ProductSchema0>) => validate(ProductSchema, await api.admin.products.update(id, payload), 'admin.products.update'),
    delete: async (id: string) => api.admin.products.delete(id),
    uploadImage: async (file: File) => validate(UploadResultSchema, await api.admin.products.uploadImage(file), 'admin.products.uploadImage'),
    // ERP Formulação — estoque/custo do produto são SEMPRE calculados a
    // partir da formulação; stockEntry rejeita (400) se o produto for ERP.
    stockEntry: async (id: string, quantity: number) =>
      validate(ProductSchema, await api.admin.products.stockEntry(id, quantity), 'admin.products.stockEntry'),
    createFormulation: async (payload: FormulatedProductPayload) =>
      validate(ProductSchema, await api.admin.products.createFormulation(payload), 'admin.products.createFormulation'),
    updateFormulation: async (id: string, payload: FormulatedProductPayload) =>
      validate(ProductSchema, await api.admin.products.updateFormulation(id, payload), 'admin.products.updateFormulation'),
  },
  ingredients: {
    list: async () => validateList(IngredientSchema, await api.admin.ingredients.list(), 'admin.ingredients.list'),
    create: async (payload: IngredientPayload) =>
      validate(IngredientSchema, await api.admin.ingredients.create(payload), 'admin.ingredients.create'),
    update: async (id: string, payload: IngredientPayload) =>
      validate(IngredientSchema, await api.admin.ingredients.update(id, payload), 'admin.ingredients.update'),
    delete: async (id: string) => api.admin.ingredients.delete(id),
    stockEntry: async (id: string, quantity: number) =>
      validate(IngredientSchema, await api.admin.ingredients.stockEntry(id, quantity), 'admin.ingredients.stockEntry'),
  },
  services: {
    list: async () => validateList(ServiceSchema, await api.admin.services.list(), 'admin.services.list'),
    create: async (payload: ServicePayload) =>
      validate(ServiceSchema, await api.admin.services.create(payload), 'admin.services.create'),
    update: async (id: string, payload: ServicePayload) =>
      validate(ServiceSchema, await api.admin.services.update(id, payload), 'admin.services.update'),
    delete: async (id: string) => api.admin.services.delete(id),
  },
  motoboys: {
    list: async () => validateList(MotoboySchema, await api.admin.motoboys.list(), 'admin.motoboys.list'),
    create: async (payload: { name: string; phone: string; email: string; password: string; whatsapp?: string }) =>
      validate(MotoboySchema, await api.admin.motoboys.create(payload), 'admin.motoboys.create'),
    update: async (id: string, payload: Partial<MotoboySchema0> & { password?: string }) =>
      validate(MotoboySchema, await api.admin.motoboys.update(id, payload), 'admin.motoboys.update'),
    delete: async (id: string) => api.admin.motoboys.delete(id),
    getPassword: async (id: string) => api.admin.motoboys.getPassword(id),
    pending: async (id: string) => validate(MotoboyPendingSchema, await api.admin.motoboys.pending(id), 'admin.motoboys.pending'),
    pay: async (id: string, paymentMethod: PaymentMethod) => validate(MotoboySettlementSchema, await api.admin.motoboys.pay(id, paymentMethod), 'admin.motoboys.pay'),
  },
  vendedores: {
    list: async () => validateList(VendedorSchema, await api.admin.vendedores.list(), 'admin.vendedores.list'),
    create: async (payload: { name: string; email: string; password: string; commission_active?: boolean; commission_percent?: number }) =>
      validate(VendedorSchema, await api.admin.vendedores.create(payload), 'admin.vendedores.create'),
    update: async (
      id: string,
      payload: { name: string; email: string; active: boolean; password?: string; commission_active?: boolean; commission_percent?: number }
    ) => validate(VendedorSchema, await api.admin.vendedores.update(id, payload), 'admin.vendedores.update'),
    delete: async (id: string) => api.admin.vendedores.delete(id),
    getPassword: async (id: string) => api.admin.vendedores.getPassword(id),
  },
  coupons: {
    list: async () => validateList(CouponSchema, await api.admin.coupons.list(), 'admin.coupons.list'),
    create: async (payload: CreateCouponPayload) => validate(CouponSchema, await api.admin.coupons.create(payload), 'admin.coupons.create'),
    update: async (id: string, payload: UpdateCouponPayload) => validate(CouponSchema, await api.admin.coupons.update(id, payload), 'admin.coupons.update'),
    delete: async (id: string) => api.admin.coupons.delete(id),
    createTargeted: async (payload: CreateTargetedCouponPayload) => validate(CouponSchema, await api.admin.coupons.createTargeted(payload), 'admin.coupons.createTargeted'),
    updateTargeted: async (id: string, payload: UpdateTargetedCouponPayload) => validate(CouponSchema, await api.admin.coupons.updateTargeted(id, payload), 'admin.coupons.updateTargeted'),
    listGrants: async (couponId: string) => validateList(CouponGrantSchema, await api.admin.coupons.listGrants(couponId), 'admin.coupons.listGrants'),
    checkBirthdays: async () => validateList(BirthdayGrantSchema, await api.admin.coupons.checkBirthdays(), 'admin.coupons.checkBirthdays'),
  },
  promotions: {
    list: async () => validateList(PromotionSchema, await api.admin.promotions.list(), 'admin.promotions.list'),
    create: async (payload: CreatePromotionPayload) => validate(PromotionSchema, await api.admin.promotions.create(payload), 'admin.promotions.create'),
    update: async (id: string, payload: UpdatePromotionPayload) => validate(PromotionSchema, await api.admin.promotions.update(id, payload), 'admin.promotions.update'),
    delete: async (id: string) => api.admin.promotions.delete(id),
  },
  pageDecorations: {
    save: async (pageKey: PageKey, backgroundImageUrl: string | null, elements: PageDecorationElement[]) =>
      validate(PageDecorationSchema, await api.admin.pageDecorations.save(pageKey, backgroundImageUrl, elements), 'admin.pageDecorations.save'),
  },
  orders: {
    list: async (status?: string) => validateList(OrderSchema, await api.admin.orders.list(status), 'admin.orders.list'),
    updateStatus: async (
      id: string,
      status: string,
      paymentConfirmed?: boolean,
      extras?: { payment_method?: string; customer_name?: string; customer_whatsapp?: string },
    ) =>
      validate(
        OrderSchema,
        await api.admin.orders.updateStatus(id, status, paymentConfirmed, extras),
        'admin.orders.updateStatus',
      ),
    cancel: async (id: string, reason: string, note?: string) =>
      validate(OrderSchema, await api.admin.orders.cancel(id, reason, note), 'admin.orders.cancel'),
    notifyReady: async (orderId: string) => api.admin.orders.notifyReady(orderId),
  },
  shippingSettings: {
    get: async () => validate(ShippingSettingsSchema, await api.admin.shippingSettings.get(), 'admin.shippingSettings.get'),
    update: async (pricePerKm: number, maxKm: number | null) =>
      validate(ShippingSettingsSchema, await api.admin.shippingSettings.update(pricePerKm, maxKm), 'admin.shippingSettings.update'),
  },
  appointments: {
    list: async () => validateList(AppointmentSchema, await api.admin.appointments.list(), 'admin.appointments.list'),
    cancel: async (id: string) => api.admin.appointments.cancel(id),
  },
  financeiro: {
    get: async () => validate(FinanceiroSummarySchema, await api.admin.financeiro.get(), 'admin.financeiro.get'),
    timeseries: async (days?: number) => validateList(FinanceiroTimeseriesPointSchema, await api.admin.financeiro.timeseries(days), 'admin.financeiro.timeseries'),
    lucro: async (from: string, to: string) => validate(LucroSummarySchema, await api.admin.financeiro.lucro(from, to), 'admin.financeiro.lucro'),
  },
  siteSettings: {
    updateHeroImage: async (imageUrl: string) => api.admin.siteSettings.updateHeroImage(imageUrl),
    updateBackground: async (settings: BgSettings) => validate(BgSettingsSchema, await api.admin.siteSettings.updateBackground(settings), 'admin.siteSettings.updateBackground'),
    updateSmoke: async (settings: SmokeSettings) => validate(SmokeSettingsSchema, await api.admin.siteSettings.updateSmoke(settings), 'admin.siteSettings.updateSmoke'),
    updateBadges: async (settings: BadgesSettingsInput) => validate(BadgesSettingsSchema, await api.admin.siteSettings.updateBadges(settings), 'admin.siteSettings.updateBadges'),
    updateCarouselStyle: async (style: CarouselStyle) => api.admin.siteSettings.updateCarouselStyle(style),
  },
  storeStatus: {
    get: async () => validate(StoreStatusSchema, await api.admin.storeStatus.get(), 'admin.storeStatus.get'),
    setHours: async (hours: StoreHourDay[]) => api.admin.storeStatus.setHours(hours),
    setManualStatus: async (manuallyClosed: boolean, reason?: string) => api.admin.storeStatus.setManualStatus(manuallyClosed, reason),
  },
  crm: {
    customers: async () => validateList(CrmCustomerSchema, await api.admin.crm.customers(), 'admin.crm.customers'),
  },
  segments: {
    list: async () => validateList(CrmSegmentSchema, await api.admin.segments.list(), 'admin.segments.list'),
    create: async (payload: { name: string; description?: string; filter_criteria: CrmFilterCriteria }) =>
      validate(CrmSegmentSchema, await api.admin.segments.create(payload), 'admin.segments.create'),
    update: async (id: string, payload: { name: string; description?: string; filter_criteria: CrmFilterCriteria }) =>
      validate(CrmSegmentSchema, await api.admin.segments.update(id, payload), 'admin.segments.update'),
    delete: async (id: string) => api.admin.segments.delete(id),
  },
  campanhaCoupons: {
    list: async (segmentId: string) => validateList(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.list(segmentId), 'admin.campanhaCoupons.list'),
    create: async (payload: { segment_id: string; orientation: CampanhaOrientation; name: string; description?: string; starts_at?: string; ends_at?: string }) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.create(payload), 'admin.campanhaCoupons.create'),
    setGatilho: async (id: string, triggerCriteria: CrmFilterCriteria | null, description?: string) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.setGatilho(id, triggerCriteria, description), 'admin.campanhaCoupons.setGatilho'),
    setEndCriteria: async (id: string, endCriteria: CrmFilterCriteria | null, description?: string) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.setEndCriteria(id, endCriteria, description), 'admin.campanhaCoupons.setEndCriteria'),
    deletePrimary: async (id: string) => validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.deletePrimary(id), 'admin.campanhaCoupons.deletePrimary'),
    updateCadastro: async (id: string, payload: { name: string; description?: string; starts_at?: string; ends_at?: string }) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.updateCadastro(id, payload), 'admin.campanhaCoupons.updateCadastro'),
    fireEvent: async (id: string, customerWhatsapps: string[]) =>
      validate(FireEventResultSchema, await api.admin.campanhaCoupons.fireEvent(id, customerWhatsapps), 'admin.campanhaCoupons.fireEvent'),
    setSchedule: async (id: string, delayDays: number | null, hour: number | null) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.setSchedule(id, delayDays, hour), 'admin.campanhaCoupons.setSchedule'),
    setExtraSchedule: async (extraCouponId: string, delayDays: number | null, hour: number | null) =>
      api.admin.campanhaCoupons.setExtraSchedule(extraCouponId, delayDays, hour),
    dispatchScheduledNotifications: async () =>
      validateList(ScheduledNotificationSchema, await api.admin.campanhaCoupons.dispatchScheduledNotifications(), 'admin.campanhaCoupons.dispatchScheduledNotifications'),
    delete: async (id: string) => api.admin.campanhaCoupons.delete(id),
    toggleActive: async (id: string, active: boolean) => validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.toggleActive(id, active), 'admin.campanhaCoupons.toggleActive'),
    update: async (id: string, payload: UpdateCampanhaCouponPayload) => validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.update(id, payload), 'admin.campanhaCoupons.update'),
    createExtra: async (campanhaId: string, payload: CreateCampanhaExtraCouponPayload) =>
      validate(CouponSchema, await api.admin.campanhaCoupons.createExtra(campanhaId, payload), 'admin.campanhaCoupons.createExtra'),
    deleteExtra: async (id: string) => api.admin.campanhaCoupons.deleteExtra(id),
    updateExtra: async (id: string, payload: UpdateCampanhaCouponPayload) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.updateExtra(id, payload), 'admin.campanhaCoupons.updateExtra'),
    setExtraEndCriteria: async (id: string, endCriteria: CrmFilterCriteria | null) =>
      validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.setExtraEndCriteria(id, endCriteria), 'admin.campanhaCoupons.setExtraEndCriteria'),
    deactivateExtra: async (id: string) => validate(CrmCampanhaCouponSchema, await api.admin.campanhaCoupons.deactivateExtra(id), 'admin.campanhaCoupons.deactivateExtra'),
  },
  whatsapp: {
    status: async () => api.admin.whatsapp.status(),
    connect: async () => api.admin.whatsapp.connect(),
    logout: async () => api.admin.whatsapp.logout(),
    connectionEvents: async () => api.admin.whatsapp.connectionEvents(),
    notifyCouponGrant: async (couponId: string, customMessage?: string) => api.admin.whatsapp.notifyCouponGrant(couponId, customMessage),
  },
  onboardingGate: {
    get: async () => api.admin.onboardingGate.get(),
  },
}

// Assinaturas dos payloads de mutação -- iguais ao que lib/api.ts já
// aceita (ver admin.coupons/promotions/products/motoboys/campanhaCoupons
// lá), só nomeadas aqui pra não duplicar objeto literal gigante inline.
type ProductSchema0 = {
  name: string
  description: string | null
  price: number
  quantity: number
  image_url: string | null
  category_id: string | null
  active: boolean
  barcode: string | null
  cost_price: number | null
  low_stock_threshold: number | null
}
type MotoboySchema0 = { name: string; phone: string; email: string; active: boolean; whatsapp: string | null }
export interface CreateCouponPayload {
  code: string
  discount_type?: DiscountType
  discount_value?: number
  shipping_discount_type?: DiscountType
  shipping_discount_value?: number
  allow_promotion_checkout?: boolean
  combinable_with_public?: boolean
  starts_at?: string
  expires_at?: string
  max_uses?: number
  product_discounts?: ProductDiscount[]
  message_template?: string
  bday_customer_days_before?: number
  bday_store_date?: string
  bday_store_days_before?: number
  description?: string
}
export interface UpdateCouponPayload {
  active: boolean
  allow_promotion_checkout: boolean
  combinable_with_public?: boolean
  starts_at?: string
  expires_at?: string
  max_uses?: number
  discount_type?: DiscountType
  discount_value?: number
  shipping_discount_type?: DiscountType
  shipping_discount_value?: number
  product_discounts?: ProductDiscount[]
  message_template?: string
  bday_customer_days_before?: number
  bday_store_date?: string
  bday_store_days_before?: number
  description?: string
}
export interface CreateTargetedCouponPayload {
  code: string
  customer_whatsapps: string[]
  uses_per_customer?: number
  notify_customers?: boolean
  custom_message?: string
  combinable_with_public?: boolean
  allow_promotion_checkout?: boolean
  expires_at?: string
  max_uses?: number
  discount_type?: DiscountType
  discount_value?: number
  shipping_discount_type?: DiscountType
  shipping_discount_value?: number
  product_discounts?: ProductDiscount[]
}
export interface UpdateTargetedCouponPayload {
  active: boolean
  uses_per_customer?: number
  combinable_with_public?: boolean
  allow_promotion_checkout?: boolean
  expires_at?: string
  max_uses?: number
  discount_type?: DiscountType
  discount_value?: number
  shipping_discount_type?: DiscountType
  shipping_discount_value?: number
  product_discounts?: ProductDiscount[]
}
export interface CreatePromotionPayload {
  title: string
  subtitle?: string
  image_url: string
  product_ids: string[]
  promotion_type: PromotionType
  discount_type?: DiscountType
  discount_value?: number
  shipping_discount_type?: DiscountType
  shipping_discount_value?: number
  starts_at?: string
  expires_at?: string
  product_discounts?: ProductDiscount[]
  category_discounts?: { category_id: string; discount_type: DiscountType; discount_value: number }[]
}
export interface UpdatePromotionPayload extends CreatePromotionPayload {
  active: boolean
}
export interface UpdateCampanhaCouponPayload {
  message_template: string
  uses_per_customer?: number
  combinable_with_public?: boolean
  allow_promotion_checkout?: boolean
  starts_at?: string
  expires_at?: string
  max_uses?: number
  discount_type?: DiscountType
  discount_value?: number
  shipping_discount_type?: DiscountType
  shipping_discount_value?: number
  product_discounts?: ProductDiscount[]
  description?: string
}
export interface CreateCampanhaExtraCouponPayload extends UpdateCampanhaCouponPayload {
  code: string
  customer_whatsapps?: string[]
}
export type BadgesSettingsInput = Parameters<typeof api.admin.siteSettings.updateBadges>[0]
