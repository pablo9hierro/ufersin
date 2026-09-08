/** Canonical Resolutoo platform origin (marketing + consent pages). */
export function platformOrigin(): string {
  const fromEnv = (
    (import.meta.env.VITE_PLATFORM_URL as string | undefined) ||
    (import.meta.env.VITE_SITE_URL as string | undefined)
  )?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (import.meta.env.PROD) return 'https://resolutoo.com'
  return 'http://localhost:5174'
}

/** Base da API da plataforma (ufersin-api) -- mesma env var que
 * tenantConfig.ts usa pra buscar tenant-config. Usado pela tela
 * persistente de cobrança (BillingGate), que fala com a API da
 * plataforma sem ter o JWT de assinante (só o token de admin da loja). */
export function platformApiUrl(): string {
  const fromEnv = (import.meta.env.VITE_RODOLETAS_API_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (import.meta.env.PROD) return 'https://ufersin-api-production.up.railway.app'
  return 'http://localhost:8081'
}

export type PlatformPoliticaSlug =
  | 'compra'
  | 'compra-mais-18'
  | 'lojista'
  | 'plano-essential'

/** Absolute URL to resolutoo.com policy/consent pages. */
export function platformPoliticaUrl(slug: PlatformPoliticaSlug): string {
  return `${platformOrigin()}/politicas-de-privacidade/${slug}`
}
