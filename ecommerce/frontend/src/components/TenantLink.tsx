import { Link, type LinkProps } from 'react-router-dom'
import { tenantTo } from '../lib/tenantConfig'

/** Link da vitrine que preserva `?tenant=` (RR descarta search em `to="/"`). */
export default function TenantLink({ to, ...rest }: LinkProps) {
  return <Link {...rest} to={tenantTo(to)} />
}
