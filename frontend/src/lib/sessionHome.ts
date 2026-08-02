import { api, ApiError, type BillingCycle, type PlanoCode } from './api'
import { authStore } from './authStore'
import { isKnownPlatformAdminEmail } from './platformAdmin'

/**
 * Destino pós-login / pós-auth — respeita as duas identidades do Auth:
 * - superadmin (`platform_admins`) → `/dashboard` (nunca plano/onboarding)
 * - lojista (`subscribers`) → `/meu-plano` (ou `/assinar` se veio com ?plano=)
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
  const email = opts?.email ?? authStore.getSession()?.user?.email ?? null
  if (isKnownPlatformAdminEmail(email)) {
    return '/dashboard'
  }

  try {
    await api.superadminWhoami()
    return '/dashboard'
  } catch (e) {
    // Só 403 = autenticado mas não é platform admin. Qualquer outro erro
    // (401/rede/5xx/404 de API antiga) não deve empurrar superadmin pro
    // onboarding de lojista — mas 403 é o sinal limpo de "é lojista".
    if (e instanceof ApiError && e.status === 403) {
      // segue fluxo lojista
    } else if (e instanceof ApiError && e.status === 401) {
      // token ausente/inválido — tenta lojista (me também falhará)
    } else {
      // rede/5xx/404: ainda tenta lojista; CompletarConta/MeuPlano
      // revalidam whoami e bounceiam admin se a API voltar.
      // Known-admin já foi tratado acima.
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
