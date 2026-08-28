// Config real do onboarding do lojista (plataforma Resolutoo/ufersin) --
// diferente de demoMode.ts (que só simula plano na demo pública). Busca
// no backend ufersin (ver ufersin/backend/src/routes/onboarding.rs::tenant_config)
// — endpoint PÚBLICO, só devolve as flags, nunca credenciais de pagamento.
//
// Slug resolvido nesta ordem:
// 1. query `?tenant=` na URL atual (vitrine pública)
// 2. session/localStorage do login admin (`?tenant=` do dashboard)
// 3. VITE_TENANT_SLUG (deploy single-tenant legado)
//
// Sem slug, ou se a busca falhar, cai em essential restritivo (não
// premium liberado) pra não mostrar CRM/Promoções pra loja real.
import { fetchWithTimeout } from './fetchTimeout'

export interface TenantConfig {
  slug: string
  loja_nome: string
  /** False when Resolutoo has no active subscription for this slug (cancelado / offline). */
  ativa: boolean
  plano: 'essential' | 'management' | 'premium'
  vender_externamente: boolean
  whatsapp_habilitado: boolean
  /** Dígitos do WhatsApp da loja (onboarding / Meu plano) pra `wa.me`. */
  whatsapp: string
  forma_pagamento: 'manual' | 'plataforma'
  plataforma_pagamento: 'mercado_pago' | null
  /** False para conexão do modelo antigo (Access Token colado à mão) — só
   * true quando veio do fluxo OAuth novo. AdminLayout.tsx usa isso pra
   * decidir se o gate de "Mercado Pago desconectado" fica bloqueando. */
  plataforma_oauth: boolean
  layout_style: 'ufersin' | 'burgerbite' | 'burgerhouse'
  /** "ecommerce" ou "eletronicos" — os 3 layout_style hoje são todos temas
   * de food-delivery; usado pra evitar mostrar copy padrão de comida numa
   * loja de outro ramo enquanto não existe tema dedicado (ver Landing.tsx). */
  vertical: 'ecommerce' | 'eletronicos'
  cor_principal: string | null
  /** Checkout exige consentimento 18+ além da compra normal. */
  vende_mais_18: boolean
  /** Vitrine: só aceita retirada no local (sem entrega/frete/motoboy). */
  apenas_retirada: boolean
  /** Pagamento de pedidos de retirada só no ato da retirada na loja. */
  pagamento_na_retirada: boolean
  /** Entrega só com Pix já pago no checkout. */
  entrega_somente_pix: boolean
  /** Preferência: confirmação manual (sem QR Pix online). */
  pagamento_manual: boolean
  endereco: string
  endereco_numero: string
  instagram: string
  facebook: string
  logo_url: string | null
  landing_headline: string | null
  landing_sub: string | null
  landing_badge: string | null
  /** 3-4 cards de destaque da landing (título + descrição) -- null/vazio = nunca customizado, usa os defaults do componente. */
  landing_highlights: { title: string; desc: string }[] | null
  /** Essential landing hero image (Management/Premium use promo banners instead). */
  landing_hero_image_url: string | null
  cart_fab_style: 'sacola' | 'cart_icon'
  cart_fab_animate: boolean
}

export type ShareNetwork = 'whatsapp' | 'instagram' | 'facebook'

export interface ShareLink {
  network: ShareNetwork
  href: string
  label: string
}

/** True when the store should use online Pix (platform credentials + not manual mode). */
export function tenantHasOnlinePix(config: TenantConfig | null | undefined): boolean {
  return config?.forma_pagamento === 'plataforma' && !config?.pagamento_manual
}

/** True when PDV/checkout/pedidos must use payment-confirmation toggles (no QR). */
export function tenantUsesManualPayment(config: TenantConfig | null | undefined): boolean {
  return !!config?.pagamento_manual || config?.forma_pagamento === 'manual'
}

/** True when pickup orders should skip online Pix and settle at the store. */
export function tenantPaysAtPickup(
  config: TenantConfig | null | undefined,
  isPickup: boolean,
): boolean {
  return !!config?.pagamento_na_retirada && isPickup
}

