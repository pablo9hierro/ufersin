import type { PlanoCode } from './api'

export interface PlanInfo {
  code: PlanoCode
  name: string
  price: number
  tagline: string
  features: string[]
  highlight?: boolean
}

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

export const PLAN_MAP: Record<PlanoCode, PlanInfo> = Object.fromEntries(PLANS.map((p) => [p.code, p])) as Record<PlanoCode, PlanInfo>
