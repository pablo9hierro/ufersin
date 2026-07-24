import { useSyncExternalStore } from 'react'

const KEY = 'rodoletas_token'

let token: string | null = localStorage.getItem(KEY)
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export const authStore = {
  getToken: () => token,
  setToken: (t: string | null) => {
    token = t
    if (t) localStorage.setItem(KEY, t)
    else localStorage.removeItem(KEY)
    emit()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useAuthToken() {
  return useSyncExternalStore(authStore.subscribe, authStore.getToken)
}

export function useIsAuthenticated() {
  return useAuthToken() !== null
}
