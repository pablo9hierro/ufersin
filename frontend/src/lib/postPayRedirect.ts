import type { MeResponse } from './api'
import { api } from './api'

/** True when this account already has a registered loja (re-subscribe / returning). */
export function storeAlreadyExists(me: MeResponse): boolean {
  return Boolean(
    me.tenant_id ||
      me.slug ||
      me.onboarding_status === 'provisionado' ||
      (me.documento && String(me.documento).trim()),
  )
}

export function isPaidActive(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase()
  return s === 'ativo' || s === 'active' || s === 'authorized'
}

/**
 * Hard lock: lojista must stay on `/onboarding` until the store is provisioned.
 * - First-time after pay (`aguardando_onboarding`, no store)
 * - Complementary upgrade (`aguardando_onboarding` + existing store)
 * - Safety: paid active without tenant/slug (half-state)
 *
 * Provisioned / returning re-subscribe → NOT locked (hub is `/meu-plano`).
 */
export function needsOnboardingLock(me: MeResponse): boolean {
  if (me.onboarding_status === 'aguardando_onboarding') return true
  if (me.onboarding_status === 'provisionado') return false
  const hasSlug = Boolean(me.slug?.trim())
  const hasTenant = Boolean(me.tenant_id)
  if (isPaidActive(me.status) && !hasSlug && !hasTenant) return true
  return false
}

/**
 * Absolute redirect after pay / post-login:
 * - Onboarding incomplete → `/onboarding` (locked until provisionado)
 * - Existing provisioned loja → `/meu-plano`
 */
export function postPayDestination(onboardingStatus: string, me: MeResponse | null): '/meu-plano' | '/onboarding' {
  if (me) {
    if (needsOnboardingLock(me)) return '/onboarding'
    return '/meu-plano'
  }
  return onboardingStatus === 'aguardando_onboarding' ? '/onboarding' : '/meu-plano'
}

/** Resolve destination using live /api/me when possible. */
export async function resolvePostPayDestination(onboardingStatus: string): Promise<'/meu-plano' | '/onboarding'> {
  try {
    const me = await api.me()
    return postPayDestination(onboardingStatus, me)
  } catch {
    return postPayDestination(onboardingStatus, null)
  }
}
