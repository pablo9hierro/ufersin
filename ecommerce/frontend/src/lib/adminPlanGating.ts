import { planoAtLeast, type PlanoCode } from './demoMode'

/** Mirrors AdminLayout nav gating — which screens each plan unlocks. */
export const ADMIN_NAV_PLAN: Record<string, PlanoCode> = {
  '/admin/pedidos': 'essential',
  '/admin/pdv': 'essential',
  '/admin/produtos': 'essential',
  '/admin/motoboys': 'management',
  '/admin/crm': 'premium',
  '/admin/promocoes': 'management',
  '/admin/layout-cliente': 'essential',
  '/admin/relatorios': 'essential',
  '/admin/conta': 'essential',
}

export function canAccessAdminRoute(
  href: string,
  plano: PlanoCode | null | undefined,
  opts?: { pedidosLiberado?: boolean; onboardingHoursDone?: boolean }
): boolean {
  const required = ADMIN_NAV_PLAN[href]
  if (!required) return true
  if (!planoAtLeast(plano ?? 'essential', required)) return false
  if (href === '/admin/pedidos' && opts?.pedidosLiberado === false) return false
  return true
}

/** Etapa 2 store gate: hours must be saved before full admin (except conta/pdv essentials). */
export function onboardingBlocksRoute(href: string, hoursDone: boolean): boolean {
  if (hoursDone) return false
  // Conta (horários/WhatsApp) stays reachable so the lojista can finish onboarding.
  if (href === '/admin/conta') return false
  return true
}
