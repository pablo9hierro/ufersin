/** Abortable fetch with a hard deadline — Railway cold starts must not hang UI forever. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000,
): Promise<Response> {
  const ctrl = new AbortController()
  const external = init.signal
  const onAbort = () => ctrl.abort(external?.reason)
  if (external) {
    if (external.aborted) ctrl.abort(external.reason)
    else external.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onAbort)
  }
}
