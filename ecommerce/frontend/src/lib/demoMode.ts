import { getCachedTenantConfig, resolveTenantSlug, resetTenantConfigCache } from './tenantConfig'

export type PlanoCode = 'essential' | 'management' | 'premium'

export type DemoStaffRole = 'admin' | 'motoboy' | 'vendedor'

export interface DemoStaffSession {
  role: DemoStaffRole
  token: string
  name: string
}

// Modo demo da plataforma Rodoletas: uma aba inteira passa a rodar 100%
// em cima do modo demonstração já existente (localApi.ts/localData.ts —
// o mesmo usado quando o site sobe sem VITE_SUPABASE_URL configurada),
// sem precisar de nenhum backend rodando. Ativado por /demo-entrar (ver
// pages/DemoEntrar.tsx), guardado em sessionStorage — só essa aba, só até
// fechar; nunca vaza pra uma aba normal usando o backend de verdade.
const ACTIVE_KEY = 'rodoletas_demo_active'
const PLANO_KEY = 'rodoletas_demo_plano'
/** Sessão staff da demo — sessionStorage only (nunca localStorage / zustand persist). */
const STAFF_KEY = 'rodoletas_demo_staff'

export function activateDemoMode(plano: PlanoCode) {
  sessionStorage.setItem(ACTIVE_KEY, 'true')
  sessionStorage.setItem(PLANO_KEY, plano)
  // NÃO limpa resolutoo_loja_tenant_slug em localStorage: a demo iframe (/loja)
  // compartilha origem com o admin real — wipe global derrubava lojistas
  // e deixava /admin/login com Entrar disabled (!tenantSlug).
  // resolveTenantSlug() já ignora slug persistido enquanto a flag de demo
  // estiver ativa nesta aba.
  resetTenantConfigCache()
}

export function isDemoModeActive(): boolean {
  if (typeof window === 'undefined') return false
  if (sessionStorage.getItem(ACTIVE_KEY) !== 'true') return false
  // Só ?tenant= explícito na URL cancela o modo demo (vitrine real).
  // Slug persistido em localStorage NÃO cancela — era o bug de produção.
  try {
    const q = new URLSearchParams(window.location.search).get('tenant')?.trim()
    if (q) return false
  } catch {
    /* ignore */
  }
  return true
}

/**
 * Autenticação staff da demo pública — só sessionStorage desta aba.
 * Nunca chama useAdminAuth/useMotoboyAuth/useVendedorAuth (localStorage
 * compartilhado com a loja real / iframe same-origin).
 */
export function setDemoStaffSession(session: DemoStaffSession) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(STAFF_KEY, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

export function clearDemoStaffSession() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(STAFF_KEY)
  } catch {
    /* ignore */
  }
}

export function getDemoStaffSession(): DemoStaffSession | null {
  if (!isDemoModeActive()) return null
  try {
    const raw = sessionStorage.getItem(STAFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DemoStaffSession>
    if (
      (parsed.role === 'admin' || parsed.role === 'motoboy' || parsed.role === 'vendedor') &&
      typeof parsed.token === 'string' &&
      parsed.token &&
      typeof parsed.name === 'string'
    ) {
      return { role: parsed.role, token: parsed.token, name: parsed.name }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function getDemoPlano(): PlanoCode | null {
  const p = typeof window !== 'undefined' ? sessionStorage.getItem(PLANO_KEY) : null
  return p === 'essential' || p === 'management' || p === 'premium' ? p : null
}

/** Ordem crescente de plano — usada pra "este plano já libera aquele recurso?". */
const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']

/** `atual` inclui o recurso exigido por `required`? */
export function planoAtLeast(atual: PlanoCode | null | undefined, required: PlanoCode): boolean {
  if (!atual) return false
  return PLAN_ORDER.indexOf(required) <= PLAN_ORDER.indexOf(atual)
}

/** Demo: usa plano da sessionStorage. Fora dela, não restringe (use planoAtLeast + tenantConfig). */
export function planoIncludes(recurso: PlanoCode): boolean {
  const atual = getDemoPlano()
  if (!atual) return true
  return planoAtLeast(atual, recurso)
}

/** Plano efetivo da vitrine: demo session OU tenantConfig.plano. */
export function storefrontPlano(tenantPlano?: PlanoCode | null): PlanoCode {
  if (isDemoModeActive()) return getDemoPlano() ?? 'essential'
  return tenantPlano === 'management' || tenantPlano === 'premium' || tenantPlano === 'essential'
    ? tenantPlano
    : 'essential'
}

/** Management/Premium: carrossel de banners de promoção. Essential: não. */
export function hasPromoBanners(tenantPlano?: PlanoCode | null): boolean {
  return planoAtLeast(storefrontPlano(tenantPlano), 'management')
}

/** Essential: card de imagem do hero (landing_hero_image_url), sem promo admin. */
export function isEssentialStorefront(tenantPlano?: PlanoCode | null): boolean {
  return storefrontPlano(tenantPlano) === 'essential'
}

/** Cupons (checkout + /cliente/cupons): Management/Premium. Essential não gera cupons. */
export function storefrontAllowsCoupons(tenantPlano?: PlanoCode | null): boolean {
  return !isEssentialStorefront(tenantPlano)
}

/**
 * Nome da marca na vitrine/admin.
 * - Demo pública → Ufersin
 * - Assinante Resolutoo → loja_nome do onboarding
 * - Sem nome ainda → slug ou "Minha loja" (nunca um nome de loja de terceiros)
 */
export function brandName(lojaNome?: string | null): string {
  if (isDemoModeActive()) return 'Ufersin'
  const arg = lojaNome?.trim()
  if (arg) return arg
  const cached = getCachedTenantConfig()
  if (cached.loja_nome?.trim()) return cached.loja_nome.trim()
  const slug = cached.slug?.trim() || resolveTenantSlug()
  if (slug) return slug
  return 'Minha loja'
}
