import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  clientForRole,
  supabaseConfigured,
  supabaseLojista,
  supabaseSuperadmin,
  type AuthRole,
} from './supabaseClient'

// Duas sessões independentes — lojista e superadmin NÃO compartilham
// storage. Logout/login de um nunca apaga o outro (salvo se o mesmo
// user_id tiver caído no slot errado após o sign-in).

let lojistaSession: Session | null = null
let superadminSession: Session | null = null
let ready = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function markReady() {
  ready = true
  emit()
}

async function bootstrap() {
  if (!supabaseConfigured) {
    markReady()
    return
  }
  const [l, s] = await Promise.all([
    supabaseLojista.auth.getSession(),
    supabaseSuperadmin.auth.getSession(),
  ])
  lojistaSession = l.data.session
  superadminSession = s.data.session
  markReady()

  supabaseLojista.auth.onAuthStateChange((_event, session) => {
    lojistaSession = session
    markReady()
  })
  supabaseSuperadmin.auth.onAuthStateChange((_event, session) => {
    superadminSession = session
    markReady()
  })
}

void bootstrap()

/** Preferência de UI: se ambas existem, a rota atual decide via getTokenForPath. */
function activeSession(): Session | null {
  return lojistaSession ?? superadminSession
}

export const authStore = {
  getSession: () => activeSession(),
  getLojistaSession: () => lojistaSession,
  getSuperadminSession: () => superadminSession,
  getToken: () => activeSession()?.access_token ?? null,
  getTokenForRole: (role: AuthRole) =>
    (role === 'superadmin' ? superadminSession : lojistaSession)?.access_token ?? null,
  /** Token certo pra cada família de rota — nunca misturar roles. */
  getTokenForPath: (path: string) => {
    if (path.startsWith('/api/superadmin')) {
      return superadminSession?.access_token ?? null
    }
    return lojistaSession?.access_token ?? superadminSession?.access_token ?? null
  },
  isReady: () => ready,
  isAuthenticated: () => lojistaSession != null || superadminSession != null,
  signOut: async (role?: AuthRole) => {
    if (role) {
      await clientForRole(role).auth.signOut({ scope: 'local' })
      return
    }
    if (lojistaSession) {
      await supabaseLojista.auth.signOut({ scope: 'local' })
    } else if (superadminSession) {
      await supabaseSuperadmin.auth.signOut({ scope: 'local' })
    }
  },
  /**
   * Grava a sessão no slot da role. Só limpa o outro slot se ele estiver
   * com o MESMO user_id (login caiu no cliente errado) — nunca apaga a
   * sessão de outra identidade.
   */
  placeSession: async (role: AuthRole, session: Session) => {
    const target = clientForRole(role)
    await target.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
    const other = role === 'superadmin' ? supabaseLojista : supabaseSuperadmin
    const otherSession = role === 'superadmin' ? lojistaSession : superadminSession
    if (otherSession?.user?.id === session.user.id) {
      await other.auth.signOut({ scope: 'local' })
    }
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useSession() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSession)
}

export function useLojistaSession() {
  return useSyncExternalStore(authStore.subscribe, authStore.getLojistaSession)
}

export function useSuperadminSession() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSuperadminSession)
}

export function useIsAuthenticated() {
  return useSyncExternalStore(authStore.subscribe, authStore.isAuthenticated)
}

export function useAuthReady() {
  return useSyncExternalStore(authStore.subscribe, authStore.isReady)
}

export function useEmailConfirmed() {
  const s = useSession()
  return s ? Boolean(s.user.email_confirmed_at) : undefined
}
