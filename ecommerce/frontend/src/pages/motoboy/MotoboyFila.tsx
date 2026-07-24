import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Loader2, MapPin, MapPinned, Navigation, Package } from 'lucide-react'
import { StatusBadge } from '../../components/ui/Badge'
import WhatsAppLink from '../../components/ui/WhatsAppLink'
import { api, ApiError } from '../../lib/api'
import type { MotoboyRun, Order, OrderStatus } from '../../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

const TABS: { value: OrderStatus; label: string }[] = [
  { value: 'pedido_pronto', label: 'Pedido pronto' },
  { value: 'em_rota_de_entrega', label: 'Em rota' },
  { value: 'concluido', label: 'Concluídos' },
]

function OrderCard({
  order,
  selectable,
  selected,
  toggleSelect,
}: {
  order: Order
  selectable: boolean
  selected: string[]
  toggleSelect: (id: string) => void
}) {
  const dragControls = useDragControls()

  return (
    <Reorder.Item
      value={order}
      dragListener={false}
      dragControls={dragControls}
      className="bg-son-surface border border-white/5 rounded-2xl p-4 flex items-start gap-3"
    >
      <GripVertical
        onPointerDown={(e) => dragControls.start(e)}
        className="w-4 h-4 text-son-silver-dim mt-1 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
      />
      {selectable && (
        <input
          type="checkbox"
          checked={selected.includes(order.id)}
          onChange={() => toggleSelect(order.id)}
          className="w-4 h-4 mt-1 accent-son-pink flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="font-semibold text-son-silver truncate">{order.customer_name}</span>
          {order.customer_lat != null && order.customer_lng != null ? (
            <a
              href={`https://www.google.com/maps?q=${order.customer_lat},${order.customer_lng}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors flex-shrink-0"
            >
              <MapPinned className="w-3 h-3" />
              Ver no mapa
            </a>
          ) : (
            <StatusBadge status={order.status} />
          )}
        </div>
        <p className="text-xs text-son-silver-dim mb-1">
          <WhatsAppLink phone={order.customer_whatsapp} />
        </p>
        <p className="text-sm text-son-silver-dim mt-1">
          <MapPin className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {order.neighborhood}
        </p>
        {order.reference_point && (
          <p className="text-xs text-son-silver-dim mt-0.5 italic">{order.reference_point}</p>
        )}
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-son-silver-dim">{order.payment_method}</span>
          <span className="sunset-text font-bold">{currency(order.total)}</span>
        </div>
      </div>
    </Reorder.Item>
  )
}

function ActiveRunCard({ run }: { run: MotoboyRun }) {
  const navigate = useNavigate()
  const current = run.orders[run.current_index]
  if (!current) return null

  return (
    <div className="bg-son-surface border border-son-pink/30 rounded-2xl p-5">
      <p className="text-xs text-son-silver-dim mb-1">
        Entrega {run.current_index + 1} de {run.order_ids.length}
      </p>
      <p className="font-semibold text-son-silver text-lg mb-1">{current.customer_name}</p>
      <p className="text-sm text-son-silver-dim flex items-center gap-1 mb-1">
        <MapPin className="w-3.5 h-3.5" /> {current.neighborhood}
      </p>
      {current.reference_point && <p className="text-xs text-son-silver-dim italic mb-3">{current.reference_point}</p>}
      <button onClick={() => navigate('/funcionarios/motoboy/corrida')} className="btn-primary w-full text-sm py-3 mt-2">
        <Navigation className="w-4 h-4" />
        Abrir navegação
      </button>
    </div>
  )
}

export default function MotoboyFila() {
  const [tab, setTab] = useState<OrderStatus>('pedido_pronto')
  const [orders, setOrders] = useState<Order[]>([])
  const [activeRun, setActiveRun] = useState<MotoboyRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const navigate = useNavigate()

  const loadCounts = () => {
    api.motoboy.orders.counts().then(setCounts)
  }

  const load = () => {
    setLoading(true)
    setSelected([])
    if (tab === 'em_rota_de_entrega') {
      api.motoboy.runs
        .active()
        .then(setActiveRun)
        .finally(() => setLoading(false))
    } else {
      api.motoboy.orders
        .list(tab)
        .then(setOrders)
        .finally(() => setLoading(false))
    }
    loadCounts()
  }

  useEffect(load, [tab])

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const startRun = async () => {
    if (selected.length === 0) return
    setError(null)
    setStarting(true)
    try {
      const run = await api.motoboy.runs.start(selected)
      for (const orderId of run.order_ids) {
        api.motoboy.whatsapp.notifyEnRoute(orderId).catch(() => {})
      }
      navigate('/funcionarios/motoboy/corrida')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível iniciar a(s) entrega(s).')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">Minha fila</h1>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.value ? 'sunset-bg text-son-silver' : 'bg-son-surface border border-white/5 text-son-silver hover:border-son-pink/30'
            }`}
          >
            {t.label} ({counts[t.value] ?? 0})
          </button>
        ))}
      </div>

      {error && <p className="error-msg mb-4">{error}</p>}

      {tab === 'pedido_pronto' && selected.length > 0 && (
        <button onClick={startRun} disabled={starting} className="btn-primary w-full mb-4 text-sm py-3">
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
          Iniciar entrega{selected.length > 1 ? 's' : ''} ({selected.length})
        </button>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
      ) : tab === 'em_rota_de_entrega' ? (
        activeRun ? (
          <ActiveRunCard run={activeRun} />
        ) : (
          <div className="text-center py-16 text-son-silver-dim">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhuma corrida em andamento.</p>
          </div>
        )
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-son-silver-dim">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Nenhum pedido aqui.</p>
        </div>
      ) : (
        <Reorder.Group axis="y" values={orders} onReorder={setOrders} className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              selectable={tab === 'pedido_pronto'}
              selected={selected}
              toggleSelect={toggleSelect}
            />
          ))}
        </Reorder.Group>
      )}
    </div>
  )
}
