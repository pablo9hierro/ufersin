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
  set: (
    data: Partial<
      Pick<CustomerState, 'name' | 'whatsapp' | 'birthdate' | 'neighborhood' | 'address' | 'referencePoint' | 'lat' | 'lng'>
    >
  ) => void
}

export const useCustomer = create<CustomerState>()(
  persist(
    (set) => ({
      name: '',
      whatsapp: '',
      birthdate: '',
      neighborhood: '',
      address: '',
      referencePoint: '',
      lat: null,
      lng: null,
      set: (data) => set(data),
    }),
    { name: 'sonset_customer' }
  )
)