/** Error when delivery + payment not prepaid via the platform gateway
 * (Pix or cartão), under `entrega_somente_pix`. O nome do campo ficou de
 * quando só existia Pix online — hoje a mesma conta Mercado Pago processa
 * cartão também, então "entrega só com pagamento já feito" aceita os dois,
 * nunca só Pix. */
export function deliveryPixOnlyError(
  config: TenantConfig | null | undefined,
  isPickup: boolean,
  paymentMethod: string,
): string | null {
  if (!config?.entrega_somente_pix || isPickup) return null
  if (!tenantHasOnlinePix(config)) {
    return 'Esta loja só aceita entrega com pagamento já feito no checkout. Escolha retirada na loja ou pague online (loja precisa ter pagamento de plataforma configurado).'
  }
  if (paymentMethod !== 'pix' && paymentMethod !== 'cartao') {
    return 'Compras com entrega só são aceitas com Pix ou cartão pagos no checkout. Outras formas de pagamento são só para retirada na loja.'
  }
  return null
}

/** Fail-closed: essential + sem pedidos externos até a config real chegar
 *  (evita flash de menu completo → sumir, que parece "bug de tela verde"). */
const DEFAULT_CONFIG: TenantConfig = {
  slug: '',
  loja_nome: '',
  ativa: true,
  plano: 'essential',
  vender_externamente: true,
  whatsapp_habilitado: false,
  whatsapp: '',
  forma_pagamento: 'manual',
  plataforma_pagamento: null,
  plataforma_oauth: false,
  layout_style: 'ufersin',
  vertical: 'ecommerce',
  cor_principal: null,
  vende_mais_18: false,
  apenas_retirada: false,
  pagamento_na_retirada: false,
  entrega_somente_pix: false,
  pagamento_manual: false,
  endereco: '',
  endereco_numero: '',
  instagram: '',
  facebook: '',
  logo_url: null,
  landing_headline: null,
  landing_sub: null,
  landing_badge: null,
  landing_highlights: null,
  landing_hero_image_url: null,
  cart_fab_style: 'sacola',
  cart_fab_animate: false,
}

const RODOLETAS_API_URL = import.meta.env.VITE_RODOLETAS_API_URL || 'http://localhost:8081'
const ENV_TENANT_SLUG = (import.meta.env.VITE_TENANT_SLUG as string | undefined)?.trim() || ''

/** Fallback quando o Railway ufersin-api está em binário antigo (sem layout_style).
 *  RPC em schema resolutoo — tabela real do assinante (public.subscribers é legado). */
const SUPABASE_URL = (
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  'https://migkkrwzykpztrakbfij.supabase.co'
).replace(/\/$/, '')
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pZ2trcnd6eWtwenRyYWtiZmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjI2OTQsImV4cCI6MjA5MTUzODY5NH0.0bEy_WikqnfPU9eV7wusSb757dhiTiK5D2KeDSWyJTo'

/** Namespace da loja — isolado de `resolutoo_platform_*`. */
const SLUG_STORAGE_KEY = 'resolutoo_loja_tenant_slug'
const LEGACY_SLUG_STORAGE_KEY = 'resolutoo_tenant_slug'

