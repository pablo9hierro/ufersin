import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  const tenantParam = params.get('tenant')?.trim().toLowerCase() ?? ''
  const [config, setConfig] = useState<TenantConfig | null>(() => peekCachedTenantConfig())

  useEffect(() => {
    if (tenantParam) persistTenantSlug(tenantParam)
  }, [tenantParam])

  useEffect(() => {
    let cancelled = false

    const apply = (c: TenantConfig) => {
      if (!cancelled) setConfig(c)
    }

    // TTL cobre reuso entre hooks; focus só revalida se o cache expirou
    // (não força reset — isso re-disparava o gate do AdminLayout).
    getTenantConfig().then(apply)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      getTenantConfig().then(apply)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [tenantParam])

  return config
}
