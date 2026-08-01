import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Sessão do admin — separada de vendedor (useVendedorAuth) e motoboy
// (useMotoboyAuth), cada uma com chave própria no localStorage. Já foi
// uma sessão ÚNICA compartilhada pelos 3 papéis (com um campo "role"
// pra diferenciar) — causava um bug crítico: logar OU deslogar
// qualquer um dos três afetava os outros dois junto, por dividirem o
// mesmo registro no localStorage (mesma origem = storage compartilhado
// entre abas/telas). Com 3 chaves distintas, nenhuma sessão pisa mais
// na de outro papel.
//
// `tenantSlug` vem do login multi-tenant (`?tenant=` do dashboard
// Resolutoo) e alimenta tenantConfig.ts / gating de plano+onboarding.
interface AdminAuthState {
  token: string | null
  name: string | null
  tenantSlug: string | null
  login: (token: string, name: string, tenantSlug?: string | null) => void
  logout: () => void
}

export const useAdminAuth = create<AdminAuthState>()(
  persist(
    (set) => ({
      token: null,
      name: null,
      tenantSlug: null,
      login: (token, name, tenantSlug = null) =>
        set({ token, name, tenantSlug: tenantSlug?.trim().toLowerCase() || null }),
      logout: () => set({ token: null, name: null, tenantSlug: null }),
    }),
    {
      name: 'sonset_admin_auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
