import { useEffect, useMemo, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Loader2, Package } from 'lucide-react'
import { StatusBadge } from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import WhatsAppLink from '../../components/ui/WhatsAppLink'
import { ApiError } from '../../lib/apiError'
import { planoAtLeast } from '../../lib/demoMode'
import { adminService } from '../../services/adminService'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { adminCanCancelOrder, type Order } from '../../types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

const BASE_FILTERS = [
  { value: 'pendente', label: 'Pendentes' },
  { value: 'montando_pedido', label: 'Montando' },
  { value: 'pedido_pronto', label: 'Prontos' },
  { value: 'retiradas', label: 'Retiradas' },
] as const

const ENTREGAS_FILTER = { value: 'entregas', label: 'Entregas' } as const
const CONCLUIDO_FILTER = { value: 'concluido', label: 'Concluídos' } as const
const CANCELADO_FILTER = { value: 'cancelado', label: 'Cancelados' } as const

type FilterValue =
  | (typeof BASE_FILTERS)[number]['value']
  | typeof ENTREGAS_FILTER.value
  | typeof CONCLUIDO_FILTER.value
  | typeof CANCELADO_FILTER.value

const ADMIN_CANCEL_REASONS = ['A pedido do cliente', 'Outro'] as const

/** Essential (no Motoboy): delivery prontos go to admin Entregas.
 *  Management/Premium: delivery stays for the motoboy queue. */
function nextStatusFor(order: Order, adminDelivery: boolean): string | null {
  switch (order.status) {
    case 'pendente':
      return 'montando_pedido'
    case 'montando_pedido':
      return 'pedido_pronto'
    case 'pedido_pronto':
      if (order.delivery_type === 'retirada') return 'retiradas'
      if (order.delivery_type === 'entrega' && adminDelivery) return 'entregas'
      return null
    case 'retiradas':
      return 'concluido'
    case 'entregas':
      return 'concluido'
    default:
      return null
  }
}

const NEXT_LABEL: Record<string, string> = {
  pendente: 'Montar pedido',
  montando_pedido: 'Marcar pronto',
  pedido_pronto: 'Pronto pra retirada',
  retiradas: 'Concluir retirada',
  entregas: 'Marcar entregue',
}

