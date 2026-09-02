import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { ProductSchema } from '../../types'
import { z } from 'zod'
import { cachedByTenant } from '../../lib/apiCache'

const SalesCountSchema = z.object({ product_id: z.string(), sold_count: z.number() })

// Módulo Produtos — único ponto do app autorizado a chamar
// `api.products.*`. Leituras de catálogo (list/salesCounts) são cacheadas
// por tenant por 30s — a vitrine navega catálogo -> produto -> catálogo o
// tempo todo dentro da mesma sessão, sem precisar refazer a mesma chamada.
export const productsEndpoint = {
  list: async (categoryId?: string) =>
    cachedByTenant(`products.list:${categoryId ?? ''}`, async () =>
      validateList(ProductSchema, await api.products.list(categoryId), 'products.list'),
    ),
  get: async (id: string) => validate(ProductSchema, await api.products.get(id), 'products.get'),
  salesCounts: async () =>
    cachedByTenant('products.salesCounts', async () =>
      validateList(SalesCountSchema, await api.products.salesCounts(), 'products.salesCounts'),
    ),
}
