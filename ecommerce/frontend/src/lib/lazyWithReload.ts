import { lazy, type ComponentType } from 'react'

const RELOAD_FLAG = 'resolutoo_chunk_reloaded_at'
// Janela curta: se o reload não resolveu, é erro real (rede/CDN fora), não
// deploy novo -- não pode entrar em loop de reload infinito.
const RELOAD_COOLDOWN_MS = 15_000

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  )
}

/**
 * `lazy()` que sobrevive a deploy.
 *
 * O Vite gera os chunks com hash no nome (`EletronicaRelatorios-CUe2HXXK.js`).
 * Num deploy novo os hashes mudam e os arquivos antigos somem do CDN -- quem
 * estava com a aba aberta e clica numa rota lazy recebe "Failed to fetch
 * dynamically imported module" e cai numa tela morta, porque o Suspense não
 * tem como se recuperar sozinho.
 *
 * Aqui: tenta de novo (cache-bust) e, se ainda falhar, recarrega a página uma
 * única vez dentro da janela de cooldown -- o reload pega o index.html novo,
 * com os hashes novos, e o usuário volta pro fluxo. Se falhar de novo depois
 * do cooldown, deixa o erro subir (aí é problema de rede de verdade, e o
 * ErrorBoundary/error-log tem que ver).
 */
export function lazyWithReload<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      if (!isChunkLoadError(err)) throw err

      // 2ª chance sem reload: às vezes é só uma falha de rede pontual.
      try {
        return await factory()
      } catch (retryErr) {
        if (!isChunkLoadError(retryErr)) throw retryErr

        let last = 0
        try {
          last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0)
        } catch {
          /* sessionStorage bloqueado (aba privada/embed) -- trata como 0 */
        }

        if (Date.now() - last > RELOAD_COOLDOWN_MS) {
          try {
            sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
          } catch {
            /* ignore */
          }
          window.location.reload()
          // Promise que nunca resolve: segura o Suspense até o reload trocar
          // a página, em vez de piscar a tela de erro no meio do caminho.
          return new Promise<{ default: T }>(() => {})
        }
        throw retryErr
      }
    }
  })
}