function OrderCard({
  order,
  busyId,
  advance,
  onCancel,
  manualPaymentMode,
  adminDelivery,
}: {
  order: Order
  busyId: string | null
  advance: (order: Order, requirePayment: boolean) => void
  onCancel: (order: Order) => void
  manualPaymentMode: boolean
  adminDelivery: boolean
}) {
  const dragControls = useDragControls()
  const next = nextStatusFor(order, adminDelivery)
  const canAdvance = !!next
  const canCancel = adminCanCancelOrder(order.status)
  const requiresPaymentConfirm =
    order.payment_status !== 'pago' &&
    (manualPaymentMode ||
      ((order.status === 'retiradas' || order.status === 'entregas') && order.payment_method !== 'pix'))

  const actionLabel =
    order.status === 'pedido_pronto' && order.delivery_type === 'entrega' && adminDelivery
      ? 'Pronto pra entrega'
      : NEXT_LABEL[order.status]

  return (
    <Reorder.Item value={order} dragListener={false} dragControls={dragControls}>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <GripVertical
            onPointerDown={(e) => dragControls.start(e)}
            className="w-4 h-4 text-son-silver-dim flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
          />
          <span className="text-xs text-son-silver-dim flex-1">#{order.id.slice(0, 8)}</span>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-xs text-son-gold mb-1">
          Origem: {order.sold_by_role ? `PDV ${order.sold_by_role === 'admin' ? 'admin' : `— ${order.sold_by_name ?? 'vendedor'}`}` : 'Site'}
        </p>
        <p className="font-semibold text-white">{order.customer_name}</p>
        <p className="mb-2">
          <WhatsAppLink phone={order.customer_whatsapp} />
        </p>
        <ul className="text-sm text-son-silver space-y-0.5 mb-2">
          {order.items.map((item) => (
            <li key={item.product_id}>
              {item.quantity}x {item.product_name}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-son-silver-dim">
            {order.delivery_type === 'retirada' ? 'Retirada' : `Entrega · ${order.neighborhood}`} · {order.payment_method}
          </span>
          <span className="sunset-text font-bold">{currency(order.total)}</span>
        </div>
        {order.reference_point && (
          <p className="text-xs text-son-silver-dim italic mb-2">{order.reference_point}</p>
        )}
        {order.status === 'cancelado' && (
          <p className="text-xs text-red-400 mb-2">
            Cancelado{order.cancel_by === 'cliente' ? ' pelo cliente' : ' pela loja'}
            {order.cancel_reason ? ` — ${order.cancel_reason}` : ''}
            {order.refund_status === 'refunded'
              ? ' · Pix estornado'
              : order.payment_status === 'pago' || order.refund_status === 'not_applicable'
                ? ' · Sem estorno automático (acerte devolução manualmente se já recebeu)'
                : ''}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {canAdvance && (
            <button
              onClick={() => advance(order, requiresPaymentConfirm)}
              disabled={busyId === order.id}
              className="btn-secondary w-full text-sm py-2"
            >
              {busyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {actionLabel}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => onCancel(order)}
              disabled={busyId === order.id}
              className="w-full text-sm py-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              Cancelar pedido
            </button>
          )}
        </div>
        {order.status === 'pedido_pronto' && order.delivery_type === 'entrega' && !adminDelivery && (
          <p className="text-xs text-son-silver-dim text-center mt-2">Aguardando motoboy</p>
        )}
      </Card>
    </Reorder.Item>
  )
}

export default function AdminPedidos() {
  const tenantConfig = useTenantConfig()
  const manualPaymentMode = tenantConfig?.forma_pagamento === 'manual'
  const onlinePix = tenantConfig?.forma_pagamento === 'plataforma'
  const adminDelivery = !planoAtLeast(tenantConfig?.plano ?? 'essential', 'management')
  const filters = useMemo(
    () =>
      adminDelivery
        ? [...BASE_FILTERS, ENTREGAS_FILTER, CONCLUIDO_FILTER, CANCELADO_FILTER]
        : [...BASE_FILTERS, CONCLUIDO_FILTER, CANCELADO_FILTER],
    [adminDelivery]
  )

  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<FilterValue>('pendente')
  const [loading, setLoading] = useState(true)
  const [confirmingOrder, setConfirmingOrder] = useState<Order | null>(null)
  const [cancelingOrder, setCancelingOrder] = useState<Order | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelReason, setCancelReason] = useState<(typeof ADMIN_CANCEL_REASONS)[number]>('A pedido do cliente')
  const [cancelNote, setCancelNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState<Order[]>([])

  const load = () => {
    setLoading(true)
    adminService.orders.list().then(setOrders).finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!adminDelivery && filter === 'entregas') setFilter('pendente')
  }, [adminDelivery, filter])

  useEffect(() => {
    setVisible(orders.filter((o) => o.status === filter))
  }, [orders, filter])

  const counts = Object.fromEntries(filters.map((f) => [f.value, orders.filter((o) => o.status === f.value).length]))

  const advance = async (order: Order, requirePayment: boolean) => {
    if (requirePayment) {
      setConfirmingOrder(order)
      return
    }
    const next = nextStatusFor(order, adminDelivery)
    if (!next) return
    setError(null)
    setBusyId(order.id)
    try {
      await adminService.orders.updateStatus(order.id, next)
      if (next === 'pedido_pronto') {
        adminService.orders.notifyReady(order.id).catch(() => {})
      }
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível atualizar o pedido.')
    } finally {
      setBusyId(null)
    }
  }

  const confirmPayment = async () => {
    if (!confirmingOrder) return
    const next = nextStatusFor(confirmingOrder, adminDelivery)
    if (!next) return
    setError(null)
    setBusyId(confirmingOrder.id)
    try {
      await adminService.orders.updateStatus(confirmingOrder.id, next, true)
      setConfirmingOrder(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível confirmar o pagamento.')
    } finally {
      setBusyId(null)
    }
  }

  const openCancel = (order: Order) => {
    setCancelingOrder(order)
    setCancelConfirm(false)
    setCancelReason('A pedido do cliente')
    setCancelNote('')
    setError(null)
  }

  const submitCancel = async () => {
    if (!cancelingOrder || !cancelConfirm) return
    if (cancelReason === 'Outro' && !cancelNote.trim()) {
      setError('Informe a justificativa do cancelamento.')
      return
    }
    setError(null)
    setBusyId(cancelingOrder.id)
    try {
      await adminService.orders.cancel(
        cancelingOrder.id,
        cancelReason,
        cancelReason === 'Outro' ? cancelNote.trim() : undefined
      )
      setCancelingOrder(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar o pedido.')
    } finally {
      setBusyId(null)
    }
  }

  const confirmingIsEntrega = confirmingOrder?.status === 'entregas'
  const cancelPaidOnline =
    cancelingOrder?.payment_method === 'pix' &&
    cancelingOrder?.payment_status === 'pago' &&
    !!cancelingOrder?.pix_payment_id

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">Pedidos</h1>

      {error && <p className="error-msg mb-4">{error}</p>}

      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === f.value ? 'sunset-bg text-white' : 'bg-son-surface-light border border-white/5 text-son-silver hover:border-son-pink/30'
            }`}
          >
            {f.label} ({counts[f.value] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-son-silver-dim">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Nenhum pedido aqui.</p>
        </div>
      ) : (
        <Reorder.Group axis="y" values={visible} onReorder={setVisible} className="space-y-4">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              busyId={busyId}
              advance={advance}
              onCancel={openCancel}
              manualPaymentMode={manualPaymentMode}
              adminDelivery={adminDelivery}
            />
          ))}
        </Reorder.Group>
      )}

      {confirmingOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmingOrder(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">
              {confirmingIsEntrega ? 'Confirmar pagamento e entrega' : 'Confirmar pagamento'}
            </h3>
            <p className="text-sm text-son-silver-dim mb-5">
              {confirmingIsEntrega ? (
                <>
                  Confirmar que o pedido foi entregue e o pagamento de{' '}
                  <span className="sunset-text font-bold">{currency(confirmingOrder.total)}</span> em{' '}
                  {confirmingOrder.payment_method === 'cartao' ? 'cartão' : confirmingOrder.payment_method} foi
                  recebido?
                </>
              ) : (
                <>
                  Confirmar pagamento de{' '}
                  <span className="sunset-text font-bold">{currency(confirmingOrder.total)}</span> em{' '}
                  {confirmingOrder.payment_method === 'cartao' ? 'cartão' : confirmingOrder.payment_method}?
                </>
              )}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingOrder(null)} className="btn-secondary flex-1">
                Voltar
              </button>
              <button onClick={confirmPayment} disabled={busyId === confirmingOrder.id} className="btn-primary flex-1">
                {busyId === confirmingOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelingOrder && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setCancelingOrder(null)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">Cancelar pedido</h3>
            <p className="text-sm text-son-silver-dim mb-4">
              Pedido #{cancelingOrder.id.slice(0, 8)} · {currency(cancelingOrder.total)}
            </p>

            <label className="flex items-center gap-2 text-sm text-son-silver mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={cancelConfirm}
                onChange={(e) => setCancelConfirm(e.target.checked)}
                className="rounded border-white/20"
              />
              Deseja cancelar este pedido?
            </label>

            <label className="block text-xs text-son-silver-dim mb-1">Motivo</label>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value as (typeof ADMIN_CANCEL_REASONS)[number])}
              className="w-full mb-3 bg-son-surface-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            >
              {ADMIN_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {cancelReason === 'Outro' && (
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="Justificativa obrigatória"
                rows={3}
                className="w-full mb-3 bg-son-surface-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
              />
            )}

            {cancelPaidOnline && (
              <p className="text-xs text-son-silver-dim mb-4">
                {onlinePix && (cancelingOrder.pix_provider === 'mercado_pago' || !cancelingOrder.pix_provider)
                  ? 'Se o Pix foi cobrado online via Mercado Pago, o estorno total será tentado automaticamente antes de cancelar.'
                  : 'Pagamento online sem estorno automático via Mercado Pago — se você já recebeu o valor, acerte a devolução manualmente com o cliente.'}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setCancelingOrder(null)} className="btn-secondary flex-1">
                Voltar
              </button>
              <button
                onClick={submitCancel}
                disabled={!cancelConfirm || busyId === cancelingOrder.id}
                className="flex-1 py-2 rounded-xl bg-red-500/90 text-white text-sm font-semibold disabled:opacity-40"
              >
                {busyId === cancelingOrder.id ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
