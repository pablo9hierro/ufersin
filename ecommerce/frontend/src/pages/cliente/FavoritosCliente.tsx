import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Heart, Loader2, Package } from 'lucide-react'
import SiteHeader from '../../components/layout/SiteHeader'
import PageTransition from '../../components/layout/PageTransition'
import CartFab from '../../components/CartFab'
import ProductDetailModal, { PromoPriceBlock, PromoRibbon, currency } from '../../components/ProductDetailModal'
import FavoriteHeartButton from '../../components/FavoriteHeartButton'
import ConfirmRemoveDialog from '../../components/ConfirmRemoveDialog'
import { api } from '../../lib/api'
import type { Product } from '../../lib/types'
import type { PromotionalProduct } from '../../lib/supabasePublicApi'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'

export default function FavoritosCliente() {
  const { token } = useCustomerAuth()
  const { items, addItem, changeQty } = useCart()
  const [products, setProducts] = useState<Product[]>([])
  const [promos, setPromos] = useState<PromotionalProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  // Aqui a lista É "os favoritos" — desmarcar remove o card de vez, por
  // isso pede confirmação antes (Uiverse.io by Yaya12085), diferente do
  // catálogo onde desfavoritar só troca o coração e o produto continua
  // na tela.
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  useEffect(() => {
    if (!token) return
    Promise.all([api.customerAuth.listFavorites(token), api.coupons.listPromotionalProducts().catch(() => [])])
      .then(([favs, promo]) => {
        setProducts(favs)
        setPromos(promo)
      })
      .finally(() => setLoading(false))
  }, [token])

  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const promo of promos) if (!map.has(promo.product_id)) map.set(promo.product_id, promo)
    return map
  }, [promos])

  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  const confirmRemove = () => {
    if (!token || !pendingRemove) return
    const product = pendingRemove
    setPendingRemove(null)
    api.customerAuth
      .toggleFavorite(token, product.id)
      .then(() => {
        setProducts((prev) => prev.filter((p) => p.id !== product.id))
        setDetailProduct((cur) => (cur?.id === product.id ? null : cur))
      })
      .catch(() => {})
  }

  if (!token) return <Navigate to="/" replace />

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} />
      <CartFab />
      <PageTransition className="max-w-6xl mx-auto px-5 sm:px-10 pt-6 pb-16">
        <div className="glass rounded-3xl p-4 sm:p-6">
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 text-son-silver-dim">
              <Heart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Você ainda não marcou nenhum produto como favorito.</p>
              <Link to="/catalogo" className="btn-primary inline-flex mt-4">
                Ver catálogo
              </Link>
            </div>
          ) : (
            <div className="catalogo-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((product) => {
                const promo = promoByProduct.get(product.id)
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setDetailProduct(product)}
                    className="relative bg-son-surface border border-white/5 rounded-2xl overflow-hidden flex flex-col hover:border-son-pink/30 transition-colors text-left"
                  >
                    {promo && <PromoRibbon promo={promo} />}
                    <div className="absolute top-2 right-2 z-10">
                      <FavoriteHeartButton checked onChange={() => setPendingRemove(product)} />
                    </div>
                    <div className="aspect-square bg-son-surface-light flex items-center justify-center overflow-hidden">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-10 h-10 text-son-silver-dim/40" />
                      )}
                    </div>
                    <div className="p-3 flex flex-col gap-1">
                      <p className="text-sm font-semibold text-white leading-snug">{product.name}</p>
                      {promo ? <PromoPriceBlock price={product.price} promo={promo} /> : <p className="sunset-text font-bold">{currency(product.price)}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </PageTransition>
      <AnimatePresence>
        {detailProduct && (
          <ProductDetailModal
            product={detailProduct}
            promo={promoByProduct.get(detailProduct.id)}
            inCart={qtyInCart(detailProduct.id)}
            outOfStock={detailProduct.quantity <= 0}
            isFavorite
            onToggleFavorite={() => setPendingRemove(detailProduct)}
            onAdd={() => addItem(detailProduct)}
            onRemove={() => changeQty(detailProduct.id, -1)}
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
            onConfirm={confirmRemove}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </AnimatePresence>
    </main>
  )
}
