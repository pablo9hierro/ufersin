import { favoritesEndpoint } from '../api/endpoints/favorites'

export const favoriteService = {
  list: favoritesEndpoint.list,
  toggle: favoritesEndpoint.toggle,
}
