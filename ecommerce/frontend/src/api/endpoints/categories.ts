import { api } from '../../lib/api'
import { validateList } from '../validate'
import { CategorySchema } from '../../types'

// Módulo Categorias — único ponto do app autorizado a chamar
// `api.categories.*` (ver lib/api.ts, o ApiClient já existente).
export const categoriesEndpoint = {
  list: async () => validateList(CategorySchema, await api.categories.list(), 'categories.list'),
}
