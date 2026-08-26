import { useEffect, useState } from 'react'
import { AlertCircle, Home, Loader2, MapPin, MessageCircle, ShoppingBag } from 'lucide-react'
import { adminService } from '../../services/adminService'
import type { Order } from '../../types'

// Port 1:1 de PedidosTab (aba "Vendas" de src/app/dashboard/DashboardClient.tsx
// do vrtech) -- pedidos reais da vitrine de produtos (/loja + carrinho/checkout
// genéricos), reaproveitando adminService.orders.list() já existente (mesma
// fonte que AdminPedidos.tsx usa pro resto do motor).

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pago: { label: 'Pago', color: 'text-green-400', bg: 'bg-green-500/10' },
  pendente: { label: 'Pendente', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  reembolsado: { label: 'Reembolsado', color: 'text-red-400', bg: 'bg-red-500/10' },
}

export default function EletronicaVendasTab() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminService.orders
      .list()
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar os pedidos.'))
  }, [])

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#d4d4d8]/50">Pedidos reais feitos pela vitrine — clique no cliente pra abrir a conversa de WhatsApp.</p>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2.5 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!orders && !error ? (
        <div className="flex items-center gap-2 text-[#d4d4d8]/40 text-sm py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando pedidos...
        </div>
      ) : (
        <div className="space-y-3">
          {orders && orders.length === 0 ? (
            <div className="text-center py-16 text-[#d4d4d8]/40">
              <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum pedido ainda</p>
            </div>
          ) : (
            orders?.map((order) => {
              const ps = PAYMENT_STATUS_CONFIG[order.payment_status] ?? { label: order.payment_status, color: 'text-[#d4d4d8]', bg: 'bg-white/5' }
              const digits = order.customer_whatsapp.replace(/\D/g, '')
              return (
                <div key={order.id} className="bg-[#161618] rounded-2xl border border-white/5 overflow-hidden">
                  <a
                    href={`https://wa.me/55${digits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-3 p-4 hover:bg-[#232327] transition-colors"
                  >
                    <div>
                      <h3 className="font-semibold text-white flex items-center gap-1.5">
                        {order.customer_name}
                        <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                      </h3>
                      <p className="text-sm text-[#d4d4d8]/70">{order.customer_whatsapp}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${ps.bg} ${ps.color}`}>{ps.label}</span>
                  </a>

                  <div className="px-4 pb-4 space-y-3">
                    <ul className="space-y-1.5">
                      {order.items.map((item, i) => (
                        <li key={item.id ?? i} className="flex items-center justify-between text-sm">
                          <span className="text-white truncate">
                            {item.quantity}x {item.product_name}
                          </span>
                          <span className="text-[#d4d4d8]/50 shrink-0 ml-3">R$ {(item.unit_price * item.quantity).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex items-center justify-between pt-1 border-t border-white/5">
                      <div className="flex items-center gap-1.5 text-sm text-[#d4d4d8]/70">
                        {order.delivery_type === 'balcao' ? (
                          <>
                            <Home className="w-3.5 h-3.5 shrink-0" />
                            Retirada no local
                          </>
                        ) : (
                          <>
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            {order.neighborhood || order.address || 'Entrega'}
                            {order.shipping_price > 0 && ` — frete R$ ${order.shipping_price.toFixed(2)}`}
                          </>
                        )}
                      </div>
                      <span className="text-sm font-bold text-white">Total: R$ {order.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
