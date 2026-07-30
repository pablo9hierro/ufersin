// Config real do onboarding do lojista (plataforma Rodoletas/ufersin) --
// diferente de demoMode.ts (que só simula plano na demo pública). Busca
// uma vez, em memória, no backend ufersin (ver
// ufersin/backend/src/routes/onboarding.rs::tenant_config) -- endpoint
// PÚBLICO, só devolve as flags, nunca credenciais de pagamento.
//
// VITE_TENANT_SLUG identifica QUAL loja este deploy do ecommerce/frontend
// é -- hoje fixo por build/ambiente (a resolução automática por
// subdomínio é trabalho da Fase 1B/multi-tenant real, ver
// ecommerce/README-TENANCY.md). Sem slug configurado, ou se a busca
// falhar (loja ainda não passou pelo onboarding novo, ambiente de
// demo/dev local etc.), cai num padrão "tudo liberado" -- nunca trava a
// loja por falta de config.
export interface TenantConfig {
  slug: string
  plano: 'essential' | 'management' | 'premium'
  vender_externamente: boolean
  whatsapp_habilitado: boolean
  forma_pagamento: 'manual' | 'plataforma'
  plataforma_pagamento: 'mercado_pago' | 'pagbank' | 'abacate_pay' | null
}

const DEFAULT_CONFIG: TenantConfig = {
  slug: '',
  plano: 'premium',
  vender_externamente: true,
  whatsapp_habilitado: true,
  forma_pagamento: 'manual',
  plataforma_pagamento: null,
}

// 8081 é a porta local padrão do ufersin/backend (ver backend/.env) --
// diferente da porta 8080 do próprio backend deste motor (VITE_API_BASE_URL).
const RODOLETAS_API_URL = import.meta.env.VITE_RODOLETAS_API_URL || 'http://localhost:8081'
const TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG || ''

let cached: TenantConfig | null = null
let inFlight: Promise<TenantConfig> | null = null

async function fetchTenantConfig(): Promise<TenantConfig> {
  if (!TENANT_SLUG) return DEFAULT_CONFIG
  try {
    const res = await fetch(`${RODOLETAS_API_URL}/api/public/tenant-config/${encodeURIComponent(TENANT_SLUG)}`)
    if (!res.ok) return DEFAULT_CONFIG
    const data = await res.json()
    return { ...DEFAULT_CONFIG, ...data }
  } catch {
    return DEFAULT_CONFIG
  }
}

/** Busca (e cacheia em memória, só pra essa aba) a config real do tenant. */
export function getTenantConfig(): Promise<TenantConfig> {
  if (cached) return Promise.resolve(cached)
  if (!inFlight) inFlight = fetchTenantConfig().then((c) => (cached = c))
  return inFlight
}

/** Versão síncrona pra quem já garantiu que getTenantConfig() rodou antes
 *  (ex.: guardas de rota que já deram await em algum lugar acima). Sem
 *  fetch ainda feito, devolve o padrão liberado. */
export function getCachedTenantConfig(): TenantConfig {
  return cached ?? DEFAULT_CONFIG
}
