import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

// Espelha a sessão do Supabase Auth (ver ARQUITETURA.md §6) em vez de um
// token custom em localStorage — o Supabase já persiste/renova a sessão
// sozinho (localStorage próprio dele), este store só republica o estado
// atual pro React via useSyncExternalStore.
let session: Session | null = null
let ready = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

supabase.auth.getSession().then(({ data }) => {
  session = data.session
  ready = true
  emit()
})

supabase.auth.onAuthStateChange((_event, s) => {
  session = s
  ready = true
  emit()
})

export const authStore = {
  getSession: () => session,
  getToken: () => session?.access_token ?? null,
  isReady: () => ready,
  signOut: () => supabase.auth.signOut(),
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useSession() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSession)
}

export function useIsAuthenticated() {
  return useSession() !== null
}

/** false até a primeira checagem de sessão (getSession) resolver — evita
 * redirecionar pra /login por um instante antes da sessão persistida
 * carregar. */
export function useAuthReady() {
  return useSyncExternalStore(authStore.subscribe, authStore.isReady)
}

/** `null` = ainda não confirmou, `undefined` = não logado. Vem direto da
 * sessão do Supabase — não duplicamos esse estado no Postgres local (ver
 * ARQUITETURA.md §6). */
export function useEmailConfirmed() {
  const s = useSession()
  return s ? Boolean(s.user.email_confirmed_at) : undefined
}
