import { api } from '../../lib/api'
import { validateList } from '../validate'
import { ProductSchema } from '../../types'

// Módulo Favoritos — único ponto do app autorizado a chamar a fatia de
// favoritos de `api.customerAuth.*`.
export const favoritesEndpoint = {
  list: async (token: string) => validateList(ProductSchema, await api.customerAuth.listFavorites(token), 'customerAuth.listFavorites'),
  toggle: async (token: string, productId: string) => api.customerAuth.toggleFavorite(token, productId),
}
