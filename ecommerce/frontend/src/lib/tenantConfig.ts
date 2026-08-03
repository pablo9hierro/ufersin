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
export interface TenantConfig {
  slug: string
  loja_nome: string
  plano: 'essential' | 'management' | 'premium'
  vender_externamente: boolean
  whatsapp_habilitado: boolean
  /** Dígitos do WhatsApp da loja (onboarding / Meu plano) pra `wa.me`. */
  whatsapp: string
  forma_pagamento: 'manual' | 'plataforma'
  plataforma_pagamento: 'mercado_pago' | 'abacate_pay' | null
  layout_style: 'ufersin' | 'burgerbite' | 'burgerhouse'
  cor_principal: string | null
  /** Checkout exige consentimento 18+ além da compra normal. */
  vende_mais_18: boolean
  endereco: string
  endereco_numero: string
  instagram: string
  facebook: string
  logo_url: string | null
  landing_headline: string | null
  landing_sub: string | null
  landing_badge: string | null
  cart_fab_style: 'sacola' | 'cart_icon'
  cart_fab_animate: boolean
}

export type ShareNetwork = 'whatsapp' | 'instagram' | 'facebook'

export interface ShareLink {
  network: ShareNetwork
  href: string
  label: string
}

/** True when the store has payment-platform credentials (online Pix). */
export function tenantHasOnlinePix(config: TenantConfig | null | undefined): boolean {
  return config?.forma_pagamento === 'plataforma'
}

/** Fail-closed: essential + sem pedidos externos até a config real chegar
 *  (evita flash de menu completo → sumir, que parece "bug de tela verde"). */
const DEFAULT_CONFIG: TenantConfig = {
  slug: '',
  loja_nome: '',
  plano: 'essential',
  vender_externamente: true,
  whatsapp_habilitado: false,
  whatsapp: '',
  forma_pagamento: 'manual',
  plataforma_pagamento: null,
  layout_style: 'ufersin',
  cor_principal: null,
  vende_mais_18: false,
  endereco: '',
  endereco_numero: '',
  instagram: '',
  facebook: '',
  logo_url: null,
  landing_headline: null,
  landing_sub: null,
  landing_badge: null,
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

const SLUG_STORAGE_KEY = 'resolutoo_tenant_slug'

/** Cache curto: Meu plano pode ter alterado layout_style em outra aba. */
const CACHE_TTL_MS = 15_000

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

/** Remove slug persistido (entrada na demo pública / logout limpo). */
export function clearTenantSlug() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SLUG_STORAGE_KEY)
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
    whatsapp,
    endereco: String(data.endereco ?? '').trim(),
    endereco_numero: String(data.endereco_numero ?? '').trim(),
    instagram: String(data.instagram ?? '').trim(),
    facebook: String(data.facebook ?? '').trim(),
    layout_style: normalizeLayoutStyle(data.layout_style),
    vende_mais_18: Boolean(data.vende_mais_18),
    logo_url: data.logo_url ? String(data.logo_url) : null,
    landing_headline: data.landing_headline ? String(data.landing_headline) : null,
    landing_sub: data.landing_sub ? String(data.landing_sub) : null,
    landing_badge: data.landing_badge ? String(data.landing_badge) : null,
    cart_fab_style: fab,
    cart_fab_animate: Boolean(data.cart_fab_animate),
  }
}

/** Lê config no schema resolutoo via PostgREST (fonte de verdade do layout_style). */
async function fetchTenantConfigFromSupabase(slug: string): Promise<TenantConfig | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_tenant_config`, {
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
    })
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

async function fetchTenantConfig(slug: string): Promise<TenantConfig> {
  if (!slug) return DEFAULT_CONFIG

  // Preferir Supabase (resolutoo.subscribers): o Railway ufersin-api em produção
  // ficou semanas sem redeploy e omitia layout_style do JSON público.
  const fromSb = await fetchTenantConfigFromSupabase(slug)
  if (fromSb) return fromSb

  try {
    const res = await fetch(
      `${RODOLETAS_API_URL}/api/public/tenant-config/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { ...DEFAULT_CONFIG, slug }
    const data = (await res.json()) as Partial<TenantConfig>
    return mapTenantPayload(slug, data)
  } catch {
    return { ...DEFAULT_CONFIG, slug }
  }
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
