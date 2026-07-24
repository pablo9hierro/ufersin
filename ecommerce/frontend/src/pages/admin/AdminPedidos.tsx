import { useEffect, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Loader2, Package } from 'lucide-react'
import { StatusBadge } from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import WhatsAppLink from '../../components/ui/WhatsAppLink'
import { api, ApiError } from '../../lib/api'
import type { Order } from '../../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

const FILTERS = [
  { value: 'pendente', label: 'Pendentes' },
  { value: 'montando_pedido', label: 'Montando' },
  { value: 'pedido_pronto', label: 'Prontos' },
  { value: 'retiradas', label: 'Retiradas' },
  { value: 'concluido', label: 'Concluídos' },
] as const

// pedido_pronto's next step depends on delivery_type: retirada orders move to
// 'retiradas' (admin handles the pickup handoff); entrega orders have no admin
// action here — the motoboy takes over via the fila.
function nextStatusFor(order: Order): string | null {
  switch (order.status) {
    case 'pendente':
      return 'montando_pedido'
    case 'montando_pedido':
      return 'pedido_pronto'
    case 'pedido_pronto':
      return order.delivery_type === 'retirada' ? 'retiradas' : null
    case 'retiradas':
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
}

function OrderCard({
  order,
  busyId,
  advance,
}: {
  order: Order
  busyId: string | null
  advance: (order: Order, requirePayment: boolean) => void
}) {
  const dragControls = useDragControls()
  const next = nextStatusFor(order)
  const canAdvance = !!next
  const requiresPaymentConfirm =
    order.status === 'retiradas' && order.payment_method !== 'pix' && order.payment_status !== 'pago'

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
        {canAdvance && (
          <button
            onClick={() => advance(order, requiresPaymentConfirm)}
            disabled={busyId === order.id}
            className="btn-secondary w-full text-sm py-2"
          >
            {busyId === order.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {NEXT_LABEL[order.status]}
          </button>
        )}
        {order.status === 'pedido_pronto' && order.delivery_type === 'entrega' && (
          <p className="text-xs text-son-silver-dim text-center">Aguardando motoboy</p>
        )}
      </Card>
    </Reorder.Item>
  )
}

export default function AdminPedidos() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('pendente')
  const [loading, setLoading] = useState(true)
  const [confirmingOrder, setConfirmingOrder] = useState<Order | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Local drag-and-drop order for the currently visible filter — purely a
  // front-end display convenience, never persisted to the backend.
  const [visible, setVisible] = useState<Order[]>([])

  const load = () => {
    setLoading(true)
    api.admin.orders.list().then(setOrders).finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    setVisible(orders.filter((o) => o.status === filter))
  }, [orders, filter])

  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, orders.filter((o) => o.status === f.value).length]))

  const advance = async (order: Order, requirePayment: boolean) => {
    if (requirePayment) {
      setConfirmingOrder(order)
      return
    }
    const next = nextStatusFor(order)
    if (!next) return
    setError(null)
    setBusyId(order.id)
    try {
      await api.admin.orders.updateStatus(order.id, next)
      if (next === 'pedido_pronto') {
        api.admin.orders.notifyReady(order.id).catch(() => {})
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
    const next = nextStatusFor(confirmingOrder)
    if (!next) return
    setError(null)
    setBusyId(confirmingOrder.id)
    try {
      await api.admin.orders.updateStatus(confirmingOrder.id, next, true)
      setConfirmingOrder(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível confirmar o pagamento.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">Pedidos</h1>

      {error && <p className="error-msg mb-4">{error}</p>}

      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {FILTERS.map((f) => (
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
            <OrderCard key={order.id} order={order} busyId={busyId} advance={advance} />
          ))}
        </Reorder.Group>
      )}

      {confirmingOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmingOrder(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">Confirmar pagamento</h3>
            <p className="text-sm text-son-silver-dim mb-5">
              Confirme que recebeu o pagamento em {confirmingOrder.payment_method} de{' '}
              <span className="sunset-text font-bold">{currency(confirmingOrder.total)}</span> para concluir o pedido.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingOrder(null)} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button onClick={confirmPayment} disabled={busyId === confirmingOrder.id} className="btn-primary flex-1">
                {busyId === confirmingOrder.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
