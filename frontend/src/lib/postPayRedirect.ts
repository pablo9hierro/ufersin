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

/**
 * Absolute redirect rule after (re)subscribe payment success:
 * - Existing loja (same-plan or returning) → `/meu-plano` (never blank onboarding)
 * - `/onboarding` ONLY for first-time store OR upgrade complementary
 *   (BE sets onboarding_status = aguardando_onboarding only in those cases)
 */
export function postPayDestination(onboardingStatus: string, me: MeResponse | null): '/meu-plano' | '/onboarding' {
  if (me) {
    const exists = storeAlreadyExists(me)
    if (me.onboarding_status === 'provisionado' || (exists && me.onboarding_status !== 'aguardando_onboarding')) {
      return '/meu-plano'
    }
    // Upgrade complementary: store exists + BE asked for onboarding.
    if (exists && me.onboarding_status === 'aguardando_onboarding') {
      return '/onboarding'
    }
    // First-time: no store yet.
    if (!exists && (onboardingStatus === 'aguardando_onboarding' || me.onboarding_status === 'aguardando_onboarding')) {
      return '/onboarding'
    }
    return '/meu-plano'
  }
  // No /me — trust payment status only; prefer meu-plano when unsure.
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
