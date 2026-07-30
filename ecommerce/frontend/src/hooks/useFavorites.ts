import { favoriteService } from '../services/favoriteService'
import { useAsync } from './useAsync'

// /cliente/favoritos — precisa de sessão de cliente.
export function useFavorites(token: string | null) {
  return useAsync(() => favoriteService.list(token!), [token], { enabled: !!token })
}
