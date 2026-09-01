import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Customer } from '../types'
import { migrateLocalStorageKey } from '../lib/migrateStorageKey'

// Sessão de LOGIN do cliente (whatsapp+senha) — desacoplada do rascunho
// de checkout em store/customer.ts.
export const LOJA_CUSTOMER_AUTH_KEY = 'resolutoo_loja_customer_auth'
const LEGACY_CUSTOMER_AUTH_KEY = 'sonset_customer_auth'

migrateLocalStorageKey(LEGACY_CUSTOMER_AUTH_KEY, LOJA_CUSTOMER_AUTH_KEY)

/** Sessão de login por OTP fica "fresca" por 1h -- passado isso, o
 * formulário único (nome+whatsapp+otp) pede um código novo mesmo com token
 * ainda válido no servidor (30 dias). Ver `isSessionFresh`. */
const OTP_SESSION_FRESH_MS = 60 * 60 * 1000

interface CustomerAuthState {
  token: string | null
  customer: Customer | null
  /** Timestamp (ms) da última verificação de OTP bem-sucedida. */
  verifiedAt: number | null
  /** Loja dona da sessão atual — sessão é global no localStorage
   * (`resolutoo_loja_customer_auth`), mas cada loja tem seus próprios
   * clientes. Sem isso, logar como cliente da loja A e depois visitar a
   * loja B na mesma aba mantinha o cliente da loja A "logado" (nome/
   * whatsapp/nascimento dele vazando pros formulários da loja B). */
  tenantSlug: string | null
  login: (token: string, customer: Customer) => void
  logout: () => void
  /** Chamado ao montar a loja (App.tsx) — desloga se for de uma loja
   * diferente da última vez que essa aba/navegador usou. */
  syncTenant: (slug: string) => void
}

export const useCustomerAuth = create<CustomerAuthState>()(
  persist(
    (set, get) => ({
      token: null,
      customer: null,
      verifiedAt: null,
      tenantSlug: null,
      login: (token, customer) => set({ token, customer, verifiedAt: Date.now(), tenantSlug: get().tenantSlug }),
      logout: () => {
        set({ token: null, customer: null })
        try {
          localStorage.removeItem(LOJA_CUSTOMER_AUTH_KEY)
          localStorage.removeItem(LEGACY_CUSTOMER_AUTH_KEY)
        } catch {
          /* ignore */
        }
      },
      syncTenant: (slug) => {
        const current = get().tenantSlug
        if (!slug || current === slug) return
        set({ token: null, customer: null, tenantSlug: slug })
      },
    }),
    { name: LOJA_CUSTOMER_AUTH_KEY }
  )
)

/** True quando o cliente tem token E verificou OTP há menos de 1h — só
 * nesse caso o formulário único pode pular direto pro checkout sem pedir
 * um código novo. */
export function isCustomerSessionFresh(): boolean {
  const { token, verifiedAt } = useCustomerAuth.getState()
  return !!token && !!verifiedAt && Date.now() - verifiedAt < OTP_SESSION_FRESH_MS
}
