import { POLITICA_PATHS, type PoliticaSlug } from '../content/politicas'

/** URL canônica do frontend Resolutoo — usada nos links de e-mail do
 * Supabase Auth (confirmação / reset). Em produção NÃO pode cair em
 * localhost: o Site URL do dashboard Supabase também precisa apontar
 * pra https://resolutoo.com (Authentication → URL Configuration). */
export function siteOrigin(): string {
  const fromEnv = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (import.meta.env.PROD) return 'https://resolutoo.com'
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return 'http://localhost:5174'
}

export function authRedirectUrl(path = '/auth/callback'): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${siteOrigin()}${p}`
}

/** Absolute URL for consent/policy pages (also used by ecommerce checkboxes). */
export function politicaUrl(slug: PoliticaSlug): string {
  return `${siteOrigin()}${POLITICA_PATHS[slug]}`
}
