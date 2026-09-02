import { useAdminAuth } from '../store/adminAuth'
import { useVendedorAuth } from '../store/vendedorAuth'
import { useMotoboyAuth } from '../store/motoboyAuth'
import { useCozinhaAuth } from '../store/cozinhaAuth'
import { ApiError } from './apiError'
import { isDemoModeActive, isMutatingDemoRpc, isSeededDemoTenant, simulateDemoWrite } from './demoMode'
import { localApi } from './localApi'
import { supabasePublicApi } from './supabasePublicApi'
import { supabase } from './supabaseClient'
import { fetchWithTimeout } from './fetchTimeout'
import { resolveTenantSlug, stashLojaOfflineMessage } from './tenantConfig'
import type {
  BadgesSettings,
  BgSettings,
  CampanhaOrientation,
  CarouselStyle,
  Category,
  Comanda,
  CozinhaUser,
  Coupon,
  CouponGrant,
  CrmCampanhaCoupon,
  CrmCustomer,
  CrmFilterCriteria,
  CrmSegment,
  EvolutionConnect,
  EvolutionStatus,
  FinanceiroSummary,
  FinanceiroTimeseriesPoint,
  FormulatedProductPayload,
  Ingredient,
  IngredientPayload,
  Appointment,
  MessageTemplate,
  Service,
  ServicePayload,
  LucroSummary,
  Motoboy,
  MotoboyFinanceiro,
  MotoboyPending,
  MotoboyRun,
  MotoboySettlement,
  PayrollAlert,
  PayrollPayment,
  PaymentFrequency,
  Order,
  PageDecoration,
  PageDecorationElement,
  PageKey,
  PaymentMethod,
  PdvSaleItemInput,
  Product,
  ProductDiscount,
  Promotion,
  PromotionType,
  ShippingSettings,
  SmokeSettings,
  StoreHourDay,
  StoreStatus,
  Vendedor,
  VendedorRelatorio,
} from '../types'

// Ainda usado só pro login admin/motoboy e Pix, que continuam no backend
// Rust (Railway) até a migração de auth/Pix pra Supabase Auth/Edge Functions.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

// Catálogo/checkout/consulta falam direto com o Supabase (ver
// supabasePublicApi.ts) — sem isso configurado, cai em modo demonstração
// (localStorage) pra não quebrar a build. Force com VITE_USE_LOCAL_DB=true;
// local dev continua batendo no Supabase real por padrão.
export const USE_LOCAL_DB =
  import.meta.env.VITE_USE_LOCAL_DB === 'true' ||
  (import.meta.env.PROD && !import.meta.env.VITE_SUPABASE_URL)

