import { api } from '../lib/api'

// Módulo Serviços (público/vitrine) — é isto que páginas/componentes
// devem importar, nunca `lib/api` direto.
export const serviceService = {
  list: api.publicServices.list,
  get: api.publicServices.get,
}
