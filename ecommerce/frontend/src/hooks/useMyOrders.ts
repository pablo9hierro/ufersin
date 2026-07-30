import { orderService } from '../services/orderService'
import { useAsync } from './useAsync'

// /cliente/historico — pedidos do cliente logado.
export function useMyOrders(token: string | null) {
  return useAsync(() => orderService.listMine(token!), [token], { enabled: !!token })
}
