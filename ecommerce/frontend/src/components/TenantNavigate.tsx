import { Navigate, type NavigateProps } from 'react-router-dom'
import { tenantTo } from '../lib/tenantConfig'

/** Navigate da vitrine que preserva `?tenant=`. */
export default function TenantNavigate({ to, ...rest }: NavigateProps) {
  return <Navigate {...rest} to={tenantTo(to)} />
}
