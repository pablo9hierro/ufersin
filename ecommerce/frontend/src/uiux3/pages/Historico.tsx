import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Loader2, Package, RotateCcw } from 'lucide-react'
import { orderService } from '../../services/orderService'
import { productService } from '../../services/productService'
import type { Order, Product } from '../../types'
import { STATUS_LABELS } from '../../types'
import { useCustomerAuth } from '../../store/customerAuth'
import { useCart } from '../../store/cart'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'

export default function Uiux3Historico() {
  const { token } = useCustomerAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [buyingAgainId, setBuyingAgainId] = useState<string | null>(null)
  const [buyAgainMessage, setBuyAgainMessage] = useState<{ orderId: string; message: string } | null>(null)

  useEffect(() => {
    if (!token) return
    orderService.listMine(token).then(setOrders).finally(() => setLoading(false))
  }, [token])

  const handleBuyAgain = async (order: Order) => {
    setBuyingAgainId(order.id)
    setBuyAgainMessage(null)
    try {
      const products = await productService.list()
      const productById = new Map(products.map((p) => [p.id, p]))
      const available: { product: Product; quantity: number }[] = []
      const unavailable: string[] = []
      for (const item of order.items) {
        const product = productById.get(item.product_id)
        if (!product || product.active === false || product.quantity <= 0) unavailable.push(item.product_name)
        else available.push({ product, quantity: item.quantity })
      }
      if (available.length === 0) {
        setBuyAgainMessage({ orderId: order.id, message: 'Os produtos desse pedido não estão mais disponíveis.' })
        return
      }
      const cart = useCart.getState()
      cart.clear()
      for (const { product, quantity } of available) {
        for (let i = 0; i < quantity; i++) cart.addItem(product)
      }
      if (unavailable.length > 0) {
        setBuyAgainMessage({ orderId: order.id, message: `Adicionado à sacola. Indisponível: ${unavailable.join(', ')}.` })
        return
      }
      navigate('/carrinho')
    } finally {
      setBuyingAgainId(null)
    }
  }

  if (!token) return <Navigate to="/catalogo" replace />

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-16 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-4">Histórico de pedidos</h1>
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin u3-oncanvas-accent" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState icon={Package} message="Nenhum pedido ainda." actionLabel="Ver catálogo" actionHref="/catalogo" />
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li key={order.id} className="u3-panel p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs u3-dim">Pedido #{order.id.slice(0, 8)}</span>
                  <span className="u3-chip px-2.5 py-1 text-[11px]">{STATUS_LABELS[order.status]}</span>
                </div>
                <ul className="text-sm space-y-0.5 mb-2">
                  {order.items.map((item) => (
                    <li key={item.product_id}>
                      {item.quantity}x {item.product_name}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between text-sm mb-3">
                  <span className="u3-dim">{order.delivery_type === 'retirada' ? 'Retirada no local' : `Entrega em ${order.neighborhood ?? '-'}`}</span>
                  <span className="u3-accent font-bold">{currency(order.total)}</span>
                </div>
                <button onClick={() => handleBuyAgain(order)} disabled={buyingAgainId === order.id} className="u3-pill-secondary w-full flex items-center justify-center gap-2 text-sm py-2 disabled:opacity-60">
                  {buyingAgainId === order.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Comprar novamente
                </button>
                {buyAgainMessage?.orderId === order.id && <p className="text-xs text-red-500 mt-2">{buyAgainMessage.message}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  )
}
