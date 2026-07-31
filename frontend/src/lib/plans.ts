import type { BillingCycle, PlanoCode } from './api'

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

// Fonte única dos 3 planos — usada pela Pricing da Landing e por /planos
// (escolha pós-login). Mesmos planos/preços do motor de e-commerce
// (ecommerce/backend/migrations/0005_tenancy.sql).
export const PLANS: PlanInfo[] = [
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

export const PLAN_MAP: Record<PlanoCode, PlanInfo> = Object.fromEntries(PLANS.map((p) => [p.code, p])) as Record<
  PlanoCode,
  PlanInfo
>

export const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
export const PLAN_NAMES: Record<PlanoCode, string> = {
  essential: 'Essential',
  management: 'Management',
  premium: 'Premium',
}

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