function migrateTenantSlugKey() {
  if (typeof window === 'undefined') return
  try {
    const legacy = localStorage.getItem(LEGACY_SLUG_STORAGE_KEY)
    if (!legacy) return
    if (!localStorage.getItem(SLUG_STORAGE_KEY)) {
      localStorage.setItem(SLUG_STORAGE_KEY, legacy)
    }
    localStorage.removeItem(LEGACY_SLUG_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
migrateTenantSlugKey()

// Slug capturado UMA VEZ na primeira URL desta aba/iframe -- nunca muda
// depois, mesmo que uma navegação interna (SPA) perca o `?tenant=` da URL.
// Bug real encontrado ao vivo: o fallback pra localStorage abaixo é
// GLOBAL na origin inteira -- visitar `?tenant=vrtech` numa aba e depois
// perder o `?tenant=` numa navegação interna de OUTRA aba/iframe (ainda em
// `?tenant=resusu`) fazia essa segunda aba herdar "vrtech" do localStorage
// e trocar de loja inteira sem aviso (inclusive o vertical eletrônica x
// ecommerce, que troca a árvore de rotas inteira). Capturar o slug real
// desta aba já na carga inicial e preferir ele ANTES do fallback cross-tab
// torna cada aba/iframe imune ao que outra aba escreveu no localStorage.
const INITIAL_SLUG = (() => {
  if (typeof window === 'undefined') return ''
  try {
    return new URLSearchParams(window.location.search).get('tenant')?.trim().toLowerCase() ?? ''
  } catch {
    return ''
  }
})()

/** Session cache: Meu plano muda raramente; focus só revalida após TTL. */
const CACHE_TTL_MS = 5 * 60_000

let cached: TenantConfig | null = null
let inFlight: Promise<TenantConfig> | null = null
let cachedForSlug: string | null = null
let cachedAt = 0

export function persistTenantSlug(slug: string) {
  const s = slug.trim().toLowerCase()
  if (!s || typeof window === 'undefined') return
  try {
    localStorage.setItem(SLUG_STORAGE_KEY, s)
  } catch {
    /* ignore */
  }
}

export const LOJA_OFFLINE_MSG =
  'loja offline — assine novamente no Resolutoo pra reativar o painel'

const OFFLINE_MSG_KEY = 'resolutoo_loja_offline_msg'

export function stashLojaOfflineMessage(message?: string | null) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(OFFLINE_MSG_KEY, (message || LOJA_OFFLINE_MSG).trim() || LOJA_OFFLINE_MSG)
  } catch {
    /* ignore */
  }
}

export function takeLojaOfflineMessage(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const msg = sessionStorage.getItem(OFFLINE_MSG_KEY)
    sessionStorage.removeItem(OFFLINE_MSG_KEY)
    return msg?.trim() || null
  } catch {
    return null
  }
}

/** Remove slug persistido (entrada na demo pública / logout limpo).
 * Só a key da loja — nunca plataforma (`resolutoo_platform_*`). */
export function clearTenantSlug() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SLUG_STORAGE_KEY)
    localStorage.removeItem(LEGACY_SLUG_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function resolveTenantSlug(): string {
  if (typeof window === 'undefined') return ENV_TENANT_SLUG
  // Query ?tenant= manda no path público da loja — tem prioridade sobre
  // localStorage (login admin anterior na mesma origem não pode sequestrar
  // a vitrine de outro slug).
  try {
    const q = new URLSearchParams(window.location.search).get('tenant')?.trim()
    if (q) return q.toLowerCase()
  } catch {
    /* ignore */
  }
  // Demo pública ativa: nunca herda slug de sessão anterior na mesma origem.
  // (sessionStorage direto pra evitar import circular com demoMode.ts)
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rodoletas_demo_active') === 'true') {
      return ''
    }
  } catch {
    /* ignore */
  }
  // Slug com que ESTA aba/iframe abriu -- prioridade sobre o fallback
  // cross-tab abaixo, senão uma navegação interna que perca o `?tenant=`
  // (bug separado, mas acontece) herdaria o tenant de OUTRA aba/iframe
  // que por acaso escreveu por último no localStorage compartilhado.
  if (INITIAL_SLUG) return INITIAL_SLUG
  try {
    const fromAuth = localStorage.getItem(SLUG_STORAGE_KEY)?.trim()
    if (fromAuth) return fromAuth.toLowerCase()
  } catch {
    /* ignore */
  }
  if (ENV_TENANT_SLUG) return ENV_TENANT_SLUG
  return ''
}

/**
 * Mantém `?tenant=` em toda navegação da vitrine. React Router `Link to="/"`
 * e `navigate('/')` descartam o search — sem isso a loja vira `/loja` bare
 * (demo Ufersin / "Loja sem tenant").
 * Em modo demo (`rodoletas_demo_active`) não injeta tenant.
 */
