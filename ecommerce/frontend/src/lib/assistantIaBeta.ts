/**
 * Ramo eletrônica: assistente IA vem nativo no plano, sem toggle de
 * assinatura — todo tenant vê a aba (já liberado geral, ver
 * a-vrtek-gente/backend/src/services/access.ts::checkAssistantAccess).
 * Ramo ecommerce: ainda é acessório pago, não cobrado de verdade —
 * allowlist abaixo é o stand-in até existir cobrança (espelha
 * `ECOMMERCE_ADDON_TENANTS` em access.ts, atualizar os dois juntos).
 * Mesma lógica de ufersin/frontend/src/lib/assistantIaBeta.ts -- essa
 * cópia (ecommerce/frontend) tinha ficado presa na allowlist antiga de
 * quando o ramo eletrônica também era beta.
 */
const ECOMMERCE_ADDON_TENANT_SLUGS = new Set(['resusu'])

export function isAssistantIaBetaTenant(slug: string | null | undefined, vertical?: string | null): boolean {
  if (!slug) return false
  if (vertical === 'eletronicos') return true
  return ECOMMERCE_ADDON_TENANT_SLUGS.has(slug)
}

export const ASSISTANT_IA_API_URL = 'https://assistant-ia-production.up.railway.app'
