import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ApiError } from '../lib/apiError'
import { orderService } from '../services/orderService'
import { customerCanCancelOrder, type Order } from '../types'

/** Shared cancel control for /consultar skins. */
export default function OrderCancelButton({
  order,
  phoneHint,
  onCanceled,
  className,
}: {
  order: Order
  /** Digits or formatted phone used for ownership proof. */
  phoneHint: string
  onCanceled: (order: Order) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!customerCanCancelOrder(order.status)) return null

  const paidOnline =
    order.payment_method === 'pix' && order.payment_status === 'pago' && !!order.pix_payment_id

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await orderService.cancel(order.id, phoneHint || order.customer_whatsapp)
      setOpen(false)
      onCanceled(updated)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar o pedido.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'mt-3 w-full text-sm py-2 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10'
        }
      >
        Cancelar pedido
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white dark:bg-neutral-900 rounded-2xl p-5 max-w-sm w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-base mb-2">Cancelar pedido?</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
              Pedido #{order.id.slice(0, 8)}. Esta ação não pode ser desfeita.
            </p>
            {paidOnline && (
              <p className="text-xs text-neutral-500 mb-3">
                {order.pix_provider === 'mercado_pago'
                  ? 'Se o Pix foi cobrado online via Mercado Pago, o valor será estornado automaticamente.'
                  : 'Se o pagamento foi online sem Mercado Pago na loja, o cancelamento não devolve o dinheiro automaticamente — a loja acerta a devolução se já tiver recebido.'}
              </p>
            )}
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="flex-1 py-2 rounded-lg border text-sm"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Sim, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
