import { useEffect, useState } from 'react'
import { getTenantConfig, type TenantConfig } from '../lib/tenantConfig'

/** Config real do onboarding (Pedidos/WhatsApp/forma de pagamento) --
 *  null enquanto carrega, pra quem precisa esperar antes de decidir
 *  o que renderizar (ver AdminLayout.tsx). */
export function useTenantConfig() {
  const [config, setConfig] = useState<TenantConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    getTenantConfig().then((c) => {
      if (!cancelled) setConfig(c)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return config
}
