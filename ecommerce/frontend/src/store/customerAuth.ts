import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Customer } from '../types'
import { migrateLocalStorageKey } from '../lib/migrateStorageKey'

// Sessão de LOGIN do cliente (whatsapp+senha) — desacoplada do rascunho
// de checkout em store/customer.ts.
export const LOJA_CUSTOMER_AUTH_KEY = 'resolutoo_loja_customer_auth'
const LEGACY_CUSTOMER_AUTH_KEY = 'sonset_customer_auth'

migrateLocalStorageKey(LEGACY_CUSTOMER_AUTH_KEY, LOJA_CUSTOMER_AUTH_KEY)

interface CustomerAuthState {
  token: string | null
  customer: Customer | null
  login: (token: string, customer: Customer) => void
  logout: () => void
}

export const useCustomerAuth = create<CustomerAuthState>()(
  persist(
    (set) => ({
      token: null,
      customer: null,
      login: (token, customer) => set({ token, customer }),
      logout: () => {
        set({ token: null, customer: null })
        try {
          localStorage.removeItem(LOJA_CUSTOMER_AUTH_KEY)
          localStorage.removeItem(LEGACY_CUSTOMER_AUTH_KEY)
        } catch {
          /* ignore */
        }
      },
    }),
    { name: LOJA_CUSTOMER_AUTH_KEY }
  )
)
