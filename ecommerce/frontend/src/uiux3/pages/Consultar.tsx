import { useEffect, useState } from 'react'
import { useSearchParams } from '../../lib/tenantRouter'
import { Loader2, MessageCircle, Package, Search } from 'lucide-react'
import { orderService } from '../../services/orderService'
import type { Order } from '../../types'
import { STATUS_LABELS } from '../../types'
import { useCustomer } from '../../store/customer'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import StatusTimeline from '../components/StatusTimeline'
import DeliveryTrackingMap from '../../components/map/DeliveryTrackingMap'
import OrderCancelButton from '../../components/OrderCancelButton'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}
function whatsappComPais(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length <= 11 ? `55${digits}` : digits
}

export default function Uiux3Consultar() {
  const customer = useCustomer()
  const tenantConfig = useTenantConfig()
  const [searchParams] = useSearchParams()
  const [phone, setPhone] = useState(customer.whatsapp)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async (rawPhone: string) => {
    const digits = rawPhone.replace(/\D/g, '')
    if (digits.length < 10) return
    setLoading(true)
    try {
      setOrders(await orderService.track(`55${digits}`))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const orderId = searchParams.get('order')
    if (orderId) {
      setLoading(true)
      orderService.get(orderId).then((o) => setOrders([o])).finally(() => setLoading(false))
    } else if (customer.whatsapp) {
      search(customer.whatsapp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-16 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-4">Acompanhar pedido</h1>
        <div className="flex gap-2 mb-6">
          <input className="u3-panel flex-1 px-3.5 py-2.5 text-sm outline-none" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(83) 99999-9999" type="tel" inputMode="numeric" />
          <button onClick={() => search(phone)} disabled={loading} className="u3-pill-primary px-5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>

        {orders === null ? null : orders.length === 0 ? (
          <EmptyState icon={Package} message="Nenhum pedido encontrado para esse número." />
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li key={order.id} className="u3-panel p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs u3-dim">Pedido #{order.id.slice(0, 8)}</span>
                  <span className="u3-chip px-2.5 py-1 text-[11px]">{STATUS_LABELS[order.status]}</span>
                </div>
                <ul className="text-sm space-y-0.5 mb-3">
                  {order.items.map((item) => (
                    <li key={item.product_id}>
                      {item.quantity}x {item.product_name}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="u3-dim">{order.delivery_type === 'retirada' ? 'Retirada no local' : `Entrega em ${order.neighborhood ?? '-'}`}</span>
                  <span className="u3-accent font-bold">{currency(order.total)}</span>
                </div>

                <StatusTimeline status={order.status} deliveryType={order.delivery_type} />

                <OrderCancelButton
                  order={order}
                  phoneHint={phone || order.customer_whatsapp}
                  onCanceled={(updated) =>
                    setOrders((prev) => (prev ? prev.map((o) => (o.id === updated.id ? updated : o)) : [updated]))
                  }
                />

                {order.status === 'em_rota_de_entrega' && (
                  <>
                    {order.motoboy_whatsapp && (
                      <a
                        href={`https://wa.me/${whatsappComPais(order.motoboy_whatsapp)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-green-500/10 text-green-600"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Falar com motoboy
                      </a>
                    )}
                    <DeliveryTrackingMap order={order} live={!!tenantConfig?.tem_motoboy_proprio} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  )
}
