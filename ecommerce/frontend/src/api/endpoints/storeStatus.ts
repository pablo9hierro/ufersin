import { api } from '../../lib/api'
import { validate } from '../validate'
import { StoreStatusSchema } from '../../types'

// Módulo Configurações (horário/status da loja) — único ponto do app
// autorizado a chamar `api.storeStatus.get`.
export const storeStatusEndpoint = {
  get: async () => validate(StoreStatusSchema, await api.storeStatus.get(), 'storeStatus.get'),
}
