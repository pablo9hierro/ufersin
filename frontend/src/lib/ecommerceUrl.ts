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

/** Vitrine/admin mockados da demo pública (`/demo`). */
export function demoLojaUrl(): string {
  return resolveEcommerceFrontendUrl()
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

/** URL pública exibida da loja (ainda path-based via /loja até subdomínio real). */
export function storePublicUrl(slug: string): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  if (!host || isLocalHost(host)) return `http://localhost:5173/?tenant=${slug}`
  return `${window.location.origin}/loja/?tenant=${slug}`
}
