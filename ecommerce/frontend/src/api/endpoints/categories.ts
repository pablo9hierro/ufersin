import { api } from '../../lib/api'
import { validateList } from '../validate'
import { CategorySchema } from '../../types'
import { cachedByTenant } from '../../lib/apiCache'

// Módulo Categorias — único ponto do app autorizado a chamar
// `api.categories.*` (ver lib/api.ts, o ApiClient já existente). Cacheado
// por tenant por 30s (ver products.ts) — mesma navegação repetida.
export const categoriesEndpoint = {
  list: async () =>
    cachedByTenant('categories.list', async () => validateList(CategorySchema, await api.categories.list(), 'categories.list')),
}
