function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function looksLikeLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url)
}

/** Base do frontend do motor (vitrine + admin).
 * - Local: :5173
 * - Produção: mesmo domínio sob `/loja` (build embutido no deploy)
 * Ignora VITE_ECOMMERCE_FRONTEND_URL se ainda apontar pra localhost em prod. */
function resolveEcommerceFrontendUrl(): string {
  const configured = (import.meta.env.VITE_ECOMMERCE_FRONTEND_URL as string | undefined)?.trim()
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const onLocal = !host || isLocalHost(host)

  if (configured) {
    const normalized = configured.replace(/\/$/, '')
    if (!(looksLikeLocalUrl(normalized) && !onLocal)) return normalized
  }

  if (onLocal) return 'http://localhost:5173'
  return `${window.location.origin}/loja`
}

export type DemoRole = 'vitrine' | 'admin' | 'motoboy' | 'vendedor'

/** Vitrine/admin mockados da demo pública (`/demo`). */
export function demoLojaUrl(): string {
  return resolveEcommerceFrontendUrl()
}

/**
 * URL pública canônica da demo (barra de endereço Resolutoo).
 * Ex.: `/demo/admin/essential`, `/demo/vitrine/premium`
 */
export function demoExperiencePath(role: DemoRole, plano: string): string {
  return `/demo/${role}/${plano}`
}

/** Absolute URL for `window.open` from /demo/:plano CTAs. */
export function demoExperienceUrl(role: DemoRole, plano: string): string {
  if (typeof window === 'undefined') return demoExperiencePath(role, plano)
  return `${window.location.origin}${demoExperiencePath(role, plano)}`
}

/**
 * URL interna do motor embutido — só usada pelo iframe de DemoExperience.
 * Já autentica com mock (nunca /admin/login).
 */
export function demoEntrarUrl(role: DemoRole, plano: string): string {
  const q = new URLSearchParams({ role, plano })
  return `${demoLojaUrl()}/demo-entrar?${q.toString()}`
}

/** Painel da loja do assinante (pós-onboarding). */
export function ecommerceFrontendUrl(): string {
  return resolveEcommerceFrontendUrl()
}

/** Ramo da loja — decide qual aplicação atende o lojista. */
export type Vertical = 'ecommerce' | 'eletronicos'

/**
 * Base do app de eletrônicos (VR Tech). É uma aplicação separada do motor
 * genérico: vitrine e painel próprios, deploy próprio. Loja do ramo
 * eletrônicos nunca abre o frontend do motor.
 */
function vrtechAppUrl(): string {
  const configured = (import.meta.env.VITE_VRTECH_APP_URL as string | undefined)?.trim()
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const onLocal = !host || isLocalHost(host)

  if (configured) {
    const normalized = configured.replace(/\/$/, '')
    if (!(looksLikeLocalUrl(normalized) && !onLocal)) return normalized
  }
  return onLocal ? 'http://localhost:3000' : 'https://vrtech-jp.vercel.app'
}

/** Login do painel da loja do assinante. */
export function storeAdminLoginUrl(slug: string, email: string, vertical?: Vertical): string {
  if (vertical === 'eletronicos') return `${vrtechAppUrl()}/login`

  const base = ecommerceFrontendUrl()
  const q = new URLSearchParams({ tenant: slug, email })
  return `${base}/admin/login?${q.toString()}`
}

/** URL pública exibida da loja (ainda path-based via /loja até subdomínio real). */
export function storePublicUrl(slug: string, vertical?: Vertical): string {
  if (vertical === 'eletronicos') return vrtechAppUrl()

  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  if (!host || isLocalHost(host)) return `http://localhost:5173/?tenant=${slug}`
  return `${window.location.origin}/loja/?tenant=${slug}`
}
