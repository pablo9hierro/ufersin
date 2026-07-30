import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Search, X } from 'lucide-react'
import { productService } from '../../services/productService'
import { categoryService } from '../../services/categoryService'
import { favoriteService } from '../../services/favoriteService'
import { couponService } from '../../services/couponService'
import type { Category, Product, PromotionalProduct } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import ProductCard from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Uiux2Catalogo() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [promoProducts, setPromoProducts] = useState<PromotionalProduct[]>([])
  const [salesCounts, setSalesCounts] = useState<{ product_id: string; sold_count: number }[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'padrao' | 'menor_preco' | 'maior_preco' | 'mais_vendido' | 'alfabetica'>('padrao')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  // Marcar favorito é direto; desmarcar pede confirmação primeiro -- nunca
  // desfavorita silenciosamente.
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  const { items, addItem, changeQty } = useCart()
  const customerAuth = useCustomerAuth()

  useEffect(() => {
    Promise.all([productService.list(), categoryService.list(), couponService.listPromotionalProducts().catch(() => []), productService.salesCounts().catch(() => [])])
      .then(([p, c, promos, sales]) => {
        setProducts(p)
        setCategories(c)
        setPromoProducts(promos)
        setSalesCounts(sales)
      })
      .finally(() => setLoading(false))
  }, [])

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

  // Favoritar é direto; desfavoritar abre o diálogo de confirmação.
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

  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const p of promoProducts) if (!map.has(p.product_id)) map.set(p.product_id, p)
    return map
  }, [promoProducts])

  const salesByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of salesCounts) map.set(s.product_id, s.sold_count)
    return map
  }, [salesCounts])

  // Categorias com pelo menos um produto em promoção ganham um sinal na
  // própria aba, mesmo fora da aba "Promoção" (sinalização cruzada).
  const categoriesWithPromo = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category_id && promoByProduct.has(p.id)) set.add(p.category_id)
    return set
  }, [products, promoByProduct])

  const isPromo = categoryFilter === 'promo'

  const filtered = useMemo(() => {
    const base = isPromo ? products.filter((p) => promoByProduct.has(p.id)) : categoryFilter === 'all' ? products : products.filter((p) => p.category_id === categoryFilter)
    const q = search.trim().toLowerCase()
    return q ? base.filter((p) => p.name.toLowerCase().includes(q)) : base
  }, [products, categoryFilter, isPromo, promoByProduct, search])

  const sortedFiltered = useMemo(() => {
    if (sortBy === 'padrao') return filtered
    const arr = [...filtered]
    if (sortBy === 'menor_preco') arr.sort((a, b) => a.price - b.price)
    if (sortBy === 'maior_preco') arr.sort((a, b) => b.price - a.price)
    if (sortBy === 'mais_vendido') arr.sort((a, b) => (salesByProduct.get(b.id) ?? 0) - (salesByProduct.get(a.id) ?? 0))
    if (sortBy === 'alfabetica') arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [filtered, sortBy, salesByProduct])

  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-10">
        <div className="u2-surface relative flex items-center px-3.5 py-2.5 mb-4">
          <Search className="w-4 h-4 u2-dim shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto..." className="flex-1 bg-transparent outline-none text-sm px-2.5" />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Limpar busca" className="u2-dim">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 mb-4" style={{ scrollbarWidth: 'none' }}>
          <button onClick={() => setCategoryFilter('all')} className={categoryFilter === 'all' ? 'u2-btn-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u2-btn-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
            Todos
          </button>
          {promoByProduct.size > 0 && (
            <button onClick={() => setCategoryFilter('promo')} className={isPromo ? 'u2-btn-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u2-btn-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
              Promoção
            </button>
          )}
          {categories.map((c) => {
            const hasPromo = categoriesWithPromo.has(c.id)
            const active = categoryFilter === c.id
            return (
              <button key={c.id} onClick={() => setCategoryFilter(c.id)} className={active ? 'u2-btn-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u2-btn-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
                {c.name}
                {hasPromo && <span className="u2-accent ml-1">•</span>}
              </button>
            )
          })}
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex justify-end mb-3">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="u2-surface text-xs px-3 py-2 outline-none" aria-label="Ordenar produtos">
              <option value="padrao">Ordenar por...</option>
              <option value="menor_preco">Menor preço</option>
              <option value="maior_preco">Maior preço</option>
              <option value="mais_vendido">Mais vendido</option>
              <option value="alfabetica">Alfabética (A-Z)</option>
            </select>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Package} message="Nenhum produto encontrado." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {sortedFiltered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                qty={qtyInCart(product.id)}
                isFavorite={favoriteIds.has(product.id)}
                onToggleFavorite={customerAuth.token ? () => requestToggleFavorite(product) : undefined}
                onAdd={() => addItem(product)}
                onRemove={() => changeQty(product.id, -1)}
                promo={promoByProduct.get(product.id)}
              />
            ))}
          </div>
        )}
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
