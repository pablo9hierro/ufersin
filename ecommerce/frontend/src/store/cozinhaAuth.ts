import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Sessão da cozinha 100% separada da sessão admin (useAdminAuth) — chave
// própria no localStorage, mesmo padrão já usado pro vendedor/motoboy.
export const LOJA_COZINHA_AUTH_KEY = 'resolutoo_loja_cozinha_auth'

interface CozinhaAuthState {
  token: string | null
  name: string | null
  login: (token: string, name: string) => void
  logout: () => void
}

export const useCozinhaAuth = create<CozinhaAuthState>()(
  persist(
    (set) => ({
      token: null,
      name: null,
      login: (token, name) => set({ token, name }),
      logout: () => {
        set({ token: null, name: null })
        try {
          localStorage.removeItem(LOJA_COZINHA_AUTH_KEY)
        } catch {
          /* ignore */
        }
      },
    }),
    {
      name: LOJA_COZINHA_AUTH_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
