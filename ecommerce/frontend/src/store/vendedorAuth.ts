import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Sessão do vendedor 100% separada da sessão admin (useAdminAuth) — chave
// própria no localStorage, mesmo padrão já usado pro motoboy (ver
// store/motoboyAuth.ts). Antes vendedor e admin dividiam a mesma chave
// (sonset_admin_auth, com um campo "role" pra diferenciar): logar como
// vendedor sobrescrevia a sessão do admin (e vice-versa) — deslogar
// qualquer um dos dois deslogava os dois juntos, já que era o MESMO
// registro no localStorage. Com chave distinta, admin e vendedor nunca
// mais pisam um no estado do outro.
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
      logout: () => set({ token: null, name: null }),
    }),
    {
      name: 'sonset_vendedor_auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