const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; timeoutMs?: number } = {}
): Promise<T> {
  const { token, headers, timeoutMs, ...rest } = options
  // Demo real seedada (demo-ecommerce/demo-eletronica): visitante nunca
  // escreve no Postgres de verdade. Simula sucesso local — próxima leitura
  // real (troca de tela) volta pro dado seedado. Ver lib/demoMode.ts.
  const method = (rest.method || 'GET').toUpperCase()
  if (isSeededDemoTenant() && method !== 'GET' && method !== 'HEAD') {
    return simulateDemoWrite<T>(rest.body)
  }
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${API_BASE}${path}`,
      {
        ...rest,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      timeoutMs ?? REQUEST_TIMEOUT_MS,
    )
  } catch (err) {
    // fetch() falhou antes de chegar a ter uma resposta HTTP (servidor
    // fora do ar, CORS, sem internet, timeout) — sem isso virar um ApiError de
    // verdade, esse erro passa batido em todo `catch (e) { e instanceof
    // ApiError ? e.message : '<mensagem genérica>' }` espalhado pelo app,
    // sempre caindo na mensagem genérica em vez de dizer que o servidor
    // tá inacessível.
    const timedOut =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && /abort|timeout/i.test(err.message))
    throw new ApiError(
      0,
      timedOut
        ? 'O servidor demorou para responder. Tente novamente em instantes.'
        : 'Não foi possível conectar ao servidor. Verifique sua internet ou tente novamente em instantes.',
    )
  }
  if (!res.ok) {
    let message = `Erro ${res.status}`
    try {
      const body = await res.json()
      message = body.error || body.message || message
    } catch {
      // resposta sem corpo JSON
    }
    // JWT Railway inválido/expirado/loja offline: limpa sessão local. O shell
    // do admin só checa se o token existe no localStorage — sem isso o lojista
    // fica preso em telas tipo /financeiro com "invalid or expired token".
    // Em demo pública o token é mock local — nunca derrubar pra /admin/login.
    if (res.status === 401 && path.startsWith('/api/admin') && !isDemoModeActive()) {
      if (/loja offline/i.test(message)) stashLojaOfflineMessage(message)
      useAdminAuth.getState().logout()
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/**
 * Catálogo público Resolutoo: admin grava em Railway (`sunset.products` +
 * tenant_id). Sem slug, fallback legacy Supabase (single-tenant / demo DB).
 * Com slug, SEMPRE Railway — nunca misturar com `ufersin.products` (era a
 * causa do catálogo vazio com produtos no admin).
 */
type PublicService = {
  id: string
  name: string
  description: string
  category_name: string | null
  price: number
  available_quantity: number | null
}

function railwayPublicCatalogBase(): string | null {
  const slug = resolveTenantSlug().trim()
  if (!slug) return null
  return `/api/public/catalog/${encodeURIComponent(slug)}`
}

const tenantAwarePublicCatalog = {
  categories: {
    list: async () => {
      const base = railwayPublicCatalogBase()
      if (!base) return supabasePublicApi.categories.list()
      return request<Category[]>(`${base}/categories`)
    },
  },
  products: {
    list: async (categoryId?: string) => {
      const base = railwayPublicCatalogBase()
      if (!base) return supabasePublicApi.products.list(categoryId)
      const qs = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : ''
      return request<Product[]>(`${base}/products${qs}`)
    },
    get: async (id: string) => {
      const base = railwayPublicCatalogBase()
      if (!base) return supabasePublicApi.products.get(id)
      return request<Product>(`${base}/products/${encodeURIComponent(id)}`)
    },
    salesCounts: async () => {
      const base = railwayPublicCatalogBase()
      if (!base) return supabasePublicApi.products.salesCounts()
      return request<{ product_id: string; sold_count: number }[]>(
        `${base}/product-sales-counts`
      )
    },
  },
  services: {
    list: async () => {
      const base = railwayPublicCatalogBase()
      if (!base) return []
      return request<PublicService[]>(`${base}/services`)
    },
    get: async (id: string) => {
      const base = railwayPublicCatalogBase()
      if (!base) throw new ApiError(404, 'Serviço não disponível.')
      return request<PublicService>(`${base}/services/${encodeURIComponent(id)}`)
    },
  },
  storeStatus: {
    // Mesmo motivo do catálogo: sem isso a vitrine lia horário via Supabase
    // (schema `resolutoo`, legado) enquanto o admin salva no Railway — dois
    // bancos diferentes, então a vitrine nunca via os horários salvos.
    get: async () => {
      const base = railwayPublicCatalogBase()
      if (!base) return supabasePublicApi.storeStatus.get()
      return request<StoreStatus>(`${base}/store-status`)
    },
  },
  mpPublicKey: {
    /** Public key da conta MP da loja — nunca o access_token. Sem slug
     * (demo/legado) não tem cartão tokenizado disponível. */
    get: async () => {
      const base = railwayPublicCatalogBase()
      if (!base) return { public_key: null as string | null }
      return request<{ public_key: string | null }>(`${base}/mp-public-key`)
    },
  },
}

/** Pix no motor Railway (`/api/orders/{id}/…`). Path relativo `/api/pix-*`
 * na Vercel quebrava em `/loja` embutido (POST no host pai → 405). */
async function callRailwayPixApi(
  orderId: string,
  action: 'create-pix-payment' | 'refresh-payment' | 'simulate-pix-paid',
  force = false,
  customerEmail?: string,
): Promise<Order> {
  const params = new URLSearchParams()
  if (force) params.set('force', '1')
  if (customerEmail) params.set('customer_email', customerEmail)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return request<Order>(`/api/orders/${orderId}/${action}${qs}`, { method: 'POST' })
}

// admin e vendedor têm sessões separadas (useAdminAuth/useVendedorAuth,
// cada uma com chave própria de localStorage) — RPCs "admin ou vendedor"
// (PDV, financeiro) aceitam qualquer um dos dois tokens; a própria RPC
// no banco valida o papel de verdade (sunset._require_admin_or_vendedor).
function adminToken() {
  return (
    useAdminAuth.getState().token ??
    useVendedorAuth.getState().token ??
    useCozinhaAuth.getState().token ??
    undefined
  )
}

/** JWT do motor (login multi-tenant via Railway). Sessão opaca do Supabase
 * RPC é hex sem pontos — com JWT, CRUD admin vai pro Rust isolado por tenant. */
function isRailwayAdminJwt(token: string | null | undefined = adminToken()): boolean {
  if (!token) return false
  const parts = token.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

async function railwayAdmin<T>(
  path: string,
  options: RequestInit & { token?: string; timeoutMs?: number } = {}
): Promise<T> {
  return request<T>(path, { ...options, token: options.token ?? adminToken() })
}
// motoboy tem sessão própria (useMotoboyAuth, chave de localStorage
// separada de admin/vendedor) — nunca se sobrescreve com a sessão dos
// outros dois, mesmo com todos logados ao mesmo tempo em
// abas/dispositivos diferentes.
function motoboyToken() {
  return useMotoboyAuth.getState().token ?? undefined
}

// Payroll self-service (my-pending/confirm) é usado tanto por motoboy quanto
// por vendedor -- cada sessão tem sua própria chave, nunca as duas ao mesmo
// tempo numa mesma aba/dispositivo.
function staffToken() {
  return useMotoboyAuth.getState().token ?? useVendedorAuth.getState().token ?? undefined
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // Mesma regra de request(): RPC de mutação na demo seedada não bate no
  // Supabase, simula sucesso local.
  if (isSeededDemoTenant() && isMutatingDemoRpc(fn)) {
    return simulateDemoWrite<T>(JSON.stringify(args))
  }
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new ApiError(error.message === 'unauthorized' ? 401 : 400, error.message)
  return data as T
}

/** Agrega receita/custo/lucro no client (demo local + fallback Supabase). */
export function computeLucroFromOrders(
  orders: Order[],
  products: Product[],
  from: string,
  to: string
): LucroSummary {
  const costById = new Map(products.map((p) => [p.id, p.cost_price ?? null]))
  const paid = orders.filter((o) => {
    if (o.payment_status !== 'pago') return false
    const day = o.created_at.slice(0, 10)
    return day >= from && day <= to
  })
  let receita = 0
  let custo = 0
  let incomplete_cost = false
  for (const o of paid) {
    receita += o.total
    for (const item of o.items) {
      const cp = costById.get(item.product_id)
      if (cp == null) incomplete_cost = true
      custo += item.quantity * (cp ?? 0)
    }
  }
  return {
    from,
    to,
    receita,
    custo,
    lucro: receita - custo,
    orders_count: paid.length,
    incomplete_cost,
  }
}

const remoteApi = {
  // Catálogo Resolutoo: Railway por slug (mesma fonte do admin). Legacy
  // single-tenant / sem slug → Supabase RLS (supabasePublicApi).
  categories: tenantAwarePublicCatalog.categories,
  products: tenantAwarePublicCatalog.products,
  publicServices: tenantAwarePublicCatalog.services,
  shippingSettings: supabasePublicApi.shippingSettings,
  siteSettings: supabasePublicApi.siteSettings,
  storeStatus: tenantAwarePublicCatalog.storeStatus,
  mpPublicKey: tenantAwarePublicCatalog.mpPublicKey,
  estimateShipping: supabasePublicApi.estimateShipping,
  trackDeliveryPosition: supabasePublicApi.trackDeliveryPosition,
  // Carrossel da landing (promoções ativas) + cupom digitado no checkout.
  promotions: supabasePublicApi.promotions,
  coupons: supabasePublicApi.coupons,
  // Layout por página (fundo + fumaça/fogo), editado em /admin/layout-cliente.
  pageDecorations: supabasePublicApi.pageDecorations,
  orders: {
    create: supabasePublicApi.orders.create,
    get: supabasePublicApi.orders.get,
    track: supabasePublicApi.orders.track,
    // Pix no ecommerce-api (Railway). `force` gera nova cobrança (PDV).
    // `customerEmail` (do cliente logado) vira payer.email no Mercado Pago
    // em vez do e-mail da loja — cai pro e-mail da loja se ausente (convidado).
    createPixPayment: (id: string, force = false, customerEmail?: string) =>
      callRailwayPixApi(id, 'create-pix-payment', force, customerEmail),
    refreshPayment: (id: string) => callRailwayPixApi(id, 'refresh-payment'),
    simulatePixPaid: (id: string) => callRailwayPixApi(id, 'simulate-pix-paid'),
    // Cartão via Mercado Pago (mesmo token por tenant que o Pix já usa).
    createCardLink: (id: string) => request<Order>(`/api/orders/${id}/card-link`, { method: 'POST' }),
    createCardPayment: (
      id: string,
      input: { card_token: string; payment_method_id: string; installments?: number; payer_email?: string },
    ) => request<Order>(`/api/orders/${id}/card-payment`, { method: 'POST', body: JSON.stringify(input) }),
    /** Cancelamento pelo cliente (/consultar) — ownership via WhatsApp. */
    cancel: (id: string, whatsapp: string) =>
      request<Order>(`/api/orders/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ whatsapp }),
      }),
    // Público — dispara logo após o checkout, avisando que o pedido chegou.
    notifyCreated: (orderId: string) =>
      request<void>('/api/orders/notify-created', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId }),
      }),
  },
  // Login admin → motor Railway (Argon2 + JWT com tenant_id).
  // `tenant_slug` é opcional: o backend resolve a loja pelo e-mail+senha.
  // Deep link do dashboard Resolutoo ainda pode pré-preencher o slug.
  auth: {
    adminLogin: async (email: string, password: string, tenantSlug?: string) => {
      const slug = tenantSlug?.trim().toLowerCase()
      const body: { email: string; password: string; tenant_slug?: string } = { email, password }
      if (slug) body.tenant_slug = slug
      return request<{ token: string; name: string; tenant_slug: string }>('/api/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    motoboyLogin: async (phone: string, password: string) =>
      request<{ token: string; name: string }>('/api/auth/motoboy/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password, tenant_slug: resolveTenantSlug() }),
      }),
    vendedorLogin: async (phone: string, password: string) =>
      request<{ token: string; name: string }>('/api/auth/vendedor/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password, tenant_slug: resolveTenantSlug() }),
      }),
    cozinhaLogin: async (phone: string, password: string) =>
      request<{ token: string; name: string }>('/api/auth/cozinha/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password, tenant_slug: resolveTenantSlug() }),
      }),
    setAdminPassword: async (newPassword: string) => {
      const { error } = await supabase.rpc('admin_set_password', {
        p_token: adminToken(),
        p_new_password: newPassword,
      })
      if (error) throw new ApiError(400, error.message)
    },
  },
  // Conta de cliente (whatsapp + senha de 4 dígitos). Cadastro/login/
  // verificação de código/troca de senha são RPC direto no Supabase; só o
  // ENVIO do código de recuperação por WhatsApp passa pelo Rust/Railway
  // (Evolution API, mesma exceção de sempre — ver frontend/api/notify-payment.ts).
  customerAuth: {
    register: supabasePublicApi.customerAuth.register,
    login: supabasePublicApi.customerAuth.login,
    me: supabasePublicApi.customerAuth.me,
    verifyResetCode: supabasePublicApi.customerAuth.verifyResetCode,
    resetPassword: supabasePublicApi.customerAuth.resetPassword,
    requestPasswordReset: (whatsapp: string) =>
      request<void>('/api/customer/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ whatsapp, tenant: resolveTenantSlug() }),
      }),
    verifyLoginCode: supabasePublicApi.customerAuth.verifyLoginCode,
    requestLoginCode: (whatsapp: string, name: string) =>
      request<void>('/api/customer/request-login-code', {
        method: 'POST',
        body: JSON.stringify({ whatsapp, name, tenant: resolveTenantSlug() }),
      }),
    toggleFavorite: supabasePublicApi.customerAuth.toggleFavorite,
    listFavorites: supabasePublicApi.customerAuth.listFavorites,
    listCoupons: supabasePublicApi.customerAuth.listCoupons,
    listOrders: supabasePublicApi.customerAuth.listOrders,
    hasClaimableCoupon: supabasePublicApi.customerAuth.hasClaimableCoupon,
    peekClaimableCoupon: supabasePublicApi.customerAuth.peekClaimableCoupon,
    claimCoupon: supabasePublicApi.customerAuth.claimCoupon,
  },
  // CRUD do admin: JWT Railway (Resolutoo multi-tenant) → /api/admin/*;
  // sessão Supabase (Sunset legado / schema single-tenant) → RPCs.
  admin: {
    categories: {
      list: () =>
        isRailwayAdminJwt()
          ? railwayAdmin<Category[]>('/api/admin/categories')
          : rpc<Category[]>('admin_list_categories', { p_token: adminToken() }),
      create: (name: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Category>('/api/admin/categories', {
              method: 'POST',
              body: JSON.stringify({ name }),
            })
          : rpc<Category>('admin_create_category', { p_token: adminToken(), p_name: name }),
      update: (id: string, name: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Category>(`/api/admin/categories/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ name }),
            })
          : rpc<Category>('admin_update_category', { p_token: adminToken(), p_id: id, p_name: name }),
      delete: (id: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<void>(`/api/admin/categories/${id}`, { method: 'DELETE' })
          : rpc<void>('admin_delete_category', { p_token: adminToken(), p_id: id }),
    },
    products: {
      list: () =>
        isRailwayAdminJwt()
          ? railwayAdmin<Product[]>('/api/admin/products')
          : rpc<Product[]>('admin_list_products', { p_token: adminToken() }),
      create: (payload: Partial<Product>) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Product>('/api/admin/products', {
              method: 'POST',
              body: JSON.stringify({
                name: payload.name,
                description: payload.description ?? null,
                price: payload.price,
                quantity: payload.quantity,
                image_url: payload.image_url ?? null,
                category_id: payload.category_id ?? null,
                active: payload.active ?? true,
                cost_price: payload.cost_price ?? null,
                low_stock_threshold: payload.low_stock_threshold ?? null,
                barcode: payload.barcode ?? null,
              }),
            })
          : rpc<Product>('admin_create_product', {
              p_token: adminToken(),
              p_name: payload.name,
              p_description: payload.description ?? null,
              p_price: payload.price,
              p_quantity: payload.quantity,
              p_image_url: payload.image_url ?? null,
              p_category_id: payload.category_id ?? null,
              p_active: payload.active ?? true,
              p_barcode: payload.barcode ?? null,
              p_cost_price: payload.cost_price ?? null,
              p_low_stock_threshold: payload.low_stock_threshold ?? null,
            }),
      update: (id: string, payload: Partial<Product>) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Product>(`/api/admin/products/${id}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: payload.name,
                description: payload.description ?? null,
                price: payload.price,
                quantity: payload.quantity,
                image_url: payload.image_url ?? null,
                category_id: payload.category_id ?? null,
                active: payload.active ?? true,
                cost_price: payload.cost_price ?? null,
                low_stock_threshold: payload.low_stock_threshold ?? null,
                barcode: payload.barcode ?? null,
              }),
            })
          : rpc<Product>('admin_update_product', {
              p_token: adminToken(),
              p_id: id,
              p_name: payload.name,
              p_description: payload.description ?? null,
              p_price: payload.price,
              p_quantity: payload.quantity,
              p_image_url: payload.image_url ?? null,
              p_category_id: payload.category_id ?? null,
              p_active: payload.active ?? true,
              p_barcode: payload.barcode ?? null,
              p_cost_price: payload.cost_price ?? null,
              p_low_stock_threshold: payload.low_stock_threshold ?? null,
            }),
      delete: (id: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<void>(`/api/admin/products/${id}`, { method: 'DELETE' })
          : rpc<void>('admin_delete_product', { p_token: adminToken(), p_id: id }),
      // Upload: JWT → Railway; sessão Supabase → Edge Function Vercel.
      // Bypassa request()/rpc() (fetch cru), então precisa do próprio guard
      // de demo — visitante não deve subir arquivo de verdade pro storage.
      uploadImage: async (file: File) => {
        if (isSeededDemoTenant()) {
          return simulateDemoWrite<{ url: string }>(JSON.stringify({ url: URL.createObjectURL(file) }))
        }
        if (isRailwayAdminJwt()) {
          const form = new FormData()
          form.append('file', file)
          const res = await fetch(`${API_BASE}/api/admin/products/upload-image`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken()}` },
            body: form,
          })
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new ApiError(res.status, text || 'Falha ao enviar imagem.')
          }
          return (await res.json()) as { url: string }
        }
        const url = `/api/upload-image`
        let res: Response
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': file.type },
            body: file,
          })
        } catch (networkErr) {
          console.error('[uploadImage] falha de rede ao chamar', url, networkErr)
          throw new ApiError(0, 'Erro de conexão ao enviar a imagem: não foi possível falar com a Vercel.')
        }
        if (!res.ok) {
          const rawText = await res.text().catch(() => '')
          console.error('[uploadImage] resposta de erro do backend', res.status, rawText)
          let serverMsg: string | undefined
          try {
            serverMsg = JSON.parse(rawText)?.error
          } catch {
            // corpo não é JSON
          }
          const message =
            serverMsg ||
            (res.status === 413
              ? 'Arquivo grande demais — o servidor recusou o envio (limite de tamanho excedido).'
              : res.status === 401 || res.status === 403
                ? 'Sessão de admin expirada ou sem permissão — faça login novamente.'
                : rawText
                  ? `Erro ${res.status}: ${rawText.slice(0, 200)}`
                  : `Erro ${res.status} ao enviar a imagem.`)
          throw new ApiError(res.status, message)
        }
        return (await res.json()) as { url: string }
      },
      // ERP Formulação — feature nova, só existe no motor Rust multi-tenant
      // (sem fallback pra RPC Supabase legado, que nunca teve esse conceito).
      stockEntry: (id: string, quantity: number) =>
        railwayAdmin<Product>(`/api/admin/products/${id}/stock-entry`, {
          method: 'POST',
          body: JSON.stringify({ quantity }),
        }),
      createFormulation: (payload: FormulatedProductPayload) =>
        railwayAdmin<Product>('/api/admin/products/erp-formulation', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      updateFormulation: (id: string, payload: FormulatedProductPayload) =>
        railwayAdmin<Product>(`/api/admin/products/${id}/erp-formulation`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
    },
    ingredients: {
      list: () => railwayAdmin<Ingredient[]>('/api/admin/ingredients'),
      create: (payload: IngredientPayload) =>
        railwayAdmin<Ingredient>('/api/admin/ingredients', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: IngredientPayload) =>
        railwayAdmin<Ingredient>(`/api/admin/ingredients/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) => railwayAdmin<void>(`/api/admin/ingredients/${id}`, { method: 'DELETE' }),
      stockEntry: (id: string, quantity: number) =>
        railwayAdmin<Ingredient>(`/api/admin/ingredients/${id}/stock-entry`, {
          method: 'POST',
          body: JSON.stringify({ quantity }),
        }),
    },
    services: {
      list: () => railwayAdmin<Service[]>('/api/admin/services'),
      create: (payload: ServicePayload) =>
        railwayAdmin<Service>('/api/admin/services', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: ServicePayload) =>
        railwayAdmin<Service>(`/api/admin/services/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) => railwayAdmin<void>(`/api/admin/services/${id}`, { method: 'DELETE' }),
    },
    motoboys: {
      list: () =>
        isRailwayAdminJwt()
          ? railwayAdmin<Motoboy[]>('/api/admin/motoboys')
          : rpc<Motoboy[]>('admin_list_motoboys', { p_token: adminToken() }),
      create: (payload: {
        name: string
        phone: string
        password: string
        payment_frequency?: PaymentFrequency | null
        payment_fixed_value?: number | null
      }) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Motoboy>('/api/admin/motoboys', {
              method: 'POST',
              body: JSON.stringify({
                name: payload.name,
                phone: payload.phone,
                password: payload.password,
                active: true,
                payment_frequency: payload.payment_frequency ?? null,
                payment_fixed_value: payload.payment_fixed_value ?? null,
              }),
            })
          : rpc<Motoboy>('admin_create_motoboy', {
              p_token: adminToken(),
              p_name: payload.name,
              p_phone: payload.phone,
              p_password: payload.password,
            }),
      update: (id: string, payload: Partial<Motoboy> & { password?: string }) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Motoboy>(`/api/admin/motoboys/${id}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: payload.name,
                phone: payload.phone,
                password: payload.password,
                active: payload.active ?? true,
                payment_frequency: payload.payment_frequency ?? null,
                payment_fixed_value: payload.payment_fixed_value ?? null,
              }),
            })
          : rpc<Motoboy>('admin_update_motoboy', {
              p_token: adminToken(),
              p_id: id,
              p_name: payload.name,
              p_phone: payload.phone,
              p_password: payload.password || null,
              p_active: payload.active ?? true,
            }),
      delete: (id: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<void>(`/api/admin/motoboys/${id}`, { method: 'DELETE' })
          : rpc<void>('admin_delete_motoboy', { p_token: adminToken(), p_id: id }),
      // null = nunca teve senha definida depois dessa feature existir (conta
      // criada antes da migration) — a UI trata como "defina uma senha nova
      // pra poder visualizar".
      getPassword: (id: string) => rpc<string | null>('admin_get_motoboy_password', { p_token: adminToken(), p_id: id }),
      pending: (id: string) => rpc<MotoboyPending>('admin_motoboy_pending', { p_token: adminToken(), p_id: id }),
      pay: (id: string, paymentMethod: PaymentMethod) =>
        rpc<MotoboySettlement>('admin_pay_motoboy', {
          p_token: adminToken(),
          p_motoboy_id: id,
          p_payment_method: paymentMethod,
        }),
    },
    vendedores: {
      list: () =>
        isRailwayAdminJwt()
          ? railwayAdmin<Vendedor[]>('/api/admin/vendedores')
          : rpc<Vendedor[]>('admin_list_vendedores', { p_token: adminToken() }),
      create: (payload: {
        name: string
        phone: string
        password: string
        commission_active?: boolean
        commission_percent?: number
        payment_frequency?: PaymentFrequency | null
        payment_fixed_value?: number | null
      }) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Vendedor>('/api/admin/vendedores', {
              method: 'POST',
              body: JSON.stringify({
                name: payload.name,
                phone: payload.phone,
                password: payload.password,
                active: true,
                commission_active: payload.commission_active ?? false,
                commission_percent: payload.commission_percent ?? null,
                payment_frequency: payload.payment_frequency ?? null,
                payment_fixed_value: payload.payment_fixed_value ?? null,
              }),
            })
          : rpc<Vendedor>('admin_create_vendedor', {
              p_token: adminToken(),
              p_name: payload.name,
              p_password: payload.password,
              p_commission_active: payload.commission_active ?? false,
              p_commission_percent: payload.commission_percent ?? null,
            }),
      update: (
        id: string,
        payload: {
          name: string
          phone: string
          active: boolean
          password?: string
          commission_active?: boolean
          commission_percent?: number
          payment_frequency?: PaymentFrequency | null
          payment_fixed_value?: number | null
        }
      ) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Vendedor>(`/api/admin/vendedores/${id}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: payload.name,
                phone: payload.phone,
                password: payload.password || null,
                active: payload.active,
                commission_active: payload.commission_active ?? false,
                commission_percent: payload.commission_percent ?? null,
                payment_frequency: payload.payment_frequency ?? null,
                payment_fixed_value: payload.payment_fixed_value ?? null,
              }),
            })
          : rpc<Vendedor>('admin_update_vendedor', {
              p_token: adminToken(),
              p_id: id,
              p_name: payload.name,
              p_active: payload.active,
              p_password: payload.password || null,
              p_commission_active: payload.commission_active ?? false,
              p_commission_percent: payload.commission_percent ?? null,
            }),
      delete: (id: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<void>(`/api/admin/vendedores/${id}`, { method: 'DELETE' })
          : rpc<void>('admin_delete_vendedor', { p_token: adminToken(), p_id: id }),
      getPassword: (id: string) => rpc<string | null>('admin_get_vendedor_password', { p_token: adminToken(), p_id: id }),
    },
    cozinhaUsers: {
      list: () => railwayAdmin<CozinhaUser[]>('/api/admin/cozinha-users'),
      create: (payload: { name: string; phone: string; password: string }) =>
        railwayAdmin<CozinhaUser>('/api/admin/cozinha-users', {
          method: 'POST',
          body: JSON.stringify({ name: payload.name, phone: payload.phone, password: payload.password, active: true }),
        }),
      update: (id: string, payload: { name: string; phone: string; active: boolean; password?: string }) =>
        railwayAdmin<CozinhaUser>(`/api/admin/cozinha-users/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: payload.name,
            phone: payload.phone,
            password: payload.password || null,
            active: payload.active,
          }),
        }),
      delete: (id: string) => railwayAdmin<void>(`/api/admin/cozinha-users/${id}`, { method: 'DELETE' }),
    },
    payroll: {
      alerts: () => railwayAdmin<PayrollAlert[]>('/api/admin/payroll/alerts'),
      reportPayment: (employeeRole: 'motoboy' | 'vendedor', employeeId: string, paymentMethod: string) =>
        railwayAdmin<PayrollPayment>('/api/admin/payroll/payments', {
          method: 'POST',
          body: JSON.stringify({ employee_role: employeeRole, employee_id: employeeId, payment_method: paymentMethod }),
        }),
      history: (employeeRole?: string, employeeId?: string) =>
        railwayAdmin<PayrollPayment[]>(
          employeeRole && employeeId
            ? `/api/admin/payroll/history?employee_role=${employeeRole}&employee_id=${employeeId}`
            : '/api/admin/payroll/history',
        ),
    },
    coupons: {
      list: () => rpc<Coupon[]>('admin_list_coupons', { p_token: adminToken() }),
      // Tipo deixou de ser exclusivo — desconto (flat OU por produto),
      // frete e os dois modos de aniversário combinam livremente no
      // mesmo cupom.
      create: (payload: {
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
        product_discounts?: ProductDiscount[]
        message_template?: string
        bday_customer_days_before?: number
        bday_store_date?: string
        bday_store_days_before?: number
        description?: string
      }) =>
        rpc<Coupon>('admin_create_coupon', {
          p_token: adminToken(),
          p_code: payload.code,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_message_template: payload.message_template || null,
          p_bday_customer_days_before: payload.bday_customer_days_before ?? null,
          p_bday_store_date: payload.bday_store_date || null,
          p_bday_store_days_before: payload.bday_store_days_before ?? null,
          p_description: payload.description || null,
        }),
      update: (
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
          product_discounts?: ProductDiscount[]
          message_template?: string
          bday_customer_days_before?: number
          bday_store_date?: string
          bday_store_days_before?: number
          description?: string
        }
      ) =>
        rpc<Coupon>('admin_update_coupon', {
          p_token: adminToken(),
          p_id: id,
          p_active: payload.active,
          p_allow_promotion_checkout: payload.allow_promotion_checkout,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_message_template: payload.message_template || null,
          p_bday_customer_days_before: payload.bday_customer_days_before ?? null,
          p_bday_store_date: payload.bday_store_date || null,
          p_bday_store_days_before: payload.bday_store_days_before ?? null,
          p_description: payload.description || null,
        }),
      delete: (id: string) => rpc<void>('admin_delete_coupon', { p_token: adminToken(), p_id: id }),
      // Roda a cada load do CRM (sem cron no projeto) — concede os
      // cupons de aniversário (cliente/loja) cujo dia de disparo é hoje;
      // devolve quem foi concedido agora pra front notificar via WhatsApp.
      checkBirthdays: () =>
        rpc<{ coupon_id: string; message_template: string; newly_granted: string[] }[]>('admin_check_birthday_coupons', {
          p_token: adminToken(),
        }),
      // Cupom alvo: nasce de um filtro no CRM, amarrado a clientes
      // específicos (por whatsapp) em vez de um código público qualquer um
      // pode usar. Intransferível — cada concessão só vale pro whatsapp dela.
      createTargeted: (payload: {
        code: string
        customer_whatsapps: string[]
        uses_per_customer?: number
        notify_customers?: boolean
        custom_message?: string
        combinable_with_public?: boolean
        allow_promotion_checkout?: boolean
        expires_at?: string
        max_uses?: number
        discount_type?: 'percent' | 'fixed'
        discount_value?: number
        shipping_discount_type?: 'percent' | 'fixed'
        shipping_discount_value?: number
        product_discounts?: ProductDiscount[]
      }) =>
        rpc<Coupon>('admin_create_targeted_coupon', {
          p_token: adminToken(),
          p_code: payload.code,
          p_customer_whatsapps: payload.customer_whatsapps,
          p_uses_per_customer: payload.uses_per_customer ?? 1,
          p_notify_customers: payload.notify_customers ?? true,
          p_custom_message: payload.custom_message || null,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
        }),
      updateTargeted: (
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
          product_discounts?: ProductDiscount[]
        }
      ) =>
        rpc<Coupon>('admin_update_targeted_coupon', {
          p_token: adminToken(),
          p_id: id,
          p_active: payload.active,
          p_uses_per_customer: payload.uses_per_customer ?? 1,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
        }),
      listGrants: (couponId: string) =>
        rpc<CouponGrant[]>('admin_list_coupon_grants', { p_token: adminToken(), p_coupon_id: couponId }),
    },
    promotions: {
      list: () => rpc<Promotion[]>('admin_list_promotions', { p_token: adminToken() }),
      create: (payload: {
        title: string
        subtitle?: string
        image_url: string
        product_ids: string[]
        promotion_type: PromotionType
        discount_type?: 'percent' | 'fixed'
        discount_value?: number
        shipping_discount_type?: 'percent' | 'fixed'
        shipping_discount_value?: number
        starts_at?: string
        expires_at?: string
        product_discounts?: ProductDiscount[]
        category_discounts?: { category_id: string; discount_type: 'percent' | 'fixed'; discount_value: number }[]
      }) =>
        rpc<Promotion>('admin_create_promotion', {
          p_token: adminToken(),
          p_title: payload.title,
          p_image_url: payload.image_url,
          p_product_ids: payload.product_ids,
          p_promotion_type: payload.promotion_type,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_category_discounts: payload.category_discounts && payload.category_discounts.length > 0 ? payload.category_discounts : null,
          p_subtitle: payload.subtitle || null,
        }),
      update: (
        id: string,
        payload: {
          title: string
          subtitle?: string
          image_url: string
          product_ids: string[]
          promotion_type: PromotionType
          discount_type?: 'percent' | 'fixed'
          discount_value?: number
          shipping_discount_type?: 'percent' | 'fixed'
          shipping_discount_value?: number
          active: boolean
          starts_at?: string
          expires_at?: string
          product_discounts?: ProductDiscount[]
          category_discounts?: { category_id: string; discount_type: 'percent' | 'fixed'; discount_value: number }[]
        }
      ) =>
        rpc<Promotion>('admin_update_promotion', {
          p_token: adminToken(),
          p_id: id,
          p_title: payload.title,
          p_image_url: payload.image_url,
          p_product_ids: payload.product_ids,
          p_promotion_type: payload.promotion_type,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_active: payload.active,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_category_discounts: payload.category_discounts && payload.category_discounts.length > 0 ? payload.category_discounts : null,
          p_subtitle: payload.subtitle || null,
        }),
      delete: (id: string) => rpc<void>('admin_delete_promotion', { p_token: adminToken(), p_id: id }),
    },
    pageDecorations: {
      save: (pageKey: PageKey, backgroundImageUrl: string | null, elements: PageDecorationElement[]) =>
        rpc<PageDecoration>('admin_save_page_decoration', {
          p_token: adminToken(),
          p_page_key: pageKey,
          p_background_image_url: backgroundImageUrl,
          p_elements: elements,
        }),
    },
    orders: {
      list: (status?: string) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Order[]>(
              status ? `/api/admin/orders?status=${encodeURIComponent(status)}` : '/api/admin/orders'
            )
          : rpc<Order[]>('admin_list_orders', { p_token: adminToken(), p_status: status ?? null }),
      updateStatus: (id: string, status: string, paymentConfirmed?: boolean, extras?: {
        payment_method?: string
        customer_name?: string
        customer_whatsapp?: string
      }) =>
        isRailwayAdminJwt()
          ? railwayAdmin<Order>(`/api/admin/orders/${id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({
                status,
                payment_confirmed: paymentConfirmed ?? null,
                payment_method: extras?.payment_method ?? null,
                customer_name: extras?.customer_name ?? null,
                customer_whatsapp: extras?.customer_whatsapp ?? null,
              }),
            })
          : rpc<Order>('admin_update_order_status', {
              p_token: adminToken(),
              p_order_id: id,
              p_status: status,
              p_payment_confirmed: paymentConfirmed ?? null,
            }),
      /** Cancel + optional MP refund — always via Railway (refund needs secrets). */
      cancel: (id: string, reason: string, note?: string) =>
        railwayAdmin<Order>(`/api/admin/orders/${id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason, note: note ?? null }),
        }),
      // Backend Rust monta o texto (varia por entrega/retirada) e manda pelo
      // WhatsApp da loja.
      notifyReady: (orderId: string) =>
        request<void>('/api/admin/whatsapp/notify-order-ready', {
          method: 'POST',
          body: JSON.stringify({ order_id: orderId }),
          token: adminToken(),
        }),
    },
    shippingSettings: {
      get: () =>
        isRailwayAdminJwt()
          ? railwayAdmin<ShippingSettings>('/api/admin/shipping-settings')
          : supabasePublicApi.shippingSettings.get(),
      update: (pricePerKm: number, maxKm: number | null) =>
        isRailwayAdminJwt()
          ? railwayAdmin<ShippingSettings>('/api/admin/shipping-settings', {
              method: 'PUT',
              body: JSON.stringify({ price_per_km: pricePerKm, max_km: maxKm }),
            })
          : rpc<ShippingSettings>('admin_update_shipping_settings', {
              p_token: adminToken(),
              p_price_per_km: pricePerKm,
              p_max_km: maxKm,
            }),
    },
    messageTemplates: {
      list: () => railwayAdmin<MessageTemplate[]>('/api/admin/message-templates'),
      save: (key: string, payload: { body: string; enabled: boolean; trigger_delay_minutes: number }) =>
        railwayAdmin<MessageTemplate>(`/api/admin/message-templates/${key}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
    },
    appointments: {
      list: () => railwayAdmin<Appointment[]>('/api/admin/appointments'),
      cancel: (id: string) => railwayAdmin<void>(`/api/admin/appointments/${id}/cancel`, { method: 'POST' }),
    },
    financeiro: {
      // Payload pesado (recent_orders/top_products/motoboys agregados) —
      // timeout maior que o padrão pra não abortar sozinho em loja com
      // muito histórico ou cold start do Railway (relatório sempre falhava
      // com "servidor demorou" mesmo quando a API respondia certo, só mais
      // devagar que os 15s do resto do app).
      get: () =>
        isRailwayAdminJwt()
          ? railwayAdmin<FinanceiroSummary>('/api/admin/financeiro', { timeoutMs: 40_000 })
          : rpc<FinanceiroSummary>('admin_financeiro', { p_token: adminToken() }),
      timeseries: (days?: number) =>
        rpc<FinanceiroTimeseriesPoint[]>('admin_financeiro_timeseries', { p_token: adminToken(), p_days: days ?? 30 }),
      lucro: async (from: string, to: string): Promise<LucroSummary> => {
        if (isRailwayAdminJwt()) {
          return railwayAdmin<LucroSummary>(
            `/api/admin/financeiro/lucro?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
          )
        }
        // Sessão Supabase / fallback: agrega no client a partir de pedidos + custo do catálogo.
        const [orders, products] = await Promise.all([
          rpc<Order[]>('admin_list_orders', { p_token: adminToken(), p_status: null }),
          rpc<Product[]>('admin_list_products', { p_token: adminToken() }),
        ])
        return computeLucroFromOrders(orders, products, from, to)
      },
    },
    siteSettings: {
      updateHeroImage: (imageUrl: string) =>
        rpc<{ hero_image_url: string }>('admin_update_hero_image', { p_token: adminToken(), p_image_url: imageUrl }),
      updateBackground: (settings: BgSettings) =>
        rpc<BgSettings>('admin_update_bg_settings', {
          p_token: adminToken(),
          p_bg_mode: settings.bg_mode,
          p_bg_image_url: settings.bg_image_url,
          p_bg_scale: settings.bg_scale,
          p_bg_x: settings.bg_x,
          p_bg_y: settings.bg_y,
          p_bg_fit: settings.bg_fit,
        }),
      updateSmoke: (settings: SmokeSettings) =>
        rpc<SmokeSettings>('admin_update_smoke_settings', {
          p_token: adminToken(),
          p_speed: settings.smoke_speed,
          p_count: settings.smoke_count,
          p_width: settings.smoke_width,
          p_height: settings.smoke_height,
        }),
      updateBadges: (settings: BadgesSettings) =>
        rpc<BadgesSettings>('admin_update_badges', {
          p_token: adminToken(),
          p_badges: settings.badges,
          p_layout: settings.badges_layout,
          p_gap: settings.badges_gap,
          p_offset_y: settings.badges_offset_y,
        }),
      updateCarouselStyle: (style: CarouselStyle) =>
        rpc<{ carousel_style: CarouselStyle }>('admin_update_carousel_style', { p_token: adminToken(), p_style: style }),
    },
    storeStatus: {
      // Multi-tenant (JWT Railway) NUNCA cai no schema Supabase `ufersin`
      // — essa schema não existe no projeto atual e gerava
      // "Invalid schema: ufersin" / 404 em store_hours. Rotas no motor:
      // GET /api/admin/store-status, PUT store-hours, PUT store-manual-status.
      get: () => {
        if (!isRailwayAdminJwt()) return supabasePublicApi.storeStatus.get()
        return railwayAdmin<StoreStatus>('/api/admin/store-status')
      },
      setHours: (hours: StoreHourDay[]) => {
        if (!isRailwayAdminJwt()) {
          return rpc<{ ok: boolean }>('admin_set_store_hours', { p_token: adminToken(), p_hours: hours })
        }
        return railwayAdmin<{ ok: boolean }>('/api/admin/store-hours', {
          method: 'PUT',
          body: JSON.stringify({ hours }),
        })
      },
      setManualStatus: (manuallyClosed: boolean, reason?: string) => {
        if (!isRailwayAdminJwt()) {
          return rpc<{ ok: boolean }>('admin_set_store_manual_status', {
            p_token: adminToken(),
            p_manually_closed: manuallyClosed,
            p_reason: reason ?? null,
          })
        }
        return railwayAdmin<{ ok: boolean }>('/api/admin/store-manual-status', {
          method: 'PUT',
          body: JSON.stringify({ manually_closed: manuallyClosed, reason: reason ?? null }),
        })
      },
    },
    crm: {
      customers: () => rpc<CrmCustomer[]>('admin_crm_customers', { p_token: adminToken() }),
    },
    segments: {
      list: () => rpc<CrmSegment[]>('admin_list_segments', { p_token: adminToken() }),
      create: (payload: { name: string; description?: string; filter_criteria: CrmFilterCriteria }) =>
        rpc<CrmSegment>('admin_create_segment', {
          p_token: adminToken(),
          p_name: payload.name,
          p_description: payload.description || null,
          p_filter_criteria: payload.filter_criteria,
        }),
      update: (id: string, payload: { name: string; description?: string; filter_criteria: CrmFilterCriteria }) =>
        rpc<CrmSegment>('admin_update_segment', {
          p_token: adminToken(),
          p_id: id,
          p_name: payload.name,
          p_description: payload.description || null,
          p_filter_criteria: payload.filter_criteria,
        }),
      delete: (id: string) => rpc<void>('admin_delete_segment', { p_token: adminToken(), p_id: id }),
    },
    // "Campanha": notifica os clientes de um segmento via WhatsApp com um
    // cupom exclusivo — 'segmento' dispara uma vez pros clientes que casam
    // com o critério do segmento agora; 'evento' guarda um critério
    // diferente (trigger_criteria) e dispara (uma vez por cliente) quando
    // esse critério passar a valer pra ele.
    campanhaCoupons: {
      list: (segmentId: string) =>
        rpc<CrmCampanhaCoupon[]>('admin_list_campanha_coupons', { p_token: adminToken(), p_segment_id: segmentId }),
      // Cria só o "cadastro" da campanha — sem gatilho, sem cupom nenhum.
      // Gatilho (setGatilho, só pra 'evento') e cupom(s) (createExtra) são
      // passos separados, cada um pelo próprio subcard.
      create: (payload: {
        segment_id: string
        orientation: CampanhaOrientation
        name: string
        description?: string
        starts_at?: string
        ends_at?: string
      }) =>
        rpc<CrmCampanhaCoupon>('admin_create_campanha', {
          p_token: adminToken(),
          p_segment_id: payload.segment_id,
          p_orientation: payload.orientation,
          p_name: payload.name,
          p_description: payload.description || null,
          p_starts_at: payload.starts_at || null,
          p_ends_at: payload.ends_at || null,
        }),
      // Define/edita o gatilho (trigger_criteria) de uma campanha 'evento'
      // — decoupled do cadastro e de qualquer cupom. null limpa (volta
      // pra "sem critério ainda").
      setGatilho: (id: string, triggerCriteria: CrmFilterCriteria | null, description?: string) =>
        rpc<CrmCampanhaCoupon>('admin_set_campanha_gatilho', {
          p_token: adminToken(),
          p_id: id,
          p_trigger_criteria: triggerCriteria,
          p_trigger_description: description || null,
        }),
      // "Encerrar por evento" da campanha inteira (principal + extras) —
      // null limpa.
      setEndCriteria: (id: string, endCriteria: CrmFilterCriteria | null, description?: string) =>
        rpc<CrmCampanhaCoupon>('admin_set_campanha_end_criteria', {
          p_token: adminToken(),
          p_id: id,
          p_end_criteria: endCriteria,
          p_end_description: description ?? null,
        }),
      // Desvincula o cupom principal (volta pra "aguardando cupom").
      deletePrimary: (id: string) => rpc<CrmCampanhaCoupon>('admin_delete_campanha_primary_coupon', { p_token: adminToken(), p_id: id }),
      // Edita nome/descrição/duração do cadastro — não mexe em gatilho
      // nem em cupom nenhum.
      updateCadastro: (id: string, payload: { name: string; description?: string; starts_at?: string; ends_at?: string }) =>
        rpc<CrmCampanhaCoupon>('admin_update_campanha_cadastro', {
          p_token: adminToken(),
          p_id: id,
          p_name: payload.name,
          p_description: payload.description || null,
          p_starts_at: payload.starts_at || null,
          p_ends_at: payload.ends_at || null,
        }),
      // Reavalia o trigger_criteria de uma campanha 'evento' contra a lista
      // atual de whatsapps que casam com ele (calculada no front) — grants
      // pra quem ainda não tinha, idempotente (não duplica).
      fireEvent: (id: string, customerWhatsapps: string[]) =>
        rpc<{ newly_granted: string[]; to_notify: { coupon_id: string; message_template: string; whatsapps: string[] }[] }>(
          'admin_fire_campanha_event',
          { p_token: adminToken(), p_id: id, p_customer_whatsapps: customerWhatsapps }
        ),
      // Agendamento de disparo do cupom PRINCIPAL — null/null volta a
      // notificar na hora que concede (comportamento de sempre).
      setSchedule: (id: string, delayDays: number | null, hour: number | null) =>
        rpc<CrmCampanhaCoupon>('admin_set_campanha_coupon_schedule', {
          p_token: adminToken(),
          p_id: id,
          p_delay_days: delayDays,
          p_hour: hour,
        }),
      // Mesma coisa, só que pra um cupom EXTRA específico (ver
      // campanhaExtraCoupons.setSchedule mais abaixo — fica junto aqui
      // por ser chamado do mesmo lugar da UI).
      setExtraSchedule: (extraCouponId: string, delayDays: number | null, hour: number | null) =>
        rpc<void>('admin_set_extra_coupon_schedule', {
          p_token: adminToken(),
          p_id: extraCouponId,
          p_delay_days: delayDays,
          p_hour: hour,
        }),
      // Roda a cada load do CRM: resolve concessões agendadas cujo
      // prazo+horário já bateu, marca como notificadas e devolve a
      // lista pro front disparar o WhatsApp de cada uma.
      dispatchScheduledNotifications: () =>
        rpc<{ coupon_id: string; customer_whatsapp: string; message_template: string }[]>(
          'admin_dispatch_scheduled_coupon_notifications',
          { p_token: adminToken() }
        ),
      delete: (id: string) => rpc<void>('admin_delete_campanha_coupon', { p_token: adminToken(), p_id: id }),
      // Liga/desliga a campanha inteira — junto com ela o cupom exclusivo
      // por trás (não existe on/off separado só do cupom de uma campanha).
      toggleActive: (id: string, active: boolean) =>
        rpc<CrmCampanhaCoupon>('admin_toggle_campanha_coupon', { p_token: adminToken(), p_id: id, p_active: active }),
      // Só mensagem/desconto/prazo do cupom já existente — orientation e
      // gatilho não moram mais aqui (ver setGatilho).
      update: (
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
          product_discounts?: ProductDiscount[]
          description?: string
        }
      ) =>
        rpc<CrmCampanhaCoupon>('admin_update_campanha_coupon', {
          p_token: adminToken(),
          p_id: id,
          p_message_template: payload.message_template,
          p_uses_per_customer: payload.uses_per_customer ?? 1,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_description: payload.description || null,
        }),
      // Cupom exclusivo — se a campanha ainda não tem nenhum, este vira o
      // PRINCIPAL (preenche coupon_id) e, se for 'segmento', dispara na
      // hora pra quem já bate o critério (customer_whatsapps); senão
      // entra como mais um extra, igual já funcionava.
      createExtra: (
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
          product_discounts?: ProductDiscount[]
          customer_whatsapps?: string[]
          description?: string
        }
      ) =>
        rpc<Coupon>('admin_create_campanha_extra_coupon', {
          p_token: adminToken(),
          p_campanha_id: campanhaId,
          p_code: payload.code,
          p_message_template: payload.message_template,
          p_uses_per_customer: payload.uses_per_customer ?? 1,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_customer_whatsapps: payload.customer_whatsapps ?? [],
          p_description: payload.description || null,
        }),
      deleteExtra: (id: string) => rpc<void>('admin_delete_campanha_extra_coupon', { p_token: adminToken(), p_id: id }),
      // Edita mensagem/desconto/prazo de um cupom extra já existente —
      // código continua imutável, igual ao principal.
      updateExtra: (
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
          product_discounts?: ProductDiscount[]
          description?: string
        }
      ) =>
        rpc<CrmCampanhaCoupon>('admin_update_campanha_extra_coupon', {
          p_token: adminToken(),
          p_id: id,
          p_message_template: payload.message_template,
          p_uses_per_customer: payload.uses_per_customer ?? 1,
          p_combinable_with_public: payload.combinable_with_public ?? false,
          p_allow_promotion_checkout: payload.allow_promotion_checkout ?? false,
          p_starts_at: payload.starts_at || null,
          p_expires_at: payload.expires_at || null,
          p_max_uses: payload.max_uses ?? null,
          p_discount_type: payload.discount_type ?? null,
          p_discount_value: payload.discount_value ?? null,
          p_shipping_discount_type: payload.shipping_discount_type ?? null,
          p_shipping_discount_value: payload.shipping_discount_value ?? null,
          p_product_discounts: payload.product_discounts && payload.product_discounts.length > 0 ? payload.product_discounts : null,
          p_description: payload.description || null,
        }),
      // "Encerrar por evento" de UM cupom extra específico — null limpa.
      setExtraEndCriteria: (id: string, endCriteria: CrmFilterCriteria | null) =>
        rpc<CrmCampanhaCoupon>('admin_set_extra_coupon_end_criteria', {
          p_token: adminToken(),
          p_id: id,
          p_end_criteria: endCriteria,
        }),
      deactivateExtra: (id: string) => rpc<CrmCampanhaCoupon>('admin_deactivate_campanha_extra_coupon', { p_token: adminToken(), p_id: id }),
    },
    // Único pedaço do admin que ainda fala com o backend Rust (Railway) em
    // vez do Supabase — a chave da Evolution API precisa ficar fora do
    // navegador.
    whatsapp: {
      status: () => request<EvolutionStatus>('/api/admin/whatsapp/status', { token: adminToken() }),
      connect: () => request<EvolutionConnect>('/api/admin/whatsapp/connect', { token: adminToken() }),
      logout: () => request<void>('/api/admin/whatsapp/logout', { method: 'POST', token: adminToken() }),
      // Mesmo motor Railway das demais rotas WhatsApp — AdminTenant no
      // backend (JWT Resolutoo OU sessão sunset), igual status/connect.
      connectionEvents: () =>
        request<
          {
            id: string
            event_type: string
            previous_state: string | null
            new_state: string | null
            created_at: string
          }[]
        >('/api/admin/whatsapp/connection-events', { token: adminToken() }),
      // Dispara pelo WhatsApp da loja pra cada cliente contemplado num
      // cupom alvo — a não ser que "não notificar clientes" tenha sido
      // marcado na criação (checado nos dois lados, front e Rust).
      notifyCouponGrant: (couponId: string, customMessage?: string) =>
        request<void>('/api/admin/whatsapp/notify-coupon-grant', {
          method: 'POST',
          body: JSON.stringify({ coupon_id: couponId, custom_message: customMessage || null }),
          token: adminToken(),
        }),
    },
    // Injeta mensagem sintética no MESMO pipeline que uma mensagem real de
    // WhatsApp aciona (backend Rust repassa pro assistant-ia) — usado pelo
    // "Novo Chat"/caixa de envio em /admin/chat pra testar a IA sem
    // precisar de um segundo número de verdade. Nunca chama o assistant-ia
    // direto do navegador (mesmo motivo do bloco whatsapp acima).
    assistantIa: {
      simulateMessage: (phone: string, text: string, customerName?: string) =>
        request<void>('/api/admin/assistant-ia/simulate-message', {
          method: 'POST',
          body: JSON.stringify({ phone, text, customer_name: customerName || null }),
          token: adminToken(),
        }),
      // Proxies autenticados pro assistant-ia (nunca chamado direto do
      // browser — ver ecommerce/backend/src/routes/admin.rs).
      conversations: () => request<unknown[]>('/api/admin/assistant-ia/conversations', { token: adminToken() }),
      conversationMessages: (id: string) =>
        request<unknown[]>(`/api/admin/assistant-ia/conversations/${id}/messages`, { token: adminToken() }),
      setConversationEnabled: (id: string, enabled: boolean) =>
        request<unknown>(`/api/admin/assistant-ia/conversations/${id}/assistant-enabled`, {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
          token: adminToken(),
        }),
      deleteConversation: (id: string) =>
        request<void>(`/api/admin/assistant-ia/conversations/${id}`, { method: 'DELETE', token: adminToken() }),
    },
    onboardingGate: {
      get: () =>
        railwayAdmin<{ onboarding_hours_done: boolean }>('/api/admin/onboarding-gate'),
    },
  },
  // PDV — acessível por admin OU vendedor. JWT Railway → motor isolado por
  // tenant (`/api/pdv/*`). Sessão Supabase (Sunset/ufersin) → RPCs. Nunca
  // misturar: JWT lendo schema público era a causa do PDV “não achar”
  // produto recém-criado no admin.
  pdv: {
    listProducts: () =>
      isRailwayAdminJwt()
        ? railwayAdmin<Product[]>('/api/pdv/products')
        : supabasePublicApi.products.list(),
    // Serviços no PDV só existem no motor Railway (schema `loja`) — lojas
    // ainda na Supabase legada não têm a feature, retorna lista vazia.
    listServices: () => (isRailwayAdminJwt() ? railwayAdmin<PublicService[]>('/api/pdv/services') : Promise.resolve([])),
    createSale: (payload: {
      items: PdvSaleItemInput[]
      payment_method: PaymentMethod
      customer_name?: string
      customer_whatsapp?: string
      discount_type?: 'percent' | 'fixed'
      discount_value?: number
      card_payment_mode?: 'nfc' | 'link' | 'transparente'
    }) =>
      isRailwayAdminJwt()
        ? railwayAdmin<Order>('/api/pdv/sales', {
            method: 'POST',
            body: JSON.stringify({
              items: payload.items,
              payment_method: payload.payment_method,
              customer_name: payload.customer_name || null,
              customer_whatsapp: payload.customer_whatsapp || null,
              discount_type: payload.discount_type ?? null,
              discount_value: payload.discount_value ?? null,
              card_payment_mode: payload.card_payment_mode ?? null,
            }),
          })
        : rpc<Order>('pdv_create_sale', {
            p_token: adminToken(),
            p_items: payload.items,
            p_payment_method: payload.payment_method,
            p_customer_name: payload.customer_name || null,
            p_customer_whatsapp: payload.customer_whatsapp || null,
            p_discount_type: payload.discount_type ?? null,
            p_discount_value: payload.discount_value ?? null,
          }),
    // Único disparo de WhatsApp da venda de balcão (o "obrigado pela
    // compra") — nunca passa pelo passo a passo de pedido online, e sai
    // sempre do número da loja (vendedor não tem instância própria).
    notifySale: (orderId: string) =>
      request<void>('/api/pdv/notify-sale', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }),
    // Pix copia-e-cola pro WhatsApp do comprador (só se o PDV gerou QR e
    // o formulário tinha telefone).
    notifyPixCharge: (orderId: string) =>
      request<void>('/api/pdv/notify-pix-charge', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId }),
      }),
    // Link de cobrança no cartão (link de pagamento / checkout transparente)
    // — manda pela instância Evolution API JÁ CONECTADA da própria loja,
    // nunca abrindo WhatsApp no aparelho do lojista.
    notifyCardCharge: (orderId: string, whatsapp: string, linkUrl?: string, checkoutUrl?: string) =>
      request<void>('/api/pdv/notify-card-charge', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId, whatsapp, link_url: linkUrl, checkout_url: checkoutUrl }),
      }),
    relatorio: () =>
      isRailwayAdminJwt()
        ? railwayAdmin<VendedorRelatorio>('/api/pdv/relatorio')
        : rpc<VendedorRelatorio>('vendedor_relatorio', { p_token: adminToken() }),
    comandas: {
      list: () => railwayAdmin<Comanda[]>('/api/pdv/comandas'),
      create: (label: string) =>
        railwayAdmin<Comanda>('/api/pdv/comandas', { method: 'POST', body: JSON.stringify({ label }) }),
      get: (id: string) => railwayAdmin<Comanda>(`/api/pdv/comandas/${id}`),
      addItem: (id: string, productId: string, quantity: number) =>
        railwayAdmin<Comanda>(`/api/pdv/comandas/${id}/items`, {
          method: 'POST',
          body: JSON.stringify({ product_id: productId, quantity }),
        }),
      removeItem: (id: string, itemId: string) =>
        railwayAdmin<Comanda>(`/api/pdv/comandas/${id}/items/${itemId}`, { method: 'DELETE' }),
      pay: (
        id: string,
        payload: { payment_method: PaymentMethod; card_payment_mode?: 'nfc' | 'link' | 'transparente'; card_type?: string; card_installments?: number },
      ) => railwayAdmin<Order>(`/api/pdv/comandas/${id}/pay`, { method: 'POST', body: JSON.stringify(payload) }),
    },
  },
  // Autoatendimento de pagamento fixo (motoboy ou vendedor logado).
  payroll: {
    myPending: () => request<PayrollPayment[]>('/api/payroll/my-pending', { token: staffToken() }),
    confirm: (id: string) =>
      request<void>(`/api/payroll/payments/${id}/confirm`, { method: 'POST', token: staffToken() }),
  },
  motoboy: {
    orders: {
      // BUG: motoboy_login virou JWT real (Rust) faz um tempo, mas essas duas
      // chamadas continuaram numa RPC Supabase legada que só entende sessão
      // opaca -- fila de pedidos prontos ficava sempre vazia pra qualquer
      // motoboy autenticado de verdade. list_orders/counts já existem em
      // Rust (motoboy.rs), só faltava apontar pra lá.
      list: (status: string) =>
        isRailwayAdminJwt(motoboyToken())
          ? request<Order[]>(`/api/motoboy/orders?status=${encodeURIComponent(status)}`, { token: motoboyToken() })
          : rpc<Order[]>('motoboy_list_orders', { p_token: motoboyToken(), p_status: status }),
      counts: () =>
        isRailwayAdminJwt(motoboyToken())
          ? Promise.all(
              (['pedido_pronto', 'em_rota_de_entrega', 'concluido'] as const).map((status) =>
                request<Order[]>(`/api/motoboy/orders?status=${status}`, { token: motoboyToken() }).then(
                  (rows) => [status, rows.length] as const,
                ),
              ),
            ).then((pairs) => Object.fromEntries(pairs))
          : rpc<Record<string, number>>('motoboy_order_counts', { p_token: motoboyToken() }),
      // Cobrar Pix na entrega -- usa o Mercado Pago da própria loja da
      // corrida (nunca credencial do motoboy/plataforma). Ver motoboy.rs.
      createPix: (orderId: string) =>
        request<{ payment_id: string; qr_code: string; qr_code_base64: string }>(`/api/motoboy/orders/${orderId}/pix`, {
          method: 'POST',
          token: motoboyToken(),
        }),
    },
    // Corrida ativa: sobrevive a troca de página/reload porque o estado
    // mora no banco (sunset.motoboy_runs), não no componente React — ver
    // supabase/sunset_motoboy_runs.sql.
    runs: {
      active: () => rpc<MotoboyRun | null>('motoboy_active_run', { p_token: motoboyToken() }),
      // Passa pelo backend Rust (não a RPC direto) — ele decide a ordem de
      // entrega com distância real de rua via Google Routes quando
      // configurada, e só então chama a RPC já com a ordem pronta. Sem a
      // chave configurada ainda, o backend chama a mesma RPC sem essa
      // etapa extra e o resultado é idêntico a antes.
      start: (orderIds: string[]) =>
        request<MotoboyRun>('/api/motoboy/runs/start', {
          method: 'POST',
          body: JSON.stringify({ order_ids: orderIds }),
          token: motoboyToken(),
        }),
      updatePosition: (lat: number, lng: number, heading?: number | null) =>
        rpc<void>('motoboy_update_run_position', {
          p_token: motoboyToken(),
          p_lat: lat,
          p_lng: lng,
          p_heading: heading ?? null,
        }),
      completeCurrent: (paymentConfirmed?: boolean) =>
        rpc<MotoboyRun>('motoboy_complete_current_delivery', {
          p_token: motoboyToken(),
          p_payment_confirmed: paymentConfirmed ?? null,
        }),
    },
    financeiro: {
      get: () => rpc<MotoboyFinanceiro>('motoboy_financeiro', { p_token: motoboyToken() }),
    },
    // Igual admin.whatsapp, mas na instância própria do motoboy
    // (backend Rust monta o nome "motoboy-<id>" sozinho).
    whatsapp: {
      status: () => request<EvolutionStatus>('/api/motoboy/whatsapp/status', { token: motoboyToken() }),
      connect: () => request<EvolutionConnect>('/api/motoboy/whatsapp/connect', { token: motoboyToken() }),
      logout: () => request<void>('/api/motoboy/whatsapp/logout', { method: 'POST', token: motoboyToken() }),
      // Chamado depois de motoboy_start_run (que só mexe no banco) — manda
      // a mensagem de verdade a partir do WhatsApp do próprio motoboy,
      // avisando que saiu pra entrega + link de acompanhamento.
      notifyEnRoute: (orderId: string) =>
        request<void>('/api/motoboy/whatsapp/notify-en-route', {
          method: 'POST',
          body: JSON.stringify({ order_id: orderId }),
          token: motoboyToken(),
        }),
    },
  },
}

// Fora do modo demo, o dispatch é fixo (decidido uma vez, no load do
// módulo) — igual sempre foi. Dentro dele, `api.xxx` passa a resolver pro
// localApi a cada acesso (Proxy, não um valor congelado), porque o modo
// demo liga DEPOIS que este módulo já carregou (ver demoMode.ts) — um
// `const` normal já teria decidido remoteApi antes da flag existir.
export const api: typeof remoteApi = USE_LOCAL_DB
  ? localApi
  : new Proxy(remoteApi, {
      get(target, prop, receiver) {
        const impl = isDemoModeActive() ? localApi : target
        return Reflect.get(impl, prop, receiver)
      },
    })

export { ApiError }
