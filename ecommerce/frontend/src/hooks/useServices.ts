import { serviceService } from '../services/serviceService'
import { useAsync } from './useAsync'

// /servico/:id
export function useService(id: string | undefined) {
  return useAsync(() => serviceService.get(id!), [id], { enabled: !!id })
}
