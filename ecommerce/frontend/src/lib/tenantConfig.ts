// Config real do onboarding do lojista (plataforma Resolutoo/ufersin) --
// diferente de demoMode.ts (que só simula plano na demo pública). Busca
// uma vez, em memória, no backend ufersin (ver
// ufersin/backend/src/routes/onboarding.rs::tenant_config) -- endpoint
// PÚBLICO, só devolve as flags, nunca credenciais de pagamento.
//
// Slug resolvido nesta ordem:
// 1. session/localStorage do login admin (`?tenant=` do dashboard)
// 2. VITE_TENANT_SLUG (deploy single-tenant legado)
// 3. query `?tenant=` na URL atual
//
// Sem slug, ou se a busca falhar, cai em essential restritivo (não
// premium liberado) pra não mostrar CRM/Promoções pra loja real.
export interface TenantConfig {
  slug: string
  loja_nome: string
  plano: 'essential' | 'management' | 'premium'
  vender_externamente: boolean
  whatsapp_habilitado: boolean
  forma_pagamento: 'manual' | 'plataforma'
  plataforma_pagamento: 'mercado_pago' | 'abacate_pay' | null
}

/** Fail-closed: essential + sem pedidos externos até a config real chegar
 *  (evita flash de menu completo → sumir, que parece "bug de tela verde"). */
const DEFAULT_CONFIG: TenantConfig = {
  slug: '',
  loja_nome: '',
  plano: 'essential',
  vender_externamente: true,
  whatsapp_habilitado: true,
  forma_pagamento: 'manual',
  plataforma_pagamento: null,
}

const RODOLETAS_API_URL = import.meta.env.VITE_RODOLETAS_API_URL || 'http://localhost:8081'
const ENV_TENANT_SLUG = (import.meta.env.VITE_TENANT_SLUG as string | undefined)?.trim() || ''

const SLUG_STORAGE_KEY = 'resolutoo_tenant_slug'

let cached: TenantConfig | null = null
let inFlight: Promise<TenantConfig> | null = null
let cachedForSlug: string | null = null

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

async function fetchTenantConfig(slug: string): Promise<TenantConfig> {
  if (!slug) return DEFAULT_CONFIG
  try {
    const res = await fetch(`${RODOLETAS_API_URL}/api/public/tenant-config/${encodeURIComponent(slug)}`)
    if (!res.ok) return { ...DEFAULT_CONFIG, slug }
    const data = await res.json()
    return { ...DEFAULT_CONFIG, ...data, slug }
  } catch {
    return { ...DEFAULT_CONFIG, slug }
  }
}

/** Busca (e cacheia em memória, só pra essa aba) a config real do tenant. */
export function getTenantConfig(): Promise<TenantConfig> {
  const slug = resolveTenantSlug()
  if (cached && cachedForSlug === slug) return Promise.resolve(cached)
  if (inFlight && cachedForSlug === slug) return inFlight
  cachedForSlug = slug
  inFlight = fetchTenantConfig(slug).then((c) => {
    cached = c
    return c
  })
  return inFlight
}

/** Invalida cache (ex.: depois de trocar de tenant no login). */
export function resetTenantConfigCache() {
  cached = null
  inFlight = null
  cachedForSlug = null
}

/** Versão síncrona pra quem já garantiu que getTenantConfig() rodou. */
export function getCachedTenantConfig(): TenantConfig {
  return cached ?? DEFAULT_CONFIG
}
