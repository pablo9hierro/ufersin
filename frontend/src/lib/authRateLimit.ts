/** Bloqueio educado no cliente após muitas tentativas falhas de login/cadastro.
 * Complementa o rate limit do Supabase (que é por IP / janela de 5 min). */
const STORAGE_KEY = 'resolutoo_platform_auth_attempts'
const MAX_ATTEMPTS = 10
const WINDOW_MS = 60 * 60 * 1000 // 1 hora

interface AttemptState {
  fails: number[]
}

function read(): AttemptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { fails: [] }
    const parsed = JSON.parse(raw) as AttemptState
    const cutoff = Date.now() - WINDOW_MS
    return { fails: (parsed.fails || []).filter((t) => t > cutoff) }
  } catch {
    return { fails: [] }
  }
}

function write(state: AttemptState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function getAuthLockMessage(): string | null {
  const state = read()
  if (state.fails.length < MAX_ATTEMPTS) return null
  const oldest = Math.min(...state.fails)
  const unlockAt = oldest + WINDOW_MS
  const mins = Math.max(1, Math.ceil((unlockAt - Date.now()) / 60000))
  return `Por segurança, atingimos o limite de tentativas. Aguarde cerca de ${mins} minuto${mins === 1 ? '' : 's'} e tente novamente.`
}

export function recordAuthFailure() {
  const state = read()
  state.fails.push(Date.now())
  write(state)
}

export function clearAuthFailures() {
  localStorage.removeItem(STORAGE_KEY)
}
