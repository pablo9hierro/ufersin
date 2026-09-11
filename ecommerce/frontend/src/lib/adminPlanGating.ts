import { planoAtLeast, type PlanoCode } from './demoMode'

/** Mirrors AdminLayout nav gating — which screens each plan unlocks.
 * Starter é o novo piso (abaixo de Essential): as telas operacionais
 * básicas (pedidos/PDV/produtos/frete/conta) valem pra loja funcionar em
 * qualquer plano pago, então passam a exigir 'starter' em vez de
 * 'essential' -- só WhatsApp automático (feature real, no backend) fica
 * de fora do Starter, nunca uma tela inteira do admin. */
export const ADMIN_NAV_PLAN: Record<string, PlanoCode> = {
  '/admin/pedidos': 'starter',
  '/admin/pdv': 'starter',
  '/admin/produtos': 'starter',
  '/admin/produtos/xml': 'starter',
  '/admin/frete': 'starter',
  '/admin/motoboys': 'management',
  '/admin/crm': 'premium',
  '/admin/promocoes': 'management',
  '/admin/layout-cliente': 'starter',
  '/admin/relatorios': 'starter',
  '/admin/conta': 'starter',
}

/** Routes shown only below this plan (e.g. Frete on Essential; Funcionários owns frete from Management). */
export const ADMIN_NAV_HIDE_AT: Record<string, PlanoCode> = {
  '/admin/frete': 'management',
}

export function canAccessAdminRoute(
  href: string,
  plano: PlanoCode | null | undefined,
  opts?: { pedidosLiberado?: boolean; onboardingHoursDone?: boolean }
): boolean {
  const required = ADMIN_NAV_PLAN[href]
  if (!required) return true
  if (!planoAtLeast(plano ?? 'essential', required)) return false
  const hideAt = ADMIN_NAV_HIDE_AT[href]
  if (hideAt && planoAtLeast(plano ?? 'essential', hideAt)) return false
  if (href === '/admin/pedidos' || href === '/admin/frete') {
    if (opts?.pedidosLiberado === false) return false
  }
  return true
}

/** Etapa 2 store gate: hours must be saved before full admin (except conta/pdv essentials). */
export function onboardingBlocksRoute(href: string, hoursDone: boolean): boolean {
  if (hoursDone) return false
  // Conta (horários/WhatsApp) stays reachable so the lojista can finish onboarding.
  if (href === '/admin/conta') return false
  return true
}
