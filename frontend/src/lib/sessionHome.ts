import { api, ApiError, type BillingCycle, type PlanoCode } from './api'

/**
 * Destino pós-login / pós-auth — respeita as duas identidades do Auth:
 * - superadmin (`platform_admins`) → `/dashboard` (nunca plano/onboarding)
 * - lojista (`subscribers`) → `/meu-plano` (ou `/assinar` se veio com ?plano=)
 * - Auth sem subscriber → `/completar-conta`
 *
 * Ordem obrigatória: whoami/superadmin ANTES de qualquer fluxo de loja.
 */
export async function resolveSessionHome(opts?: {
  plano?: PlanoCode | null
  ciclo?: BillingCycle
}): Promise<string> {
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
