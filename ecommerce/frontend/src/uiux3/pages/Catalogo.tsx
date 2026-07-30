import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Search, X } from 'lucide-react'
import { productService } from '../../services/productService'
import { categoryService } from '../../services/categoryService'
import { favoriteService } from '../../services/favoriteService'
import type { Category, Product } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import ProductCard from '../components/ProductCard'
import ListRow from '../components/ListRow'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'

// Catálogo em DUAS camadas, igual à referência: "Destaques" (poucos
// itens em cartão grande, foto-protagonista) + "Cardápio" (resto em
// lista compacta, ListRow.tsx). O Ufersin nativo usa uma grade uniforme
// só -- aqui a estrutura em si é diferente, não só a cor.
export default function Uiux3Catalogo() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'padrao' | 'menor_preco' | 'maior_preco' | 'mais_vendido' | 'alfabetica'>('padrao')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [salesCounts, setSalesCounts] = useState<Map<string, number>>(new Map())
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  const { items, addItem, changeQty } = useCart()
  const customerAuth = useCustomerAuth()

  useEffect(() => {
    Promise.all([productService.list(), categoryService.list()])
      .then(([p, c]) => {
        setProducts(p)
        setCategories(c)
      })
      .finally(() => setLoading(false))
    productService
      .salesCounts()
      .then((counts) => setSalesCounts(new Map(counts.map((c) => [c.product_id, c.sold_count]))))
      .catch(() => {})
  }, [])

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

  // Favoritar é direto e sem confirmação; desfavoritar sempre abre o
  // diálogo de confirmação primeiro (nunca remove direto no clique).
  const handleToggleFavorite = (product: Product) => {
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

  const filtered = useMemo(() => {
    const base = categoryFilter === 'all' ? products : products.filter((p) => p.category_id === categoryFilter)
    const q = search.trim().toLowerCase()
    const searched = q ? base.filter((p) => p.name.toLowerCase().includes(q)) : base
    if (sortBy === 'padrao') return searched
    const arr = [...searched]
    if (sortBy === 'menor_preco') arr.sort((a, b) => a.price - b.price)
    if (sortBy === 'maior_preco') arr.sort((a, b) => b.price - a.price)
    if (sortBy === 'mais_vendido') arr.sort((a, b) => (salesCounts.get(b.id) ?? 0) - (salesCounts.get(a.id) ?? 0))
    if (sortBy === 'alfabetica') arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [products, categoryFilter, search, sortBy, salesCounts])

  const destaques = filtered.slice(0, 2)
  const resto = filtered.slice(2)
  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-10">
        <div className="rounded-full flex items-center px-4 py-3 mb-4" style={{ background: 'var(--u3-surface)' }}>
          <Search className="w-4 h-4 u3-dim shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no cardápio..." className="flex-1 bg-transparent outline-none text-sm px-2.5" />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Limpar busca" className="u3-dim">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 mb-4" style={{ scrollbarWidth: 'none' }}>
          <button onClick={() => setCategoryFilter('all')} className={categoryFilter === 'all' ? 'u3-pill-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u3-pill-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
            Todos
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCategoryFilter(c.id)} className={categoryFilter === c.id ? 'u3-pill-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u3-pill-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
              {c.name}
            </button>
          ))}
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex justify-end mb-3">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="rounded-full text-xs px-3.5 py-2 outline-none" style={{ background: 'var(--u3-surface)' }} aria-label="Ordenar produtos">
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
            <Loader2 className="w-6 h-6 animate-spin u3-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Package} message="Nenhum produto encontrado." />
        ) : (
          <>
            {destaques.length > 0 && (
              <>
                <p className="font-black text-sm uppercase tracking-wide u3-dim mb-3">Destaques</p>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {destaques.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      qty={qtyInCart(product.id)}
                      isFavorite={favoriteIds.has(product.id)}
                      onToggleFavorite={customerAuth.token ? () => handleToggleFavorite(product) : undefined}
                      onAdd={() => addItem(product)}
                      onRemove={() => changeQty(product.id, -1)}
                    />
                  ))}
                </div>
              </>
            )}
            {resto.length > 0 && (
              <>
                <p className="font-black text-sm uppercase tracking-wide u3-dim mb-3">Cardápio</p>
                <div className="space-y-2">
                  {resto.map((product, i) => (
                    <ListRow
                      key={product.id}
                      product={product}
                      qty={qtyInCart(product.id)}
                      popular={i === 0}
                      isFavorite={favoriteIds.has(product.id)}
                      onToggleFavorite={customerAuth.token ? () => handleToggleFavorite(product) : undefined}
                      onAdd={() => addItem(product)}
                      onRemove={() => changeQty(product.id, -1)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
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
