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
  return typeof window !== 'undefined' && sessionStorage.getItem(ACTIVE_KEY) === 'true'
}

export function getDemoPlano(): PlanoCode | null {
  const p = typeof window !== 'undefined' ? sessionStorage.getItem(PLANO_KEY) : null
  return p === 'essential' || p === 'management' || p === 'premium' ? p : null
}

/** Ordem crescente de plano — usada pra "este plano já libera aquele recurso?". */
const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']

export function planoIncludes(recurso: PlanoCode): boolean {
  const atual = getDemoPlano()
  if (!atual) return true // fora do modo demo, nunca restringe nada
  return PLAN_ORDER.indexOf(recurso) <= PLAN_ORDER.indexOf(atual)
}

// Nome de marca mostrado nas páginas do site-localhost-demo — em modo
// demonstração vira "Ufersin" (ramo lanchonete simulado), fora dele
// continua "Sunset Tabas" (a loja de verdade, nunca mexida).
export function brandName(): string {
  return isDemoModeActive() ? 'Ufersin' : 'Sunset Tabas'
}
