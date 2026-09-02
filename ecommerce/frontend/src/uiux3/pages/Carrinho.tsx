import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '../../lib/tenantRouter'
import { Grid2x2, List, Minus, Package, Plus, Trash2 } from 'lucide-react'
import { useProducts } from '../../hooks/useProducts'
import { favoriteService } from '../../services/favoriteService'
import type { Product } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import FavoriteButton from '../components/FavoriteButton'
import ConfirmDialog from '../components/ConfirmDialog'
import AuthModal from '../components/AuthModal'

// Referência estável enquanto os dados ainda não chegaram -- ver mesma
// nota em pages/Catalogo.tsx (Sunset).
const EMPTY_PRODUCTS: Product[] = []

export default function Uiux3Carrinho() {
  const navigate = useNavigate()
  const { items, changeQty, removeItem } = useCart()
  const { data: productsData, loading } = useProducts()
  const products = productsData ?? EMPTY_PRODUCTS
  const customerAuth = useCustomerAuth()

  const [view, setView] = useState<'list' | 'grid'>('list')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)

  useEffect(() => {
    if (!customerAuth.token) return
    favoriteService
      .list(customerAuth.token)
      .then((favs) => setFavoriteIds(new Set(favs.map((p) => p.id))))
      .catch(() => {})
  }, [customerAuth.token])

  const doToggleFavorite = (productId: string) => {
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

  // Favoritar exige login; sem sessão abre o modal. Logado: marcar direto;
  // desfavoritar sempre abre o diálogo de confirmação.
  const handleToggleFavorite = (product: Product) => {
    if (!customerAuth.token) {
      setShowAuthModal(true)
      return
    }
    if (favoriteIds.has(product.id)) {
      setPendingRemove(product)
      return
    }
    doToggleFavorite(product.id)
  }

  const confirmRemoveFavorite = () => {
    if (!pendingRemove) return
    doToggleFavorite(pendingRemove.id)
    setPendingRemove(null)
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
            <button
              onClick={() => setView('list')}
              aria-label="Ver em lista"
              aria-pressed={view === 'list'}
              className={view === 'list' ? 'u3-icon-btn u3-icon-btn-accent' : 'u3-icon-btn'}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('grid')}
              aria-label="Ver em grade"
              aria-pressed={view === 'grid'}
              className={view === 'grid' ? 'u3-icon-btn u3-icon-btn-accent' : 'u3-icon-btn'}
            >
              <Grid2x2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {view === 'list' ? (
          <ul className="space-y-3 mb-6">
            {lines.map(({ item, product }) => (
              <li key={product.id} className="u3-panel flex items-center gap-3 p-3">
                <Link to={`/produto/${product.id}`} className="w-14 h-14 shrink-0 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: 'var(--u3-surface-light)' }}>
                  {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <Package className="w-5 h-5 u3-dim" />}
                </Link>
                <Link to={`/produto/${product.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs u3-dim">{currency(product.price)} cada</p>
                </Link>
                <FavoriteButton checked={favoriteIds.has(product.id)} onClick={() => handleToggleFavorite(product)} />
                <div className="flex items-center gap-1.5">
                  <button onClick={() => changeQty(product.id, -1, product.quantity)} aria-label="Diminuir" className="w-7 h-7 flex items-center justify-center u3-dim">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-sm w-5 text-center">{item.quantity}</span>
                  <button onClick={() => changeQty(product.id, 1, product.quantity)} disabled={item.quantity >= product.quantity} aria-label="Aumentar" className="w-7 h-7 flex items-center justify-center u3-dim disabled:opacity-30">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeItem(product.id)} aria-label="Remover" className="u3-dim ml-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {lines.map(({ item, product }) => (
              <div key={product.id} className="u3-panel p-3 flex flex-col gap-2">
                <div className="relative">
                  <Link to={`/produto/${product.id}`} className="aspect-square rounded-lg overflow-hidden flex items-center justify-center" style={{ background: 'var(--u3-surface-light)' }}>
                    {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <Package className="w-6 h-6 u3-dim" />}
                  </Link>
                  <div className="absolute top-1.5 right-1.5">
                    <FavoriteButton checked={favoriteIds.has(product.id)} onClick={() => handleToggleFavorite(product)} />
                  </div>
                </div>
                <Link to={`/produto/${product.id}`}>
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs u3-dim">{currency(product.price)} cada</p>
                </Link>
                <div className="flex items-center justify-between gap-1.5">
                  <button onClick={() => changeQty(product.id, -1, product.quantity)} aria-label="Diminuir" className="w-7 h-7 flex items-center justify-center u3-dim">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-sm">{item.quantity}</span>
                  <button onClick={() => changeQty(product.id, 1, product.quantity)} disabled={item.quantity >= product.quantity} aria-label="Aumentar" className="w-7 h-7 flex items-center justify-center u3-dim disabled:opacity-30">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removeItem(product.id)} aria-label="Remover" className="u3-dim">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="u3-panel flex items-center justify-between p-4 mb-5">
          <span className="font-bold">Total</span>
          <span className="u3-accent font-black text-lg">{currency(total)}</span>
        </div>

        <button onClick={() => navigate('/checkout')} className="u3-pill-primary w-full text-base py-3.5">
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
        {showAuthModal && (
          <AuthModal initialMode="login" onClose={() => setShowAuthModal(false)} onSuccess={() => setShowAuthModal(false)} />
        )}
      </div>
    </Shell>
  )
}
