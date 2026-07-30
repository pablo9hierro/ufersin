import { promotionService } from '../services/promotionService'
import { useAsync } from './useAsync'

// Carrossel da landing — promoções ativas.
export function useActivePromotions(options?: { enabled?: boolean }) {
  return useAsync(() => promotionService.listActive(), [], { enabled: options?.enabled })
}
