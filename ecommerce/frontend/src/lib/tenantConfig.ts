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
}

const RODOLETAS_API_URL = import.meta.env.VITE_RODOLETAS_API_URL || 'http://localhost:8081'
const ENV_TENANT_SLUG = (import.meta.env.VITE_TENANT_SLUG as string | undefined)?.trim() || ''

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

async function fetchTenantConfig(slug: string): Promise<TenantConfig> {
  if (!slug) return DEFAULT_CONFIG
  try {
    const res = await fetch(
      `${RODOLETAS_API_URL}/api/public/tenant-config/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { ...DEFAULT_CONFIG, slug }
    const data = (await res.json()) as Partial<TenantConfig>
    const whatsapp = String(data.whatsapp ?? '').replace(/\D/g, '')
    return {
      ...DEFAULT_CONFIG,
      ...data,
      slug,
      whatsapp,
      layout_style: normalizeLayoutStyle(data.layout_style),
    }
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
