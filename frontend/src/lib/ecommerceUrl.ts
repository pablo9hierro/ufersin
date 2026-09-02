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

/** Login admin da loja do assinante. */
export function storeAdminLoginUrl(slug: string, email: string): string {
  const base = ecommerceFrontendUrl()
  const q = new URLSearchParams({ tenant: slug, email })
  return `${base}/admin/login?${q.toString()}`
}

/** Base da API do motor (mesma URL que o /loja embutido usa). */
function ecommerceApiUrl(): string {
  const configured = (import.meta.env.VITE_ECOMMERCE_API_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  if (!host || isLocalHost(host)) return 'http://localhost:8080'
  return window.location.origin
}

/**
 * Busca um token de admin de UM tenant demo seedado (`demo-eletronica` ou
 * `demo-ecommerce`, ver GET /demo/tokens no backend) e monta a URL de
 * `/demo-entrar` que loga a sessão real do admin (useAdminAuth) sem senha.
 * Isolado por tenant: o backend resolve o slug pelo `vertical` e o token
 * só carrega o tenant_id daquele tenant — nunca dá acesso a outra loja.
 */
export async function fetchDemoAdminAutoLoginUrl(vertical: 'eletronica' | 'ecommerce'): Promise<string> {
  const res = await fetch(`${ecommerceApiUrl()}/demo/tokens?vertical=${vertical}`)
  if (!res.ok) throw new Error('Falha ao emitir token de acesso da demo.')
  const data: { admin_token: string; tenant_slug: string; admin_name: string } = await res.json()
  const q = new URLSearchParams({
    role: 'admin',
    token: data.admin_token,
    tenantSlug: data.tenant_slug,
    name: data.admin_name,
  })
  return `${demoLojaUrl()}/demo-entrar?${q.toString()}`
}

/** Login de vendedor/motoboy/cozinha (credencial própria, cadastrada em Funcionários — não é a do admin). */
export function storeFuncionarioLoginUrl(slug: string): string {
  const base = ecommerceFrontendUrl()
  const q = new URLSearchParams({ tenant: slug })
  return `${base}/funcionarios/login?${q.toString()}`
}

/** URL pública exibida da loja (ainda path-based via /loja até subdomínio real). */
export function storePublicUrl(slug: string): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  if (!host || isLocalHost(host)) return `http://localhost:5173/?tenant=${slug}`
  return `${window.location.origin}/loja/?tenant=${slug}`
}
