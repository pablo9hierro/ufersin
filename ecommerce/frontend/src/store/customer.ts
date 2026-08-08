import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CustomerState {
  name: string
  whatsapp: string
  // yyyy-mm-dd (input type="date") — exigido no checkout, tabacaria só pode
  // vender pra maior de idade.
  birthdate: string
  neighborhood: string
  address: string
  referencePoint: string
  lat: number | null
  lng: number | null
  /** Loja dona do rascunho atual — rascunho é global no localStorage
   * (`sonset_customer`), mas cada loja tem seus próprios clientes. Sem
   * isso, preencher o checkout na loja A e depois visitar a loja B na
   * mesma aba vazava nome/whatsapp/nascimento/endereço da loja A pro
   * formulário da loja B. */
  tenantSlug: string | null
  set: (
    data: Partial<
      Pick<CustomerState, 'name' | 'whatsapp' | 'birthdate' | 'neighborhood' | 'address' | 'referencePoint' | 'lat' | 'lng'>
    >
  ) => void
  /** Chamado ao montar a loja (App.tsx) — zera o rascunho se for de uma
   * loja diferente da última vez que essa aba/navegador usou. */
  syncTenant: (slug: string) => void
}

export const useCustomer = create<CustomerState>()(
  persist(
    (set, get) => ({
      name: '',
      whatsapp: '',
      birthdate: '',
      neighborhood: '',
      address: '',
      referencePoint: '',
      lat: null,
      lng: null,
      tenantSlug: null,
      set: (data) => set(data),
      syncTenant: (slug) => {
        const current = get().tenantSlug
        if (!slug || current === slug) return
        set({
          name: '',
          whatsapp: '',
          birthdate: '',
          neighborhood: '',
          address: '',
          referencePoint: '',
          lat: null,
          lng: null,
          tenantSlug: slug,
        })
      },
    }),
    { name: 'sonset_customer' }
  )
)
