import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { ProductSchema } from '../../types'
import { z } from 'zod'

const SalesCountSchema = z.object({ product_id: z.string(), sold_count: z.number() })

// Módulo Produtos — único ponto do app autorizado a chamar
// `api.products.*`.
export const productsEndpoint = {
  list: async (categoryId?: string) => validateList(ProductSchema, await api.products.list(categoryId), 'products.list'),
  get: async (id: string) => validate(ProductSchema, await api.products.get(id), 'products.get'),
  salesCounts: async () => validateList(SalesCountSchema, await api.products.salesCounts(), 'products.salesCounts'),
}
