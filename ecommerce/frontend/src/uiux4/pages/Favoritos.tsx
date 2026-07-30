import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Heart, Loader2 } from 'lucide-react'
import { favoriteService } from '../../services/favoriteService'
import type { Product } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import ProductCard from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Uiux4Favoritos() {
  const { token } = useCustomerAuth()
  const { items, addItem, changeQty } = useCart()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  useEffect(() => {
    if (!token) return
    favoriteService.list(token).then(setProducts).finally(() => setLoading(false))
  }, [token])

  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  const confirmRemove = () => {
    if (!token || !pendingRemove) return
    const product = pendingRemove
    setPendingRemove(null)
    favoriteService
      .toggle(token, product.id)
      .then(() => setProducts((prev) => prev.filter((p) => p.id !== product.id)))
      .catch(() => {})
  }

  if (!token) return <Navigate to="/catalogo" replace />

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-16">
        <h1 className="text-lg font-black mb-4">Favoritos</h1>
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin u4-oncanvas-accent" />
          </div>
        ) : products.length === 0 ? (
          <EmptyState icon={Heart} message="Você ainda não marcou nenhum produto como favorito." actionLabel="Ver catálogo" actionHref="/catalogo" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} qty={qtyInCart(product.id)} isFavorite onToggleFavorite={() => setPendingRemove(product)} onAdd={() => addItem(product)} onRemove={() => changeQty(product.id, -1)} />
            ))}
          </div>
        )}

        {pendingRemove && (
          <ConfirmDialog title="Remover dos favoritos" message={`Tem certeza que quer remover "${pendingRemove.name}" dos seus favoritos?`} confirmLabel="Remover" onConfirm={confirmRemove} onCancel={() => setPendingRemove(null)} />
        )}
      </div>
    </Shell>
  )
}
