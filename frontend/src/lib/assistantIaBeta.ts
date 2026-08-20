/**
 * Ramo eletrônica: assistente IA vem nativo no plano, sem toggle de
 * assinatura — todo tenant vê a aba. Ramo ecommerce: só é acessório pago,
 * ainda não cobrado de verdade — allowlist abaixo é o stand-in até existir
 * cobrança (espelha `ECOMMERCE_ADDON_TENANTS` em
 * a-vrtek-gente/backend/src/services/access.ts, atualizar os dois juntos).
 */
const ECOMMERCE_ADDON_TENANT_SLUGS = new Set(['resusu'])

export function isAssistantIaBetaTenant(
  slug: string | null | undefined,
  vertical?: string | null,
): boolean {
  if (!slug) return false
  if (vertical === 'eletronicos') return true
  return ECOMMERCE_ADDON_TENANT_SLUGS.has(slug)
}

export const ASSISTANT_IA_API_URL = 'https://assistant-ia-production.up.railway.app'