export function withTenantSearch(existingSearch?: string | null): string {
  const raw = (existingSearch ?? '').replace(/^\?/, '')
  const params = new URLSearchParams(raw)
  let demo = false
  try {
    demo = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('rodoletas_demo_active') === 'true'
  } catch {
    /* ignore */
  }
  if (!demo) {
    const slug = resolveTenantSlug()
    if (slug) params.set('tenant', slug)
    else params.delete('tenant')
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** `to` de react-router que preserva o slug do tenant na query. */
export function tenantTo(
  to: string | { pathname?: string; search?: string; hash?: string },
): { pathname: string; search: string; hash?: string } {
  if (typeof to === 'string') {
    const hashIdx = to.indexOf('#')
    const hash = hashIdx >= 0 ? to.slice(hashIdx) : undefined
    const withoutHash = hashIdx >= 0 ? to.slice(0, hashIdx) : to
    const qIdx = withoutHash.indexOf('?')
    const pathname = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash
    const search = qIdx >= 0 ? withoutHash.slice(qIdx) : ''
    return { pathname: pathname || '/', search: withTenantSearch(search), ...(hash ? { hash } : {}) }
  }
  return {
    pathname: to.pathname || '/',
    search: withTenantSearch(to.search),
    ...(to.hash ? { hash: to.hash } : {}),
  }
}

function normalizeLayoutStyle(v: unknown): TenantConfig['layout_style'] {
  return v === 'burgerbite' || v === 'burgerhouse' || v === 'ufersin' ? v : 'ufersin'
}

function mapTenantPayload(slug: string, data: Partial<TenantConfig>): TenantConfig {
  const whatsapp = String(data.whatsapp ?? '').replace(/\D/g, '')
  const fab = data.cart_fab_style === 'cart_icon' ? 'cart_icon' : 'sacola'
  return {
    ...DEFAULT_CONFIG,
    ...data,
    slug,
    // Public tenant-config only returns ativo subscribers — treat as online.
    ativa: true,
    whatsapp,
    endereco: String(data.endereco ?? '').trim(),
    endereco_numero: String(data.endereco_numero ?? '').trim(),
    instagram: String(data.instagram ?? '').trim(),
    facebook: String(data.facebook ?? '').trim(),
    layout_style: normalizeLayoutStyle(data.layout_style),
    vertical: data.vertical === 'eletronicos' ? 'eletronicos' : 'ecommerce',
    vende_mais_18: Boolean(data.vende_mais_18),
    apenas_retirada: Boolean(data.apenas_retirada),
    pagamento_na_retirada: Boolean(data.pagamento_na_retirada),
    entrega_somente_pix: Boolean(data.entrega_somente_pix),
    pagamento_manual: Boolean(data.pagamento_manual),
    logo_url: data.logo_url ? String(data.logo_url) : null,
    landing_headline: data.landing_headline ? String(data.landing_headline) : null,
    landing_sub: data.landing_sub ? String(data.landing_sub) : null,
    landing_badge: data.landing_badge ? String(data.landing_badge) : null,
    landing_highlights: Array.isArray(data.landing_highlights)
      ? (data.landing_highlights as unknown[])
          .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
          .map((h) => ({ title: String(h.title ?? ''), desc: String(h.desc ?? '') }))
      : null,
    landing_hero_image_url: data.landing_hero_image_url ? String(data.landing_hero_image_url) : null,
    cart_fab_style: fab,
    cart_fab_animate: Boolean(data.cart_fab_animate),
  }
}

const TENANT_FETCH_TIMEOUT_MS = 10_000

/** Lê config no schema resolutoo via PostgREST (fonte de verdade do layout_style). */
async function fetchTenantConfigFromSupabase(slug: string): Promise<TenantConfig | null> {
  try {
    const res = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/rpc/get_public_tenant_config`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept-Profile': 'resolutoo',
          'Content-Profile': 'resolutoo',
        },
        body: JSON.stringify({ p_slug: slug }),
      },
      TENANT_FETCH_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as Partial<TenantConfig> | null
    if (!data || typeof data !== 'object' || !('layout_style' in data || data.slug || data.loja_nome)) {
      return null
    }
    return mapTenantPayload(slug, data)
  } catch {
    return null
  }
}

async function fetchTenantConfigFromApi(slug: string): Promise<TenantConfig | null> {
  try {
    const res = await fetchWithTimeout(
      `${RODOLETAS_API_URL}/api/public/tenant-config/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
      TENANT_FETCH_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as Partial<TenantConfig>
    return mapTenantPayload(slug, data)
  } catch {
    return null
  }
}

async function fetchTenantConfig(slug: string): Promise<TenantConfig> {
  if (!slug) return DEFAULT_CONFIG

  // Parallel: Supabase preferred when both succeed (layout_style source of truth).
  // Sequential waterfall was adding cold-start latency on every admin boot.
  const [fromSb, fromApi] = await Promise.all([
    fetchTenantConfigFromSupabase(slug),
    fetchTenantConfigFromApi(slug),
  ])
  if (fromSb) return fromSb
  if (fromApi) return fromApi
  // Slug conhecido sem config ativa = loja offline (cancelado / inadimplente).
  // Não cair no DEFAULT (que liberaria vitrine falsa); vender_externamente=false
  // faz o StyleAware mostrar página indisponível. `ativa: false` derruba o painel.
  if (slug) {
    return { ...DEFAULT_CONFIG, slug, ativa: false, vender_externamente: false, loja_nome: '' }
  }
  return { ...DEFAULT_CONFIG, slug }
}

/** `https://wa.me/{digits}` se WhatsApp estiver habilitado e o número existir;
 *  senão `null` (CTA deve sumir). */
export function tenantWhatsAppHref(config: TenantConfig | null | undefined): string | null {
  if (!config?.whatsapp_habilitado) return null
  const digits = (config.whatsapp || '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return `https://wa.me/${digits}`
}

/** Rua + número do onboarding; `null` se ambos vazios. */
export function tenantFullAddress(config: TenantConfig | null | undefined): string | null {
  const street = (config?.endereco ?? '').trim()
  const num = (config?.endereco_numero ?? '').trim()
  if (!street && !num) return null
  if (street && num) return `${street}, ${num}`
  return street || num
}

export function tenantMapsHref(config: TenantConfig | null | undefined): string | null {
  const addr = tenantFullAddress(config)
  if (!addr) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`
}

export function tenantInstagramHref(config: TenantConfig | null | undefined): string | null {
  const raw = (config?.instagram ?? '').trim().replace(/^@+/, '')
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://www.instagram.com/${encodeURIComponent(raw)}`
}

export function tenantFacebookHref(config: TenantConfig | null | undefined): string | null {
  const raw = (config?.facebook ?? '').trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const handle = raw.replace(/^@+/, '')
  return `https://www.facebook.com/${encodeURIComponent(handle)}`
}

/** Redes preenchidas no tenant — ordem fixa pra UI de compartilhar. */
export function tenantShareLinks(config: TenantConfig | null | undefined): ShareLink[] {
  const links: ShareLink[] = []
  const wa = tenantWhatsAppHref(config)
  if (wa) links.push({ network: 'whatsapp', href: wa, label: 'WhatsApp' })
  const ig = tenantInstagramHref(config)
  if (ig) links.push({ network: 'instagram', href: ig, label: 'Instagram' })
  const fb = tenantFacebookHref(config)
  if (fb) links.push({ network: 'facebook', href: fb, label: 'Facebook' })
  return links
}

/** Busca (e cacheia em memória por pouco tempo) a config real do tenant. */
export function getTenantConfig(opts?: { force?: boolean }): Promise<TenantConfig> {
  const slug = resolveTenantSlug()
  const now = Date.now()

  // Sempre compartilha in-flight do mesmo slug (evita stampede entre hooks).
  if (inFlight && cachedForSlug === slug) return inFlight

  if (
    !opts?.force &&
    cached &&
    cachedForSlug === slug &&
    now - cachedAt < CACHE_TTL_MS
  ) {
    return Promise.resolve(cached)
  }

  const requestedSlug = slug
  cachedForSlug = slug
  inFlight = fetchTenantConfig(slug).then((c) => {
    if (cachedForSlug === requestedSlug) {
      cached = c
      cachedAt = Date.now()
      inFlight = null
    }
    return c
  })
  return inFlight
}

/** Invalida cache (ex.: depois de trocar de tenant no login, ou ao focar a aba). */
export function resetTenantConfigCache() {
  cached = null
  inFlight = null
  cachedForSlug = null
  cachedAt = 0
}

/** Versão síncrona pra quem já garantiu que getTenantConfig() rodou. */
export function getCachedTenantConfig(): TenantConfig {
  return cached ?? DEFAULT_CONFIG
}

/** Cache real (null se ainda não buscou) — evita flash de DEFAULT no admin. */
export function peekCachedTenantConfig(): TenantConfig | null {
  return cached
}
