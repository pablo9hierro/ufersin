import { useEffect, useState } from 'react'
import { Loader2, Store } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { PointOrder, PointPos } from '../../lib/api'

const STATUS_LABEL: Record<string, string> = {
  created: 'criada',
  pending: 'aguardando pagamento',
  in_process: 'processando',
  approved: 'aprovada',
  rejected: 'recusada',
  canceled: 'cancelada',
  refunded: 'estornada',
  failed: 'falhou',
  unknown: 'desconhecido',
}

/** Beta: só aparece pra tenants com Feature::MercadoPagoPoint liberada
 * (403 no GET esconde o controle) -- mesmo padrão de FiscalStatusControl. */
export default function PointChargeControl({ orderId }: { orderId: string }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<PointPos[]>([])
  const [selectedPos, setSelectedPos] = useState('')
  const [charge, setCharge] = useState<PointOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCharge(null)
    adminService.point
      .getOrderCharge(orderId)
      .then((c) => {
        if (cancelled) return
        setCharge(c)
        setVisible(true)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          setVisible(true)
          adminService.point
            .listPos()
            .then((p) => {
              if (!cancelled) {
                setPos(p)
                if (p.length > 0) setSelectedPos(p[0].id)
              }
            })
            .catch(() => {})
          return
        }
        setVisible(!(e instanceof ApiError && e.status === 403))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const runCharge = async () => {
    if (!selectedPos) return
    setError(null)
    setBusy(true)
    try {
      setCharge(await adminService.point.chargeOrder(orderId, selectedPos))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cobrar na maquininha.')
    } finally {
      setBusy(false)
    }
  }

  const runCancel = async () => {
    setError(null)
    setBusy(true)
    try {
      await adminService.point.cancelOrderCharge(orderId)
      setCharge(await adminService.point.getOrderCharge(orderId).catch(() => null))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar a cobrança.')
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return (
    <div className="mt-2 pt-2 border-t border-white/10">
      {charge ? (
        <div className="text-xs text-son-silver-dim space-y-1">
          <p className="flex items-center gap-1.5">
            <Store className="w-3.5 h-3.5" />
            Point: {STATUS_LABEL[charge.status] ?? charge.status}
          </p>
          {(charge.status === 'created' || charge.status === 'pending' || charge.status === 'in_process') && (
            <button onClick={runCancel} disabled={busy} className="btn-secondary w-full text-sm py-2 mt-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Cancelar cobrança'}
            </button>
          )}
        </div>
      ) : pos.length === 0 ? (
        <p className="text-xs text-son-silver-dim">Cadastre um caixa (POS) em Mercado Pago Point pra cobrar aqui.</p>
      ) : (
        <div className="space-y-1.5">
          <select className="input-field text-sm py-1.5" value={selectedPos} onChange={(e) => setSelectedPos(e.target.value)}>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={runCharge} disabled={busy} className="btn-secondary w-full text-sm py-2">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />}
            Cobrar na maquininha
          </button>
        </div>
      )}
      {error && <p className="error-msg mt-1">{error}</p>}
    </div>
  )
}
