/**
 * Assistente IA (módulo isolado, repo `a-vrtek-gente`) ainda está em beta —
 * só a loja abaixo enxerga a aba/checkbox enquanto testamos. Depois de
 * validado, troque isso por `true` sempre (ou remova o gate) pra liberar
 * geral — o backend do módulo já aceita qualquer tenant, só o allowlist
 * dele (`backend/src/services/beta.ts`, no outro repo) também precisa ser
 * atualizado junto.
 */
const BETA_TENANT_SLUGS = new Set(['resusu'])

export function isAssistantIaBetaTenant(slug: string | null | undefined): boolean {
  return !!slug && BETA_TENANT_SLUGS.has(slug)
}

export const ASSISTANT_IA_API_URL = 'https://assistant-ia-production.up.railway.app'
