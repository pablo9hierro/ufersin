import { api, type PlanoCode } from './api'
import { PENDING_SIGNUP_KEY } from './pendingSignup'
import { resolveSessionHome } from './sessionHome'

export interface PendingSignup {
  loja_nome: string
  responsavel_nome: string
  whatsapp: string
  senha: string
  plano: string | null
  ciclo?: string | null
}

/** Lê e limpa o pending do localStorage (se existir). */
export function consumePendingSignup(): PendingSignup | null {
  const raw = localStorage.getItem(PENDING_SIGNUP_KEY)
  if (!raw) return null
  localStorage.removeItem(PENDING_SIGNUP_KEY)
  try {
    return JSON.parse(raw) as PendingSignup
  } catch {
    return null
  }
}

/** Depois que o e-mail foi confirmado (sessão existe): faz bootstrap se
 * ainda houver pending, e devolve pra onde navegar. */
export async function finishSignupAfterConfirm(): Promise<string> {
  const pending = consumePendingSignup()
  if (pending) {
    await api.bootstrap({
      loja_nome: pending.loja_nome,
      responsavel_nome: pending.responsavel_nome,
      whatsapp: pending.whatsapp,
      senha: pending.senha,
    })
    const ciclo = pending.ciclo === 'semestral' ? 'semestral' : 'mensal'
    return resolveSessionHome({ plano: (pending.plano as PlanoCode | null) ?? null, ciclo })
  }

  return resolveSessionHome()
}
