/**
 * Assistente IA sai do beta: vem junto com o plano (ecommerce e eletrônica),
 * o lojista liga/desliga pelo próprio toggle em /assistente-ia
 * (assistant_config.enabled). Sem allowlist — mantém a função só pra não
 * mexer nos call sites (MeuPlano etc.).
 */
export function isAssistantIaBetaTenant(
  slug: string | null | undefined,
  _vertical?: string | null,
): boolean {
  return !!slug
}

export const ASSISTANT_IA_API_URL = 'https://assistant-ia-production.up.railway.app'
