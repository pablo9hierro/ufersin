import { clearTenantSlug, getCachedTenantConfig, resolveTenantSlug, resetTenantConfigCache } from './tenantConfig'

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
  // Slug de loja real em localStorage (visita anterior a /loja/?tenant=…)
  // NÃO pode sequestrar a demo — senão isDemoModeActive falhava, o token
  // mock batia na API real → 401 → /admin/login com autofill do superadmin.
  clearTenantSlug()
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
