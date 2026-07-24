import { ApiError } from './apiError'
import { supabase } from './supabaseClient'
import type { BadgesLayout, BgFit, BgMode, CarouselStyle, Category, ClaimedCoupon, Coupon, Customer, CustomerAuthResult, CustomerCoupons, DeliveryPosition, LandingBadge, Order, PageDecoration, Product, Promotion, ShippingEstimate, ShippingSettings, StoreHourDay, StoreStatus } from './types'

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new ApiError(400, result.error.message)
  return result.data as T
}

// Fluxo público (catálogo, checkout, consulta de pedido) falando direto com
// o Supabase via RLS + RPCs (ver supabase/sunset_public_rls_and_rpc.sql),
// sem passar pelo backend Rust no Railway.
export const supabasePublicApi = {
  categories: {
    list: async () =>
      unwrap<Category[]>(await supabase.from('categories').select('id, name').order('name')),
  },
  products: {
    list: async (categoryId?: string) => {
      let query = supabase
        .from('products')
        .select('id, name, description, price, quantity, image_url, category_id, active, barcode, categories(name)')
        .order('name')
      if (categoryId) query = query.eq('category_id', categoryId)
      const { data, error } = await query
      if (error) throw new ApiError(400, error.message)
      return (data ?? []).map((p) => toProduct(p))
    },
    get: async (id: string) => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, quantity, image_url, category_id, active, barcode, categories(name)')
        .eq('id', id)
        .single()
      if (error || !data) throw new ApiError(404, 'product not found')
      return toProduct(data)
    },
    // Buscado à parte da lista normal de produtos — só usado pra ordenar
    // por "mais vendido" no catálogo, não afeta o resto (ver
    // sunset_catalogo_ordenacao.sql).
    salesCounts: async () => {
      const { data, error } = await supabase.rpc('product_sales_counts')
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as { product_id: string; sold_count: number }[]
    },
  },
  shippingSettings: {
    get: async () =>
      unwrap<ShippingSettings>(
        await supabase.from('shipping_settings').select('price_per_km, max_km').single()
      ),
  },
  siteSettings: {
    get: async () => {
      const { data } = await supabase
        .from('site_settings')
        .select(
          'hero_image_url, bg_mode, bg_image_url, bg_scale, bg_x, bg_y, bg_fit, smoke_speed, smoke_count, smoke_width, smoke_height, badges, badges_layout, badges_gap, badges_offset_y, carousel_style'
        )
        .single()
      return {
        hero_image_url: (data?.hero_image_url as string | null) ?? null,
        carousel_style: (data?.carousel_style as CarouselStyle | undefined) ?? 'atual',
        bg_mode: (data?.bg_mode as BgMode | undefined) ?? 'svg1',
        bg_image_url: (data?.bg_image_url as string | null) ?? null,
        bg_scale: (data?.bg_scale as number | undefined) ?? 1,
        bg_x: (data?.bg_x as number | undefined) ?? 0,
        bg_y: (data?.bg_y as number | undefined) ?? 0,
        bg_fit: (data?.bg_fit as BgFit | undefined) ?? 'meet',
        smoke_speed: (data?.smoke_speed as number | undefined) ?? 3,
        smoke_count: (data?.smoke_count as number | undefined) ?? 9,
        smoke_width: (data?.smoke_width as number | undefined) ?? 64,
        smoke_height: (data?.smoke_height as number | undefined) ?? 70,
        badges: (data?.badges as LandingBadge[] | undefined) ?? [],
        badges_layout: (data?.badges_layout as BadgesLayout | undefined) ?? 'row',
        badges_gap: (data?.badges_gap as number | undefined) ?? 8,
        badges_offset_y: (data?.badges_offset_y as number | undefined) ?? 0,
      }
    },
  },
  pageDecorations: {
    list: async () => {
      const { data, error } = await supabase.from('page_decorations').select('page_key, background_image_url, elements')
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as PageDecoration[]
    },
  },
  storeStatus: {
    get: async (): Promise<StoreStatus> => {
      const [hoursRes, statusRes] = await Promise.all([
        supabase.from('store_hours').select('day_of_week, is_open, intervals').order('day_of_week'),
        supabase.from('store_status').select('manually_closed, manual_closed_reason').single(),
      ])
      return {
        hours: (hoursRes.data ?? []) as StoreHourDay[],
        manually_closed: !!statusRes.data?.manually_closed,
        manual_closed_reason: (statusRes.data?.manual_closed_reason as string | null) ?? null,
      }
    },
  },
  estimateShipping: async (lat: number, lng: number) => {
    const { data, error } = await supabase.rpc('estimate_shipping', { p_lat: lat, p_lng: lng })
    if (error) throw new ApiError(400, error.message)
    return data as ShippingEstimate
  },
  orders: {
    create: async (payload: {
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
    }) => {
      const { data, error } = await supabase.rpc('create_order', {
        p_customer_name: payload.customer_name,
        p_customer_whatsapp: payload.customer_whatsapp,
        p_delivery_type: payload.delivery_type,
        p_payment_method: payload.payment_method,
        p_neighborhood: payload.neighborhood ?? null,
        p_address: payload.address ?? null,
        p_items: payload.items,
        p_customer_lat: payload.customer_lat ?? null,
        p_customer_lng: payload.customer_lng ?? null,
        p_reference_point: payload.reference_point ?? null,
        p_customer_birthdate: payload.customer_birthdate,
        p_coupon_code: payload.coupon_code || null,
        p_promotion_id: payload.promotion_id || null,
      })
      if (error) throw new ApiError(400, error.message)
      return data as Order
    },
    get: async (id: string) => {
      const { data, error } = await supabase.rpc('get_order', { p_order_id: id })
      if (error || !data) throw new ApiError(404, error?.message ?? 'order not found')
      return data as Order
    },
    track: async (whatsapp: string) => {
      const { data, error } = await supabase.rpc('track_orders_by_phone', { p_whatsapp: whatsapp })
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as Order[]
    },
  },
  trackDeliveryPosition: async (orderId: string) => {
    const { data, error } = await supabase.rpc('track_delivery_position', { p_order_id: orderId })
    if (error) throw new ApiError(400, error.message)
    return (data ?? null) as DeliveryPosition | null
  },
  // Carrossel da landing + checkout de promoção/cupom.
  promotions: {
    listActive: async () => {
      const { data, error } = await supabase.rpc('list_active_promotions')
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as Promotion[]
    },
    get: async (id: string) => {
      const { data, error } = await supabase.rpc('get_promotion', { p_id: id })
      if (error || !data) throw new ApiError(404, error?.message ?? 'promotion not found')
      return data as Promotion
    },
  },
  coupons: {
    validate: async (code: string, promotionId?: string, customerBirthdate?: string, customerWhatsapp?: string) => {
      const { data, error } = await supabase.rpc('validate_coupon', {
        p_code: code,
        p_promotion_id: promotionId ?? null,
        p_customer_birthdate: customerBirthdate ?? null,
        p_customer_whatsapp: customerWhatsapp ?? null,
      })
      if (error) throw new ApiError(400, error.message)
      return data as CouponPreview
    },
    // Checkout usa isso pra auto-detectar cupom alvo assim que o whatsapp
    // digitado bate com uma concessão — cliente não precisa digitar código.
    listForCustomer: async (customerWhatsapp: string) => {
      const { data, error } = await supabase.rpc('list_customer_coupons', { p_customer_whatsapp: customerWhatsapp })
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as CouponPreview[]
    },
    // Produtos em promoção (cupom avulso kind='produto', sem concessão) —
    // categoria "Promoção" do catálogo. Desconto já se aplica sozinho
    // assim que o produto entra no carrinho, sem digitar código.
    listPromotionalProducts: async () => {
      const { data, error } = await supabase.rpc('list_promotional_products')
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as PromotionalProduct[]
    },
  },
  // Login de cliente (whatsapp + senha de 4 dígitos) — tudo RPC direto no
  // Supabase, menos o envio do código de recuperação por WhatsApp (esse
  // precisa da Evolution API, só alcançável pelo backend Rust — ver
  // api.ts's customerAuth.requestPasswordReset).
  customerAuth: {
    register: async (payload: { whatsapp: string; password: string; name: string; email: string; birthdate: string }) => {
      const { data, error } = await supabase.rpc('customer_register', {
        p_whatsapp: payload.whatsapp,
        p_password: payload.password,
        p_name: payload.name,
        p_email: payload.email,
        p_birthdate: payload.birthdate,
      })
      if (error) throw new ApiError(400, error.message)
      return data as CustomerAuthResult
    },
    login: async (whatsapp: string, password: string) => {
      const { data, error } = await supabase.rpc('customer_login', { p_whatsapp: whatsapp, p_password: password })
      if (error) throw new ApiError(400, error.message)
      return data as CustomerAuthResult
    },
    me: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_me', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return data as Customer
    },
    verifyResetCode: async (whatsapp: string, code: string) => {
      const { error } = await supabase.rpc('customer_verify_reset_code', { p_whatsapp: whatsapp, p_code: code })
      if (error) throw new ApiError(400, error.message)
    },
    resetPassword: async (whatsapp: string, code: string, newPassword: string) => {
      const { error } = await supabase.rpc('customer_reset_password', {
        p_whatsapp: whatsapp,
        p_code: code,
        p_new_password: newPassword,
      })
      if (error) throw new ApiError(400, error.message)
    },
    // /cliente/favoritos, /cliente/cupons, /cliente/historico.
    toggleFavorite: async (token: string, productId: string) => {
      const { data, error } = await supabase.rpc('customer_toggle_favorite', { p_token: token, p_product_id: productId })
      if (error) throw new ApiError(400, error.message)
      return data as boolean
    },
    listFavorites: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_list_favorites', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as Product[]
    },
    listCoupons: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_list_coupons', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return data as CustomerCoupons
    },
    listOrders: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_list_orders', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return (data ?? []) as Order[]
    },
    // Botão "Resgatar cupom" em /cliente/cupons.
    hasClaimableCoupon: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_has_claimable_coupon', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return data as boolean
    },
    // Só PRÉ-VISUALIZA os dados do próximo cupom pendente (pra desenhar o
    // ticket por baixo do papel dourado) -- NÃO marca nada como resgatado.
    // Chamado no carregamento da página, pode ser chamado várias vezes
    // (recarregar não gasta cupom nenhum).
    peekClaimableCoupon: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_peek_claimable_coupon', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return data as ClaimedCoupon
    },
    // Esse sim MARCA o grant como resgatado -- só deve ser chamado quando
    // o cliente efetivamente termina de raspar a raspadinha.
    claimCoupon: async (token: string) => {
      const { data, error } = await supabase.rpc('customer_claim_coupon', { p_token: token })
      if (error) throw new ApiError(400, error.message)
      return data as ClaimedCoupon
    },
  },
}

export interface PromotionalProduct {
  product_id: string
  coupon_code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
}

export type CouponPreview = Pick<
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

function toProduct(row: {
  id: string
  name: string
  description: string | null
  price: number
  quantity: number
  image_url: string | null
  category_id: string | null
  active: number | boolean
  barcode?: string | null
  categories: { name: string } | { name: string }[] | null
}): Product {
  const category = Array.isArray(row.categories) ? row.categories[0] : row.categories
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    quantity: row.quantity,
    image_url: row.image_url,
    category_id: row.category_id,
    category_name: category?.name ?? null,
    active: Boolean(row.active),
    barcode: row.barcode ?? null,
  }
}
