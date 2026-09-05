import { useEffect, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { ApiError } from '../../lib/apiError'

/** Beta: só aparece pra tenants com Feature::EntregaTerceirizada liberada
 * (feature_flags) — 403 no GET inicial esconde o controle inteiro, 404
 * ainda mostra o botão de despachar. Presentational-only: recebe `get`/
 * `dispatch` já fechados sobre o recurso (pedido ou solicitação de
 * serviço) — reusado por AdminPedidos.tsx (orders) e
 * EletronicaRequestDetailModal.tsx (service_requests coleta/entrega). */
export default function DeliveryDispatchControl({
  resourceKey,
  get,
  dispatch,
  dispatchLabel,
  labelStatus,
}: {
  /** Muda quando o recurso muda (id do pedido/solicitação) -- reseta o estado. */
  resourceKey: string
  get: () => Promise<{ status: string; provider: string | null }>
  dispatch: () => Promise<void>
  dispatchLabel: string
  labelStatus: (status: string) => string
}) {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<{ status: string; provider: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    get()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        setVisible(true)
      })
      .catch((e) => {
        if (cancelled) return
        setVisible(!(e instanceof ApiError && e.status === 403))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKey])

  const run = async () => {
    setError(null)
    setBusy(true)
    try {
      await dispatch()
      setStatus(await get())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível despachar a entrega.')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return (
    <div className="mt-2 pt-2 border-t border-white/10">
      {status ? (
        <p className="text-xs text-son-silver-dim flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" />
          Entrega ({status.provider ?? '—'}): {labelStatus(status.status)}
        </p>
      ) : (
        <button onClick={run} disabled={busy} className="btn-secondary w-full text-sm py-2">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {dispatchLabel}
        </button>
      )}
      {error && <p className="error-msg mt-1">{error}</p>}
    </div>
  )
}
