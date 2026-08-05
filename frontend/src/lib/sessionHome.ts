import { api, ApiError, type BillingCycle, type PlanoCode } from './api'
import { authStore } from './authStore'
import { isKnownPlatformAdminEmail } from './platformAdmin'
import { postPayDestination } from './postPayRedirect'

/**
 * Destino pós-login / pós-auth — respeita as duas identidades do Auth:
 * - superadmin (`platform_admins`) → `/dashboard` (nunca plano/onboarding)
 * - lojista (`subscribers`) → `/meu-plano` se provisionado; `/onboarding` se incompleto;
 *   ou `/assinar` se veio com ?plano=
 * - Auth sem subscriber → `/completar-conta`
 *
 * Ordem obrigatória: whoami/superadmin ANTES de qualquer fluxo de loja.
 * Fallback: e-mails em KNOWN_PLATFORM_ADMIN_EMAILS → `/dashboard` mesmo se
 * a rota whoami ainda não existir na API (deploy atrasado).
 */
export async function resolveSessionHome(opts?: {
  plano?: PlanoCode | null
  ciclo?: BillingCycle
  email?: string | null
}): Promise<string> {
  const email =
    opts?.email ??
    authStore.getSuperadminSession()?.user?.email ??
    authStore.getLojistaSession()?.user?.email ??
    null

  if (isKnownPlatformAdminEmail(email)) {
    return '/dashboard'
  }

  // Slot superadmin já preenchido → painel da plataforma.
  if (authStore.getTokenForRole('superadmin')) {
    try {
      await api.superadminWhoami()
      return '/dashboard'
    } catch {
      /* token stale — tenta fluxo lojista abaixo */
    }
  }

  try {
    await api.superadminWhoami()
    return '/dashboard'
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      // autenticado mas não é platform admin — segue lojista
    } else if (e instanceof ApiError && e.status === 401) {
      // token ausente/inválido
    }
  }

  if (opts?.plano) {
    const ciclo = opts.ciclo === 'semestral' ? 'semestral' : 'mensal'
    return `/assinar?plano=${opts.plano}&ciclo=${ciclo}`
  }

  try {
    const me = await api.me()
    // Incomplete onboarding → /onboarding lock; provisioned → /meu-plano.
    return postPayDestination(me.onboarding_status, me)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return '/completar-conta'
    }
    throw e
  }
}
