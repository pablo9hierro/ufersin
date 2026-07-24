import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Customer } from '../lib/types'

// Sessão de LOGIN do cliente (whatsapp+senha) — desacoplada do rascunho
// de checkout em store/customer.ts. localStorage (não sessionStorage) de
// propósito: ao contrário do admin/motoboy/vendedor (perfis internos,
// nunca deveriam vazar entre abas de papéis diferentes), aqui é um único
// visitante numa única conta — persistir entre abas é o comportamento
// esperado de "continuar logado".
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
      logout: () => set({ token: null, customer: null }),
    }),
    { name: 'sonset_customer_auth' }
  )
)
