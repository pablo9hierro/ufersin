import { useEffect, useState } from 'react'
import { useSearchParams } from '../lib/tenantRouter'
import { Loader2, MessageCircle, Package, Search } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import { StatusBadge } from '../components/ui/Badge'
import DeliveryTrackingMap from '../components/map/DeliveryTrackingMap'
import OrderCancelButton from '../components/OrderCancelButton'
import { orderService } from '../services/orderService'
import type { Order } from '../types'
import { useCustomer } from '../store/customer'
import { useTenantConfig } from '../hooks/useTenantConfig'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// wa.me exige o número completo com código do país — o WhatsApp do
// motoboy é cadastrado pelo admin sem esse padrão garantido (diferente do
// WhatsApp do cliente, que já sai normalizado como 55+DDD+número desde o
// checkout). DDD do Brasil tem 2 dígitos + número 8 ou 9 dígitos = no
// máximo 11 dígitos sem código de país; se vier assim, prefixa 55.
function whatsappComPais(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length <= 11 ? `55${digits}` : digits
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

export default function Consultar() {
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
      const result = await orderService.track(`55${digits}`)
      setOrders(result)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const orderId = searchParams.get('order')
    if (orderId) {
      setLoading(true)
      orderService
        .get(orderId)
        .then((o) => setOrders([o]))
        .finally(() => setLoading(false))
    } else if (customer.whatsapp) {
      search(customer.whatsapp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showProfile={false} showWhatsApp />
      <PageTransition className="max-w-xl mx-auto px-5 sm:px-10 pt-6 pb-20">
        <div className="flex gap-2 mb-8">
          <input
            className="input-field"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="(83) 99999-9999"
            type="tel"
            inputMode="numeric"
          />
          <button
            onClick={() => search(phone)}
            className="btn-primary px-5"
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>

        {orders === null ? null : orders.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum pedido encontrado para esse número.</p>
          </div>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li key={order.id} className="bg-son-surface border border-white/5 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-son-silver-dim">Pedido #{order.id.slice(0, 8)}</span>
                  <StatusBadge status={order.status} label={order.status === 'pendente' ? 'Pedido feito' : undefined} />
                </div>
                <ul className="text-sm text-son-silver space-y-0.5 mb-2">
                  {order.items.map((item) => (
                    <li key={item.product_id}>
                      {item.quantity}x {item.product_name}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-son-silver-dim">
                    {order.delivery_type === 'retirada' ? 'Retirada no local' : `Entrega em ${order.neighborhood ?? '-'}`}
                  </span>
                  <span className="sunset-text font-bold">{currency(order.total)}</span>
                </div>
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
                        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors"
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
      </PageTransition>
    </main>
  )
}
