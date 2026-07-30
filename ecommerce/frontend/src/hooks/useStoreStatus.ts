import { storeStatusService } from '../services/storeStatusService'
import { useAsync } from './useAsync'

export function useStoreStatus() {
  return useAsync(() => storeStatusService.get(), [])
}
