import { api } from '../lib/api'

export type PublicService = {
  id: string
  name: string
  description: string
  category_name: string | null
  price: number
  available_quantity: number | null
}

// Módulo Serviços (público/vitrine) — é isto que páginas/componentes
// devem importar, nunca `lib/api` direto.
export const serviceService = {
  list: api.publicServices.list,
  get: api.publicServices.get,
}
