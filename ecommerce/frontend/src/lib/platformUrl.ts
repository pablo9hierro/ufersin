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

export type PlatformPoliticaSlug =
  | 'compra'
  | 'compra-mais-18'
  | 'lojista'
  | 'plano-essential'

/** Absolute URL to resolutoo.com policy/consent pages. */
export function platformPoliticaUrl(slug: PlatformPoliticaSlug): string {
  return `${platformOrigin()}/politicas-de-privacidade/${slug}`
}
