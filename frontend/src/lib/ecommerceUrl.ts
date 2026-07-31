function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function looksLikeLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url)
}

/** Vitrine/admin mockados da demo pública (`/demo`).
 * Local → ecommerce em :5173. Produção → mesmo domínio sob `/loja`
 * (build embutido no deploy da Resolutoo).
 * Se a env de produção ainda apontar pra localhost (misconfig comum),
 * ignora e usa `/loja`. */
export function demoLojaUrl(): string {
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

/** Painel da loja do assinante (pós-onboarding). Continua configurável
 * por env — não cai no `/loja` da demo, que é só showcase mockado. */
export function ecommerceFrontendUrl(): string {
  const configured = (import.meta.env.VITE_ECOMMERCE_FRONTEND_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return 'http://localhost:5173'
}
