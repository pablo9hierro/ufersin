import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '../../lib/tenantRouter'
import { LayoutGrid, List, Minus, Package, Plus, Trash2 } from 'lucide-react'
import { useProducts } from '../../hooks/useProducts'
import { favoriteService } from '../../services/favoriteService'
import type { Product } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import ProductCard, { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import FavoriteButton from '../components/FavoriteButton'

// Referência estável enquanto os dados ainda não chegaram -- ver mesma
// nota em pages/Catalogo.tsx (Sunset).
const EMPTY_PRODUCTS: Product[] = []

export default function Uiux4Carrinho() {
  const navigate = useNavigate()
  const { items, changeQty, removeItem, addItem } = useCart()
  const { data: productsData, loading } = useProducts()
  const products = productsData ?? EMPTY_PRODUCTS
  const customerAuth = useCustomerAuth()

  const [view, setView] = useState<'list' | 'grid'>('list')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
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

  // Favoritar é direto; desfavoritar sempre pede confirmação primeiro --
  // o item do carrinho continua visível depois de confirmar a remoção.
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
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-black">Sua sacola</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setView('list')} aria-label="Ver em lista" aria-pressed={view === 'list'} className={`u4-icon-btn ${view === 'list' ? 'is-active' : ''}`}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setView('grid')} aria-label="Ver em grade" aria-pressed={view === 'grid'} className={`u4-icon-btn ${view === 'grid' ? 'is-active' : ''}`}>
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        {view === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {lines.map(({ item, product }) => (
              <ProductCard
                key={product.id}
                product={product}
                qty={item.quantity}
                isFavorite={favoriteIds.has(product.id)}
                onToggleFavorite={customerAuth.token ? () => requestToggleFavorite(product) : undefined}
                onAdd={() => addItem(product)}
                onRemove={() => changeQty(product.id, -1)}
              />
            ))}
          </div>
        ) : (
          <ul className="space-y-3 mb-6">
            {lines.map(({ item, product }) => (
              <li key={product.id} className="u4-panel flex items-center gap-3 p-3">
                <Link to={`/produto/${product.id}`} className="w-14 h-14 shrink-0 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: 'var(--u4-surface-light)' }}>
                  {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-5 h-5 u4-dim" />}
                </Link>
                <Link to={`/produto/${product.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs u4-dim">{currency(product.price)} cada</p>
                </Link>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => changeQty(product.id, -1, product.quantity)} aria-label="Diminuir" className="w-7 h-7 flex items-center justify-center u4-dim">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-sm w-5 text-center">{item.quantity}</span>
                  <button onClick={() => changeQty(product.id, 1, product.quantity)} disabled={item.quantity >= product.quantity} aria-label="Aumentar" className="w-7 h-7 flex items-center justify-center u4-dim disabled:opacity-30">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {customerAuth.token && <FavoriteButton checked={favoriteIds.has(product.id)} onClick={() => requestToggleFavorite(product)} />}
                  <button onClick={() => removeItem(product.id)} aria-label="Remover" className="u4-dim ml-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="u4-panel flex items-center justify-between p-4 mb-5">
          <span className="font-bold">Total</span>
          <span className="u4-accent font-black text-lg">{currency(total)}</span>
        </div>

        <button onClick={() => navigate('/checkout')} className="u4-btn-primary w-full text-base py-3.5">
          Continuar para o checkout
        </button>

        {pendingRemove && (
          <ConfirmDialog
            title="Remover dos favoritos"
            message={`Tem certeza que quer remover "${pendingRemove.name}" dos seus favoritos?`}
            confirmLabel="Remover"
            onConfirm={confirmRemoveFavorite}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </div>
    </Shell>
  )
}
