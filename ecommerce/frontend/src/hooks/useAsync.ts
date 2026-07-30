import { useCallback, useEffect, useState, type DependencyList } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

// Primitivo genérico de leitura assíncrona — substitui o bloco
// `useState+useEffect+.then+.finally` que se repetia em quase toda
// página/hook que buscava dado ao montar (ver hooks/use*.ts). Dispara de
// novo sempre que `deps` mudar e ignora respostas de chamadas que já
// ficaram obsoletas (evita setState depois de trocar de tela rápido).
//
// `enabled: false` pula a chamada (ex.: ainda não tem token de login) e
// devolve estado ocioso (data null, loading false) em vez de ficar preso
// carregando pra sempre.
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: DependencyList,
  options?: { enabled?: boolean }
): AsyncState<T> & { refetch: () => void } {
  const enabled = options?.enabled ?? true
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: enabled, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fn()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, refetch }
}
