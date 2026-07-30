import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { PromotionSchema } from '../../types'

// Módulo Promoções / Banner — único ponto do app autorizado a chamar
// `api.promotions.*`.
export const promotionsEndpoint = {
  listActive: async () => validateList(PromotionSchema, await api.promotions.listActive(), 'promotions.listActive'),
  get: async (id: string) => validate(PromotionSchema, await api.promotions.get(id), 'promotions.get'),
}
