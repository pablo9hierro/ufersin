import { api, ApiError, type BillingCycle, type PlanoCode } from './api'

/**
 * Destino pós-login / pós-auth — respeita as duas identidades do Auth:
 * - superadmin (`platform_admins`) → `/dashboard` (nunca plano/onboarding)
 * - lojista (`subscribers`) → `/meu-plano` (ou `/assinar` se veio com ?plano=)
 * - Auth sem subscriber → `/completar-conta`
 */
export async function resolveSessionHome(opts?: {
  plano?: PlanoCode | null
  ciclo?: BillingCycle
}): Promise<string> {
  try {
    await api.superadminWhoami()
    return '/dashboard'
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 401 && e.status !== 403)) {
      // rede/5xx: tenta fluxo lojista abaixo
    }
  }

  if (opts?.plano) {
    const ciclo = opts.ciclo === 'semestral' ? 'semestral' : 'mensal'
    return `/assinar?plano=${opts.plano}&ciclo=${ciclo}`
  }

  try {
    await api.me()
    return '/meu-plano'
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return '/completar-conta'
    }
    throw e
  }
}
