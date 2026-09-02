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

  // `?plano=` só pode mandar pra /assinar DEPOIS de confirmar que a conta
  // tem subscriber -- achado real: pular esse check deixava uma conta
  // "fantasma" (Auth existe, subscriber não) cair em /assinar, aplicar
  // cupom normalmente (preview não depende de subscriber) e só travar com
  // erro genérico ao tentar assinar de verdade, sem caminho de volta.
  try {
    const me = await api.me()
    if (opts?.plano) {
      const ciclo = opts.ciclo === 'semestral' ? 'semestral' : 'mensal'
      return `/assinar?plano=${opts.plano}&ciclo=${ciclo}`
    }
    // Incomplete onboarding → /onboarding lock; provisioned → /meu-plano.
    return postPayDestination(me.onboarding_status, me)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return '/completar-conta'
    }
    throw e
  }
}
