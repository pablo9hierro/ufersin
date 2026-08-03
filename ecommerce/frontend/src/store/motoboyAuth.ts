import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { migrateLocalStorageKey } from '../lib/migrateStorageKey'

// Sessão do motoboy 100% separada da sessão admin/vendedor.
export const LOJA_MOTOBOY_AUTH_KEY = 'resolutoo_loja_motoboy_auth'
const LEGACY_MOTOBOY_AUTH_KEY = 'sonset_motoboy_auth'

migrateLocalStorageKey(LEGACY_MOTOBOY_AUTH_KEY, LOJA_MOTOBOY_AUTH_KEY)

interface MotoboyAuthState {
  token: string | null
  name: string | null
  login: (token: string, name: string) => void
  logout: () => void
}

export const useMotoboyAuth = create<MotoboyAuthState>()(
  persist(
    (set) => ({
      token: null,
      name: null,
      login: (token, name) => set({ token, name }),
      logout: () => {
        set({ token: null, name: null })
        try {
          localStorage.removeItem(LOJA_MOTOBOY_AUTH_KEY)
          localStorage.removeItem(LEGACY_MOTOBOY_AUTH_KEY)
        } catch {
          /* ignore */
        }
      },
    }),
    {
      name: LOJA_MOTOBOY_AUTH_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
