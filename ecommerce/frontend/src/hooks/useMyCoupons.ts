import { couponService } from '../services/couponService'
import { useAsync } from './useAsync'

// /cliente/cupons — cupons de fidelidade do cliente logado.
export function useMyCoupons(token: string | null) {
  return useAsync(() => couponService.listMine(token!), [token], { enabled: !!token })
}
