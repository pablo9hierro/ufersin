import { useCallback } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'
import { tenantTo } from '../lib/tenantConfig'

/** navigate() da vitrine que preserva `?tenant=` em todo destino string/objeto. */
export function useTenantNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        navigate(to)
        return
      }
      navigate(tenantTo(to), options)
    },
    [navigate],
  )
}
