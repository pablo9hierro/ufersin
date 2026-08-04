import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  getTenantConfig,
  peekCachedTenantConfig,
  persistTenantSlug,
  type TenantConfig,
} from '../lib/tenantConfig'

/** Config real do onboarding (Pedidos/WhatsApp/forma de pagamento/layout) —
 *  null enquanto carrega, pra quem precisa esperar antes de decidir
 *  o que renderizar (ver AdminLayout.tsx / StyleAware). */
export function useTenantConfig() {
  const [params] = useSearchParams()
  const location = useLocation()
  const tenantParam = params.get('tenant')?.trim().toLowerCase() ?? ''
  const isAdminSurface = location.pathname.startsWith('/admin')
  const [config, setConfig] = useState<TenantConfig | null>(() =>
    // Admin must not trust a warm cache after cancel — wait for a fresh fetch.
    isAdminSurface ? null : peekCachedTenantConfig(),
  )

  useEffect(() => {
    if (tenantParam) persistTenantSlug(tenantParam)
  }, [tenantParam])

  useEffect(() => {
    let cancelled = false

    const apply = (c: TenantConfig) => {
      if (!cancelled) setConfig(c)
    }

    // Painel: always revalidate (cancel/pause must drop the shell immediately).
    // Vitrine: TTL cache is fine.
    getTenantConfig({ force: isAdminSurface }).then(apply)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      getTenantConfig({ force: isAdminSurface }).then(apply)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [tenantParam, isAdminSurface])

  return config
}
