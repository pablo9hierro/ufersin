import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { migrateLocalStorageKey } from '../lib/migrateStorageKey'

// Sessão do vendedor 100% separada da sessão admin (useAdminAuth) — chave
// própria no localStorage, mesmo padrão já usado pro motoboy.
export const LOJA_VENDEDOR_AUTH_KEY = 'resolutoo_loja_vendedor_auth'
const LEGACY_VENDEDOR_AUTH_KEY = 'sonset_vendedor_auth'

migrateLocalStorageKey(LEGACY_VENDEDOR_AUTH_KEY, LOJA_VENDEDOR_AUTH_KEY)

interface VendedorAuthState {
  token: string | null
  name: string | null
  login: (token: string, name: string) => void
  logout: () => void
}

export const useVendedorAuth = create<VendedorAuthState>()(
  persist(
    (set) => ({
      token: null,
      name: null,
      login: (token, name) => set({ token, name }),
      logout: () => {
        set({ token: null, name: null })
        try {
          localStorage.removeItem(LOJA_VENDEDOR_AUTH_KEY)
          localStorage.removeItem(LEGACY_VENDEDOR_AUTH_KEY)
        } catch {
          /* ignore */
        }
      },
    }),
    {
      name: LOJA_VENDEDOR_AUTH_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
