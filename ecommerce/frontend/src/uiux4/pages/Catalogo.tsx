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

type SortBy = 'padrao' | 'menor_preco' | 'maior_preco' | 'mais_vendido' | 'alfabetica'

// Catálogo em GRADE DE AZULEJOS quadrados com ABAS de categoria em pílula
// sólida laranja no item ativo (igual à referência) -- estrutura bem
// diferente da grade uniforme do Ufersin nativo e da dupla grade+lista
// do BurgerBite.
export default function Uiux4Catalogo() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [promos, setPromos] = useState<PromotionalProduct[]>([])
  const [salesCounts, setSalesCounts] = useState<{ product_id: string; sold_count: number }[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<SortBy>('padrao')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  // Igual em /cliente/favoritos: desmarcar pede confirmação, marcar não --
  // aqui o produto não some da tela ao desmarcar (é o catálogo inteiro).
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  const { items, addItem, changeQty } = useCart()
  const customerAuth = useCustomerAuth()

  useEffect(() => {
    Promise.all([productService.list(), categoryService.list(), couponService.listPromotionalProducts().catch(() => []), productService.salesCounts().catch(() => [])])
      .then(([p, c, promoList, counts]) => {
        setProducts(p)
        setCategories(c)
        setPromos(promoList)
        setSalesCounts(counts)
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

  // Favoritar é direto; desfavoritar sempre pede confirmação primeiro.
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
    for (const promo of promos) if (!map.has(promo.product_id)) map.set(promo.product_id, promo)
    return map
  }, [promos])

  // Categorias que têm pelo menos 1 produto em promoção -- sinal cruzado
  // na própria aba, mesmo fora da aba "Promoção".
  const categoriesWithPromo = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category_id && promoByProduct.has(p.id)) set.add(p.category_id)
    return set
  }, [products, promoByProduct])

  const salesByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of salesCounts) map.set(s.product_id, s.sold_count)
    return map
  }, [salesCounts])

  const isPromo = categoryFilter === 'promo'

  const filtered = useMemo(() => {
    const base = isPromo ? products.filter((p) => promoByProduct.has(p.id)) : categoryFilter === 'all' ? products : products.filter((p) => p.category_id === categoryFilter)
    const q = search.trim().toLowerCase()
    const searched = q ? base.filter((p) => p.name.toLowerCase().includes(q)) : base
    if (sortBy === 'padrao') return searched
    const arr = [...searched]
    if (sortBy === 'menor_preco') arr.sort((a, b) => a.price - b.price)
    if (sortBy === 'maior_preco') arr.sort((a, b) => b.price - a.price)
    if (sortBy === 'mais_vendido') arr.sort((a, b) => (salesByProduct.get(b.id) ?? 0) - (salesByProduct.get(a.id) ?? 0))
    if (sortBy === 'alfabetica') arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [products, categoryFilter, isPromo, promoByProduct, search, sortBy, salesByProduct])

  const hasPromo = promoByProduct.size > 0
  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-10">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setCategoryFilter('all')} className={`u4-tab shrink-0 px-4 py-1.5 text-xs ${categoryFilter === 'all' ? 'is-active' : ''}`}>
              Todos
            </button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setCategoryFilter(c.id)} className={`u4-tab shrink-0 px-4 py-1.5 text-xs flex items-center gap-1 ${categoryFilter === c.id ? 'is-active' : ''}`}>
                {c.name}
                {categoriesWithPromo.has(c.id) && <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--u4-orange)' }} aria-hidden="true" />}
              </button>
            ))}
            {hasPromo && (
              <button onClick={() => setCategoryFilter('promo')} className={`u4-tab shrink-0 px-4 py-1.5 text-xs ${categoryFilter === 'promo' ? 'is-active' : ''}`}>
                Promoção
              </button>
            )}
          </div>
          <button onClick={() => setSearchOpen((o) => !o)} className="u4-icon-btn shrink-0" aria-label="Buscar">
            {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
          </button>
        </div>

        {searchOpen && (
          <div className="u4-input flex items-center px-3.5 py-2.5 mb-4">
            <Search className="w-4 h-4 u4-dim shrink-0" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no cardápio..." className="flex-1 bg-transparent outline-none text-sm px-2.5" />
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex justify-end mb-3">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="u4-input text-xs px-3 py-2 outline-none" aria-label="Ordenar produtos">
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
            <Loader2 className="w-6 h-6 animate-spin u4-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Package} message="Nenhum produto encontrado." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                qty={qtyInCart(product.id)}
                isFavorite={favoriteIds.has(product.id)}
                onToggleFavorite={customerAuth.token ? () => requestToggleFavorite(product) : undefined}
                onAdd={() => addItem(product)}
                onRemove={() => changeQty(product.id, -1)}
              />
            ))}
          </div>
        )}

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
