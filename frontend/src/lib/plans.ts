import { api, type PlatformPlan, type PlanoCode } from './api'
import type { BillingCycle } from './api'

export interface PlanInfo {
  code: PlanoCode
  name: string
  price: number
  tagline: string
  features: string[]
  highlight?: boolean
}

/** Desconto aplicado no total do semestre (6 × mensal). */
export const SEMESTRAL_DISCOUNT = 0.05

/** Offline / fallback quando a API de planos não responde. */
export const FALLBACK_PLANS: PlanInfo[] = [
  {
    code: 'essential',
    name: 'Essential',
    price: 60,
    tagline: 'Pra começar a vender online',
    features: ['Catálogo', 'Checkout', 'Pix', 'WhatsApp', 'Pedidos'],
  },
  {
    code: 'management',
    name: 'Management',
    price: 250,
    tagline: 'Pra quem já tem equipe e entrega',
    features: ['Tudo do Essential', 'Funcionários', 'Motoboy', 'Banner promocional', 'Comissões'],
    highlight: true,
  },
  {
    code: 'premium',
    name: 'Premium',
    price: 350,
    tagline: 'Pra escalar com CRM e campanhas',
    features: ['Tudo do Management', 'CRM completo', 'Segmentações', 'Automações', 'Cupons', 'Campanhas', 'Relatórios'],
  },
]

/** @deprecated prefer `getPlans()` após `fetchPlans()` */
export const PLANS = FALLBACK_PLANS

export const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
export const PLAN_NAMES: Record<PlanoCode, string> = {
  essential: 'Essential',
  management: 'Management',
  premium: 'Premium',
}

let loadedPlans: PlanInfo[] | null = null
/** True after a successful `/api/public/plans` response (even if empty / subset). */
let publicFetchOk = false

function rowToPlanInfo(row: PlatformPlan): PlanInfo {
  const features = Array.isArray(row.features) ? row.features.map(String) : []
  return {
    code: row.code,
    name: row.name,
    price: row.price_monthly,
    tagline: row.tagline,
    features,
    highlight: row.highlight,
  }
}

/** Limpa cache em memória (após superadmin editar preços / ativo). */
export function invalidatePlansCache() {
  loadedPlans = null
  publicFetchOk = false
}

/** Carrega planos ativos da API; em falha de rede usa FALLBACK. */
export async function fetchPlans(): Promise<PlanInfo[]> {
  try {
    const rows = await api.listPublicPlans()
    // Public API already returns active-only; filter defensively.
    const active = rows
      .filter((r) => r.active !== false)
      .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    publicFetchOk = true
    loadedPlans = active.map(rowToPlanInfo)
    return loadedPlans
  } catch {
    /* offline — usa fallback */
    publicFetchOk = false
    loadedPlans = null
  }
  return FALLBACK_PLANS
}

/** Planos oferecidos a novos assinantes (ativos). Sem padding de inativos. */
export function getPlans(): PlanInfo[] {
  if (publicFetchOk) return loadedPlans ?? []
  return loadedPlans ?? FALLBACK_PLANS
}

/**
 * Mapa code → plano ativo. Não reintroduz FALLBACK para códigos ausentes
 * (planos inativos somem do mapa após fetch bem-sucedido).
 */
export function getPlanMap(): Partial<Record<PlanoCode, PlanInfo>> {
  return Object.fromEntries(getPlans().map((p) => [p.code, p])) as Partial<Record<PlanoCode, PlanInfo>>
}

/** Nome amigável mesmo se o plano estiver inativo / fora da lista pública. */
export function planDisplayName(code: string): string {
  const fromActive = getPlans().find((p) => p.code === code)
  if (fromActive) return fromActive.name
  const fb = FALLBACK_PLANS.find((p) => p.code === code)
  if (fb) return fb.name
  return PLAN_NAMES[code as PlanoCode] ?? code
}

/** @deprecated prefer `getPlanMap()` */
export const PLAN_MAP: Record<PlanoCode, PlanInfo> = Object.fromEntries(FALLBACK_PLANS.map((p) => [p.code, p])) as Record<
  PlanoCode,
  PlanInfo
>

/** Valor cobrado no ciclo escolhido. Semestral = 6 meses com 5% off. */
export function priceForCycle(monthly: number, cycle: BillingCycle): number {
  if (cycle === 'semestral') {
    return Math.round(monthly * 6 * (1 - SEMESTRAL_DISCOUNT) * 100) / 100
  }
  return monthly
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
}
