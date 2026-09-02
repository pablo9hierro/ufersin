import { resolveTenantSlug } from './tenantConfig'

// Cache raso em memória pra leituras de catálogo público (produtos,
// categorias, promoções) que se repetem toda vez que o cliente navega
// catálogo -> produto -> catálogo dentro da mesma sessão de SPA. Chave
// SEMPRE inclui o slug do tenant -- nunca cachear entre lojas diferentes,
// isolamento multi-tenant é inegociável.
const store = new Map<string, { at: number; promise: Promise<unknown> }>()
const TTL_MS = 30_000

export function cachedByTenant<T>(key: string, fn: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const slug = resolveTenantSlug() ?? '__no_tenant__'
  const fullKey = `${slug}:${key}`
  const hit = store.get(fullKey)
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>
  const promise = fn().catch((err) => {
    store.delete(fullKey) // nunca cachear erro
    throw err
  })
  store.set(fullKey, { at: Date.now(), promise })
  return promise as Promise<T>
}
