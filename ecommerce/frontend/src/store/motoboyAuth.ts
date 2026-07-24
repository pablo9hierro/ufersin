import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Sessão do motoboy é 100% separada da sessão admin/vendedor (useAdminAuth)
// — chave própria no localStorage. Antes as duas dividiam uma única chave
// (sonset_admin_auth): logar como motoboy numa aba sobrescrevia o token do
// admin logado em outra aba (mesma origem = localStorage compartilhado
// entre abas), e vice-versa — ao recarregar qualquer uma das duas, ela lia
// o estado "errado" (o último papel que logou em QUALQUER aba) e caía no
// dashboard trocado, ou deslogava sozinha. Com chaves distintas, admin e
// motoboy nunca mais pisam um no estado do outro, não importa quantas
// abas/dispositivos estejam logados ao mesmo tempo.
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
      logout: () => set({ token: null, name: null }),
    }),
    {
      name: 'sonset_motoboy_auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
