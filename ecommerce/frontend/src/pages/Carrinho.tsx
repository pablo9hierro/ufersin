import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { LayoutGrid, List, Minus, Package, Plus, Trash2 } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import ProductDetailModal from '../components/ProductDetailModal'
import ConfirmRemoveDialog from '../components/ConfirmRemoveDialog'
import { api } from '../lib/api'
import type { Product } from '../lib/types'
import type { PromotionalProduct } from '../lib/supabasePublicApi'
import { useCart } from '../store/cart'
import { useCustomerAuth } from '../store/customerAuth'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

type ViewMode = 'grid' | 'list'

export default function Carrinho() {
  const navigate = useNavigate()
  const { items, changeQty, removeItem } = useCart()
  const customerAuth = useCustomerAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [promoProducts, setPromoProducts] = useState<PromotionalProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  // Mesma dinâmica de /catalogo: desmarcar favorito pede confirmação
  // (Uiverse.io by Yaya12085), marcar não.
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)
  // Estado 100% local desta página — mesma opção/estilo de /catalogo,
  // mas com o seu próprio useState, sem nenhuma ligação entre os dois:
  // trocar visualização aqui não afeta o catálogo.
  const [view, setView] = useState<ViewMode>('list')

  useEffect(() => {
    Promise.all([api.products.list(), api.coupons.listPromotionalProducts().catch(() => [])])
      .then(([p, promo]) => {
        setProducts(p)
        setPromoProducts(promo)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!customerAuth.token) return
    api.customerAuth
      .listFavorites(customerAuth.token)
      .then((favs) => setFavoriteIds(new Set(favs.map((p) => p.id))))
      .catch(() => {})
  }, [customerAuth.token])

  const toggleFavorite = (productId: string) => {
    if (!customerAuth.token) return
    api.customerAuth
      .toggleFavorite(customerAuth.token, productId)
      .then((isNowFavorite) => {
        setFavoriteIds((prev) => {
          const next = new Set(prev)
          if (isNowFavorite) next.add(productId)
          else next.delete(productId)
          return next
        })
      })
      .catch(() => {})
  }

  // Marcar como favorito é direto; desmarcar abre o toggle de confirmação.
  const requestToggleFavorite = (product: Product) => {
    if (favoriteIds.has(product.id)) setPendingRemove(product)
    else toggleFavorite(product.id)
  }

  const confirmRemoveFavorite = () => {
    if (!pendingRemove) return
    const product = pendingRemove
    setPendingRemove(null)
    toggleFavorite(product.id)
  }

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const p of promoProducts) if (!map.has(p.product_id)) map.set(p.product_id, p)
    return map
  }, [promoProducts])
  const lines = items
    .map((item) => ({ item, product: productById.get(item.productId) }))
    .filter((l): l is { item: typeof items[number]; product: Product } => !!l.product)

  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  const total = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} />
      <PageTransition className="max-w-2xl mx-auto px-5 sm:px-10 pt-6 pb-20">
        {loading ? null : lines.length === 0 ? (
          <div className="text-center py-20 text-son-silver-dim">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="mb-6">Sua sacola está vazia.</p>
            <Link to="/catalogo" className="btn-primary inline-flex">
              Ver catálogo
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-start gap-2 mb-4">
              <div className="flex items-center gap-1 bg-son-surface border border-white/10 rounded-xl p-1">
                <button
                  onClick={() => setView('grid')}
                  className={`p-1.5 rounded-lg ${view === 'grid' ? 'sunset-bg text-white' : 'text-son-silver-dim'}`}
                  aria-label="Ver em grade"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`p-1.5 rounded-lg ${view === 'list' ? 'sunset-bg text-white' : 'text-son-silver-dim'}`}
                  aria-label="Ver em lista"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {view === 'grid' ? (
              <div className="grid grid-cols-2 gap-4 mb-6">
                {lines.map(({ item, product }) => (
                  <div key={product.id} className="relative bg-son-surface border border-white/5 rounded-2xl overflow-hidden flex flex-col">
                    <button type="button" onClick={() => setDetailProduct(product)} className="flex flex-col flex-1 text-left">
                      <div className="aspect-square bg-son-surface-light flex items-center justify-center overflow-hidden">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-10 h-10 text-son-silver-dim/40" />
                        )}
                      </div>
                      <div className="p-3 flex flex-col gap-1 flex-1">
                        <p className="text-sm font-semibold text-white leading-snug truncate">{product.name}</p>
                        <p className="sunset-text font-bold mt-auto">{currency(product.price)}</p>
                      </div>
                    </button>
                    <div className="px-3 pb-3">
                      <div className="flex items-center justify-between bg-son-surface-light rounded-xl px-2 py-1">
                        <button
                          onClick={() => changeQty(product.id, -1, product.quantity)}
                          className="w-7 h-7 flex items-center justify-center text-son-pink"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-semibold text-white">{item.quantity}</span>
                        <button
                          onClick={() => changeQty(product.id, 1, product.quantity)}
                          disabled={item.quantity >= product.quantity}
                          className="w-7 h-7 flex items-center justify-center text-son-pink disabled:opacity-30"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => removeItem(product.id)}
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-son-silver-dim hover:text-son-pink mt-1.5 py-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-3 mb-6">
                {lines.map(({ item, product }) => (
                  <li key={product.id} className="flex items-center gap-3 bg-son-surface border border-white/5 rounded-2xl p-3">
                    {/* Igual em /catalogo — clicar no card (imagem+nome) abre
                        o mesmo toggle de detalhes do produto; os controles de
                        quantidade/remover ficam FORA desse botão, senão um
                        clique neles também abriria o modal por engano. */}
                    <button
                      type="button"
                      onClick={() => setDetailProduct(product)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="w-14 h-14 flex-shrink-0 rounded-xl bg-son-surface-light overflow-hidden flex items-center justify-center">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-5 h-5 text-son-silver-dim/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{product.name}</p>
                        <p className="text-xs text-son-silver-dim">{currency(product.price)} cada</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => changeQty(product.id, -1, product.quantity)}
                        className="w-7 h-7 flex items-center justify-center text-son-silver-dim hover:text-son-pink"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-sm w-5 text-center">{item.quantity}</span>
                      <button
                        onClick={() => changeQty(product.id, 1, product.quantity)}
                        disabled={item.quantity >= product.quantity}
                        className="w-7 h-7 flex items-center justify-center text-son-silver-dim hover:text-son-pink disabled:opacity-30"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeItem(product.id)} className="text-son-silver-dim hover:text-son-pink ml-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="bg-son-surface border border-white/5 rounded-2xl p-4 flex items-center justify-between mb-6">
              <span className="font-bold">Total</span>
              <span className="sunset-text font-black text-lg">{currency(total)}</span>
            </div>

            <button onClick={() => navigate('/checkout')} className="btn-primary w-full text-base py-4">
              Continuar para o checkout
            </button>
          </>
        )}
      </PageTransition>
      <AnimatePresence>
        {detailProduct && (
          <ProductDetailModal
            product={detailProduct}
            promo={promoByProduct.get(detailProduct.id)}
            inCart={qtyInCart(detailProduct.id)}
            outOfStock={detailProduct.quantity <= 0}
            isFavorite={favoriteIds.has(detailProduct.id)}
            onToggleFavorite={customerAuth.token ? () => requestToggleFavorite(detailProduct) : null}
            onAdd={() => changeQty(detailProduct.id, 1, detailProduct.quantity)}
            onRemove={() => changeQty(detailProduct.id, -1, detailProduct.quantity)}
            onClose={() => setDetailProduct(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {pendingRemove && (
          <ConfirmRemoveDialog
            title="Remover dos favoritos"
            message={`Tem certeza que quer remover "${pendingRemove.name}" dos seus favoritos?`}
            confirmLabel="Remover"
            onConfirm={confirmRemoveFavorite}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </AnimatePresence>
    </main>
  )
}
