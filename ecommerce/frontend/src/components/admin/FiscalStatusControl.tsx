import { useEffect, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import type { FiscalDocument } from '../../lib/api'

const STATUS_LABEL: Record<string, string> = {
  processando: 'processando',
  autorizada: 'autorizada',
  rejeitada: 'rejeitada',
  cancelada: 'cancelada',
  erro: 'erro',
}

/** Beta: só aparece pra tenants com Feature::EmissaoFiscal liberada
 * (403 no GET esconde o controle) -- mesmo padrão de DeliveryDispatchControl,
 * mas mostra chave/protocolo/motivo em vez de provider/status genérico. */
export default function FiscalStatusControl({
  orderId,
  get,
  emitir,
  cancelar,
}: {
  orderId: string
  get: () => Promise<FiscalDocument | null>
  emitir: () => Promise<FiscalDocument>
  cancelar: () => Promise<void>
}) {
  const [visible, setVisible] = useState(false)
  const [doc, setDoc] = useState<FiscalDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    get()
      .then((d) => {
        if (cancelled) return
        setDoc(d)
        setVisible(true)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          setVisible(true) // ainda sem nota -- mostra botão "Emitir"
          return
        }
        setVisible(!(e instanceof ApiError && e.status === 403))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const runEmitir = async () => {
    setError(null)
    setBusy(true)
    try {
      setDoc(await emitir())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível emitir a nota fiscal.')
    } finally {
      setBusy(false)
    }
  }

  const runCancelar = async () => {
    setError(null)
    setBusy(true)
    try {
      await cancelar()
      setDoc(await get())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar a nota fiscal.')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return (
    <div className="mt-2 pt-2 border-t border-white/10">
      {doc ? (
        <div className="text-xs text-son-silver-dim space-y-1">
          <p className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Fiscal: {STATUS_LABEL[doc.status] ?? doc.status}
            {doc.cstat && ` (cStat ${doc.cstat})`}
          </p>
          {doc.chave_acesso && <p className="break-all">Chave: {doc.chave_acesso}</p>}
          {doc.xmotivo && <p>Motivo: {doc.xmotivo}</p>}
          {doc.status === 'autorizada' && (
            <button onClick={runCancelar} disabled={busy} className="btn-secondary w-full text-sm py-2 mt-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Cancelar nota'}
            </button>
          )}
        </div>
      ) : (
        <button onClick={runEmitir} disabled={busy} className="btn-secondary w-full text-sm py-2">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Emitir nota fiscal
        </button>
      )}
      {error && <p className="error-msg mt-1">{error}</p>}
    </div>
  )
}
