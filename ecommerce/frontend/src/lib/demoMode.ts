import { getCachedTenantConfig, resolveTenantSlug } from './tenantConfig'

export type PlanoCode = 'essential' | 'management' | 'premium'

// Modo demo da plataforma Rodoletas: uma aba inteira passa a rodar 100%
// em cima do modo demonstração já existente (localApi.ts/localData.ts —
// o mesmo usado quando o site sobe sem VITE_SUPABASE_URL configurada),
// sem precisar de nenhum backend rodando. Ativado por /demo-entrar (ver
// pages/DemoEntrar.tsx), guardado em sessionStorage — só essa aba, só até
// fechar; nunca vaza pra uma aba normal usando o backend de verdade.
const ACTIVE_KEY = 'rodoletas_demo_active'
const PLANO_KEY = 'rodoletas_demo_plano'

export function activateDemoMode(plano: PlanoCode) {
  sessionStorage.setItem(ACTIVE_KEY, 'true')
  sessionStorage.setItem(PLANO_KEY, plano)
}

export function isDemoModeActive(): boolean {
  if (typeof window === 'undefined') return false
  // Vitrine real (?tenant= / slug persistido) nunca fica em modo demo —
  // senão o zustand rodoletas_demo_layout_style sobrescreve layout_style do Meu plano.
  if (resolveTenantSlug()) return false
  return sessionStorage.getItem(ACTIVE_KEY) === 'true'
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
