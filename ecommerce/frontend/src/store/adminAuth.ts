import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { migrateLocalStorageKey } from '../lib/migrateStorageKey'

// Sessão do admin — separada de vendedor (useVendedorAuth) e motoboy
// (useMotoboyAuth), cada uma com chave própria no localStorage. Já foi
// uma sessão ÚNICA compartilhada pelos 3 papéis (com um campo "role"
// pra diferenciar) — causava um bug crítico: logar OU deslogar
// qualquer um dos três afetava os outros dois junto, por dividirem o
// mesmo registro no localStorage (mesma origem = storage compartilhado
// entre abas/telas). Com 3 chaves distintas, nenhuma sessão pisa mais
// na de outro papel.
//
// Namespace `resolutoo_loja_*` — isolado da plataforma Resolutoo
// (`resolutoo_platform_*`). Logout do /dashboard NÃO pode limpar isto.
//
// `tenantSlug` vem do login multi-tenant (`?tenant=` do dashboard
// Resolutoo) e alimenta tenantConfig.ts / gating de plano+onboarding.

export const LOJA_ADMIN_AUTH_KEY = 'resolutoo_loja_admin_auth'
const LEGACY_ADMIN_AUTH_KEY = 'sonset_admin_auth'

migrateLocalStorageKey(LEGACY_ADMIN_AUTH_KEY, LOJA_ADMIN_AUTH_KEY)

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
      logout: () => {
        // Só zera este store — nunca localStorage.clear() nem keys da plataforma.
        set({ token: null, name: null, tenantSlug: null })
        try {
          localStorage.removeItem(LOJA_ADMIN_AUTH_KEY)
          localStorage.removeItem(LEGACY_ADMIN_AUTH_KEY)
        } catch {
          /* ignore */
        }
      },
    }),
    {
      name: LOJA_ADMIN_AUTH_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
