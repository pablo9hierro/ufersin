/**
 * Assistente IA (módulo isolado, repo `a-vrtek-gente`) — beta restrito a
 * uma loja enquanto testamos. Ver mesma lista no frontend da plataforma
 * (ufersin/frontend/src/lib/assistantIaBeta.ts) e no backend do módulo
 * (backend/src/services/beta.ts) — as 3 precisam ser atualizadas juntas
 * quando liberar geral.
 */
const BETA_TENANT_SLUGS = new Set(['resusu'])

export function isAssistantIaBetaTenant(slug: string | null | undefined): boolean {
  return !!slug && BETA_TENANT_SLUGS.has(slug)
}

export const ASSISTANT_IA_API_URL = 'https://assistant-ia-production.up.railway.app'
