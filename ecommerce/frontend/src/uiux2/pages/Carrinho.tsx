import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { Minus, Package, Plus, Trash2 } from 'lucide-react'
import { useProducts } from '../../hooks/useProducts'
import { favoriteService } from '../../services/favoriteService'
import type { Product } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import FavoriteButton from '../components/FavoriteButton'

// Referência estável enquanto os dados ainda não chegaram -- ver mesma
// nota em pages/Catalogo.tsx (Sunset).
const EMPTY_PRODUCTS: Product[] = []

export default function Uiux2Carrinho() {
  const navigate = useNavigate()
  const { items, changeQty, removeItem } = useCart()
  const customerAuth = useCustomerAuth()
  const { data: productsData, loading } = useProducts()
  const products = productsData ?? EMPTY_PRODUCTS
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  // Favoritar é direto; desfavoritar pede confirmação antes -- mesma
  // dinâmica do catálogo, nunca desfavorita silenciosamente.
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  useEffect(() => {
    if (!customerAuth.token) return
    favoriteService
      .list(customerAuth.token)
      .then((favs) => setFavoriteIds(new Set(favs.map((p) => p.id))))
      .catch(() => {})
  }, [customerAuth.token])

  const toggleFavorite = (productId: string) => {
    if (!customerAuth.token) return
    favoriteService
      .toggle(customerAuth.token, productId)
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
  const lines = items.map((item) => ({ item, product: productById.get(item.productId) })).filter((l): l is { item: (typeof items)[number]; product: Product } => !!l.product)
  const total = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)

  if (loading) return <Shell>{null}</Shell>

  if (lines.length === 0) {
    return (
      <Shell>
        <div className="px-4 sm:px-8 pt-6">
          <EmptyState icon={Package} message="Sua sacola está vazia." actionLabel="Ver catálogo" actionHref="/catalogo" />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-8 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-4">Sua sacola</h1>
        <ul className="space-y-3 mb-6">
          {lines.map(({ item, product }) => (
            <li key={product.id} className="u2-card flex items-center gap-3 p-3">
              <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: 'var(--uf-surface-light)' }}>
                {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-5 h-5 u2-dim" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{product.name}</p>
                <p className="text-xs u2-dim">{currency(product.price)} cada</p>
              </div>
              <div className="flex items-center gap-1.5">
                {customerAuth.token && <FavoriteButton checked={favoriteIds.has(product.id)} onClick={() => requestToggleFavorite(product)} />}
                <button onClick={() => changeQty(product.id, -1, product.quantity)} aria-label="Diminuir" className="w-7 h-7 flex items-center justify-center u2-dim">
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-sm w-5 text-center">{item.quantity}</span>
                <button onClick={() => changeQty(product.id, 1, product.quantity)} disabled={item.quantity >= product.quantity} aria-label="Aumentar" className="w-7 h-7 flex items-center justify-center u2-dim disabled:opacity-30">
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => removeItem(product.id)} aria-label="Remover" className="u2-dim ml-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="u2-card flex items-center justify-between p-4 mb-5">
          <span className="font-bold">Total</span>
          <span className="u2-accent font-black text-lg">{currency(total)}</span>
        </div>

        <button onClick={() => navigate('/checkout')} className="u2-btn-primary w-full text-base py-3.5">
          Continuar para o checkout
        </button>
      </div>

      {pendingRemove && (
        <ConfirmDialog
          title="Remover dos favoritos"
          message={`Tem certeza que quer remover "${pendingRemove.name}" dos seus favoritos?`}
          confirmLabel="Remover"
          onConfirm={confirmRemoveFavorite}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </Shell>
  )
}
