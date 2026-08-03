import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Minus, Package, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import { useNavigate } from '../lib/tenantRouter'
import { useProducts } from '../hooks/useProducts'
import { useCart } from '../store/cart'
import { useCartDrawer } from '../store/cartDrawer'
import type { Product } from '../types'

const EMPTY_PRODUCTS: Product[] = []

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// Painel lateral padrão da sacola: abre da direita (~80vw), lista itens
// com +/- / remover, total e CTA "Finalizar compra" → /checkout.
export default function CartDrawer() {
  const navigate = useNavigate()
  const open = useCartDrawer((s) => s.open)
  const closeDrawer = useCartDrawer((s) => s.closeDrawer)
  const { items, changeQty, removeItem } = useCart()
  const { data: productsData, loading } = useProducts()
  const products = productsData ?? EMPTY_PRODUCTS

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const lines = items
    .map((item) => ({ item, product: productById.get(item.productId) }))
    .filter((l): l is { item: (typeof items)[number]; product: Product } => !!l.product)
  const total = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, closeDrawer])

  const goCheckout = () => {
    closeDrawer()
    navigate('/checkout')
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="cart-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <motion.aside
            key="cart-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Sacola"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="fixed top-0 right-0 z-[70] flex h-[100dvh] w-[80vw] max-w-md flex-col border-l border-white/10 bg-[#121212] text-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
              <div className="flex items-center gap-2 min-w-0">
                <ShoppingBag className="w-5 h-5 shrink-0 opacity-80" />
                <h2 className="text-base font-bold truncate">Sacola</h2>
                {lines.length > 0 && (
                  <span className="text-xs opacity-60 shrink-0">
                    ({lines.reduce((s, l) => s + l.item.quantity, 0)})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10"
                aria-label="Fechar sacola"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loading ? (
                <p className="text-sm opacity-50 text-center py-10">Carregando…</p>
              ) : lines.length === 0 ? (
                <div className="text-center py-16 opacity-60">
                  <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Sua sacola está vazia.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {lines.map(({ item, product }) => (
                    <li key={product.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-5 h-5 opacity-40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{product.name}</p>
                        <p className="text-xs opacity-50">{currency(product.price)} cada</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <button
                            type="button"
                            onClick={() => changeQty(product.id, -1, product.quantity)}
                            aria-label="Diminuir"
                            className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/15"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-sm w-5 text-center">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => changeQty(product.id, 1, product.quantity)}
                            disabled={item.quantity >= product.quantity}
                            aria-label="Aumentar"
                            className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-30"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(product.id)}
                            aria-label="Remover"
                            className="ml-auto w-7 h-7 flex items-center justify-center rounded-md opacity-60 hover:opacity-100 hover:bg-white/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-white/10 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Total</span>
                <span className="font-black text-lg">{currency(total)}</span>
              </div>
              <button
                type="button"
                onClick={goCheckout}
                className="w-full rounded-xl bg-white text-black font-bold text-sm py-3.5 hover:bg-white/90 transition-colors"
              >
                Finalizar compra
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
