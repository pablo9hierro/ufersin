import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutGrid, List, Loader2, Minus, Package, Plus, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import CartFab from '../components/CartFab'
import ProductDetailModal, { PromoPriceBlock, PromoRibbon, currency } from '../components/ProductDetailModal'
import FavoriteHeartButton from '../components/FavoriteHeartButton'
import ConfirmRemoveDialog from '../components/ConfirmRemoveDialog'
import { api } from '../lib/api'
import type { Category, Product } from '../lib/types'
import type { PromotionalProduct } from '../lib/supabasePublicApi'
import { useCart } from '../store/cart'
import { useCustomerAuth } from '../store/customerAuth'

// Grade estática pros itens em promoção — cada categoria da aba
// "🔥 Promoção" listava antes numa esteira que rolava sozinha; removida a
// pedido (ficava se movendo sem parar), agora é grade fixa igual o resto
// do catálogo, só com o cartão em estilo promo (Uiverse by ashwin_5681).
// Clique abre o mesmo toggle de detalhes do produto (favoritar incluso)
// em vez de navegar pra /produto/:id — mesmo comportamento do catálogo
// normal, só que também pros itens em promoção.
function PromoCards({
  products,
  promoByProduct,
  onSelect,
}: {
  products: Product[]
  promoByProduct: Map<string, PromotionalProduct>
  onSelect: (product: Product) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((product) => {
        const promo = promoByProduct.get(product.id)
        return (
          <button key={product.id} type="button" onClick={() => onSelect(product)} className="sunset-promo-card text-left relative overflow-hidden">
            {promo && <PromoRibbon promo={promo} />}
            <div className="aspect-square rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Package className="w-8 h-8 text-son-silver-dim/40" />
              )}
            </div>
            <p className="text-xs font-semibold text-white leading-snug line-clamp-2">{product.name}</p>
            {promo && <PromoPriceBlock price={product.price} promo={promo} />}
          </button>
        )
      })}
    </div>
  )
}

export default function Catalogo() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [promos, setPromos] = useState<PromotionalProduct[]>([])
  const [salesCounts, setSalesCounts] = useState<{ product_id: string; sold_count: number }[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'padrao' | 'menor_preco' | 'maior_preco' | 'mais_vendido' | 'alfabetica'>('padrao')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  // Igual em /cliente/favoritos: desmarcar pede confirmação (Uiverse.io by
  // Yaya12085), marcar não — aqui o produto não some da tela ao desmarcar
  // (é o catálogo inteiro, não uma lista só de favoritos), mas o pedido foi
  // deixar a mesma dinâmica de confirmação nos dois lugares.
  const [pendingRemove, setPendingRemove] = useState<Product | null>(null)

  const { items, addItem, changeQty } = useCart()
  const customerAuth = useCustomerAuth()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchBoxRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    Promise.all([api.products.list(), api.categories.list(), api.coupons.listPromotionalProducts(), api.products.salesCounts()])
      .then(([p, c, promo, sales]) => {
        setProducts(p)
        setCategories(c)
        setPromos(promo)
        setSalesCounts(sales)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const promo of promos) if (!map.has(promo.product_id)) map.set(promo.product_id, promo)
    return map
  }, [promos])

  // Categorias que têm pelo menos um produto em promoção — ganham o ícone
  // de fogo na própria aba, além da aba "Promoção" dedicada.
  const categoriesWithPromo = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category_id && promoByProduct.has(p.id)) set.add(p.category_id)
    return set
  }, [products, promoByProduct])

  const isPromo = categoryFilter === 'promo'

  const filtered = useMemo(() => {
    if (isPromo) return products.filter((p) => promoByProduct.has(p.id))
    if (categoryFilter === 'all') return products
    return products.filter((p) => p.category_id === categoryFilter)
  }, [products, categoryFilter, isPromo, promoByProduct])

  const salesByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of salesCounts) map.set(s.product_id, s.sold_count)
    return map
  }, [salesCounts])

  const sortedFiltered = useMemo(() => {
    if (sortBy === 'padrao') return filtered
    const arr = [...filtered]
    switch (sortBy) {
      case 'menor_preco':
        arr.sort((a, b) => a.price - b.price)
        break
      case 'maior_preco':
        arr.sort((a, b) => b.price - a.price)
        break
      case 'mais_vendido':
        arr.sort((a, b) => (salesByProduct.get(b.id) ?? 0) - (salesByProduct.get(a.id) ?? 0))
        break
      case 'alfabetica':
        arr.sort((a, b) => a.name.localeCompare(b.name))
        break
    }
    return arr
  }, [filtered, sortBy, salesByProduct])

  // Na categoria "Promoção" os itens continuam separados por categoria
  // original (Lanches, Bebidas...), só a lista de exibição é filtrada.
  const promoGroups = useMemo(() => {
    if (!isPromo) return []
    const byId = new Map(categories.map((c) => [c.id, c.name]))
    const groups = new Map<string, Product[]>()
    for (const p of sortedFiltered) {
      const label = (p.category_id && byId.get(p.category_id)) || 'Sem categoria'
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label)!.push(p)
    }
    return [...groups.entries()]
  }, [isPromo, sortedFiltered, categories])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, products])

  const clearSearch = () => {
    setSearch('')
    searchInputRef.current?.blur()
  }

  const qtyInCart = (id: string) => items.find((i) => i.productId === id)?.quantity ?? 0

  function GridCard({ product, i }: { product: Product; i: number }) {
    const inCart = qtyInCart(product.id)
    const outOfStock = product.quantity <= 0
    const promo = promoByProduct.get(product.id)
    return (
      <motion.div
        key={product.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: Math.min(i * 0.03, 0.3) }}
        className="relative bg-son-surface border border-white/5 rounded-2xl overflow-hidden flex flex-col hover:border-son-pink/30 transition-colors"
      >
        {promo && <PromoRibbon promo={promo} />}
        {customerAuth.token && (
          <div className="absolute top-2 right-2 z-10">
            <FavoriteHeartButton checked={favoriteIds.has(product.id)} onChange={() => requestToggleFavorite(product)} />
          </div>
        )}
        <button type="button" onClick={() => setDetailProduct(product)} className="flex flex-col flex-1 text-left">
          <div className="aspect-square bg-son-surface-light flex items-center justify-center overflow-hidden">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <Package className="w-10 h-10 text-son-silver-dim/40" />
            )}
          </div>
          <div className="p-3 flex flex-col gap-2 flex-1">
            <div>
              <p className="text-sm font-semibold text-white leading-snug">{product.name}</p>
              {product.category_name && <p className="text-xs font-semibold text-son-silver">{product.category_name}</p>}
            </div>
            {promo ? <PromoPriceBlock price={product.price} promo={promo} /> : <p className="sunset-text font-bold mt-auto">{currency(product.price)}</p>}
          </div>
        </button>
        <div className="px-3 pb-3">
          {outOfStock ? (
            <span className="block text-xs font-semibold text-son-silver-dim text-center py-2">Esgotado</span>
          ) : inCart > 0 ? (
            <div className="flex items-center justify-between bg-son-surface-light rounded-xl px-2 py-1">
              <button onClick={() => changeQty(product.id, -1)} className="w-7 h-7 flex items-center justify-center text-son-pink">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-semibold text-white">{inCart}</span>
              <button
                onClick={() => addItem(product)}
                disabled={inCart >= product.quantity}
                className="w-7 h-7 flex items-center justify-center text-son-pink disabled:opacity-30"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => addItem(product)}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold sunset-bg text-white rounded-xl py-2 hover:brightness-110 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar
            </button>
          )}
        </div>
      </motion.div>
    )
  }

  function ListCard({ product, i }: { product: Product; i: number }) {
    const inCart = qtyInCart(product.id)
    const outOfStock = product.quantity <= 0
    const promo = promoByProduct.get(product.id)
    return (
      <motion.div
        key={product.id}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
        className="relative bg-son-surface border border-white/5 rounded-2xl overflow-visible flex items-center gap-4 p-3 hover:border-son-pink/30 transition-colors"
      >
        {customerAuth.token && (
          <div className="absolute -top-1.5 -right-1.5 z-10">
            <FavoriteHeartButton checked={favoriteIds.has(product.id)} onChange={() => requestToggleFavorite(product)} />
          </div>
        )}
        <button
          type="button"
          onClick={() => setDetailProduct(product)}
          className="relative w-16 h-16 flex-shrink-0 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden"
        >
          {promo && (
            <div className="absolute top-0 left-0 origin-top-left scale-50">
              <PromoRibbon promo={promo} />
            </div>
          )}
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="w-6 h-6 text-son-silver-dim/40" />
          )}
        </button>
        <button type="button" onClick={() => setDetailProduct(product)} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-white truncate">{product.name}</p>
          {product.category_name && <p className="text-xs text-son-silver-dim">{product.category_name}</p>}
          {promo ? <PromoPriceBlock price={product.price} promo={promo} /> : <p className="sunset-text font-bold mt-0.5">{currency(product.price)}</p>}
        </button>
        {outOfStock ? (
          <span className="text-xs font-semibold text-son-silver-dim px-3">Esgotado</span>
        ) : inCart > 0 ? (
          <div className="flex items-center gap-1.5 bg-son-surface-light rounded-xl px-2 py-1.5">
            <button onClick={() => changeQty(product.id, -1)} className="w-6 h-6 flex items-center justify-center text-son-pink">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm w-4 text-center">{inCart}</span>
            <button
              onClick={() => addItem(product)}
              disabled={inCart >= product.quantity}
              className="w-6 h-6 flex items-center justify-center text-son-pink disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => addItem(product)}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold sunset-bg text-white rounded-xl px-3 py-2"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        )}
      </motion.div>
    )
  }

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} />
      <CartFab />
      <PageTransition className="max-w-6xl mx-auto px-5 sm:px-10 pt-6 pb-16">
        {/* From Uiverse.io by devkatyall — cores trocadas pra paleta sunset.
            O fundo opaco do input some (!bg-transparent) pra deixar o
            gradiente/feixe preto do .sunset-search-trigger aparecer atrás
            do texto; a faixa "abre" no hover (PC) ou ao focar a busca no
            celular (reaproveita o searchOpen que já existia). */}
        <div className={`sunset-search-trigger relative mb-6 rounded-2xl ${searchOpen ? 'is-open' : ''}`} ref={searchBoxRef}>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-son-silver-dim pointer-events-none" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder="Buscar produto..."
            className="input-field pl-10 pr-10 !bg-transparent"
          />
          {search && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-son-silver-dim hover:text-white"
              aria-label="Limpar busca"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {searchOpen && search.trim().length > 0 && (
            <div className="absolute z-20 mt-2 w-full max-h-80 overflow-y-auto glass rounded-2xl py-1 shadow-xl">
              {searchResults.length === 0 ? (
                <p className="text-sm text-son-silver-dim px-4 py-3">Nenhum produto encontrado.</p>
              ) : (
                searchResults.map((p) => (
                  <Link
                    key={p.id}
                    to={`/produto/${p.id}`}
                    onClick={() => {
                      setSearch('')
                      setSearchOpen(false)
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors"
                  >
                    <div className="w-11 h-11 flex-shrink-0 rounded-lg bg-son-surface-light flex items-center justify-center overflow-hidden">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-4 h-4 text-son-silver-dim/40" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                      {p.description && <p className="text-xs text-son-silver-dim truncate">{p.description}</p>}
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>

        {/* Uiverse.io by Yaya12085 — pílulas de radio dentro de uma trilha
            com fundo próprio (era #EEE claro; aqui escuro, pro tema do
            site), item ativo ganhando um fundo que contrasta com a
            trilha + transição suave (era instantâneo via :checked). Os
            estados ativo/inativo de cada categoria continuam exatamente
            como já eram (sunset-bg / laranja pra "Promoção") — só a
            "trilha" ao redor e a forma/transição de cada pílula vêm da
            referência. */}
        <div className="sunset-tabs overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`sunset-tab flex-shrink-0 ${categoryFilter === 'all' ? 'sunset-tab-active text-white' : 'text-son-silver hover:text-white'}`}
          >
            Todos
          </button>
          {promoByProduct.size > 0 && (
            <button
              onClick={() => setCategoryFilter('promo')}
              className={`sunset-tab flex-shrink-0 font-bold ${isPromo ? 'sunset-tab-active text-orange-400' : 'text-orange-400 hover:text-orange-300'}`}
            >
              🔥 Promoção
            </button>
          )}
          {categories.map((c) => {
            const hasPromo = categoriesWithPromo.has(c.id)
            const active = categoryFilter === c.id
            return (
              <button
                key={c.id}
                onClick={() => setCategoryFilter(c.id)}
                className={`sunset-tab flex-shrink-0 ${
                  hasPromo
                    ? active
                      ? 'sunset-tab-active text-orange-400 font-bold'
                      : 'text-orange-400 hover:text-orange-300 font-bold'
                    : active
                      ? 'sunset-tab-active text-white'
                      : 'text-son-silver hover:text-white'
                }`}
              >
                {hasPromo && '🔥 '}
                {c.name}
              </button>
            )
          })}
        </div>

        {/* Painel translúcido com blur atrás de todo o resultado (ordenação +
            cards) — sem isso o fundo synthwave/coqueiro aparecia cru demais
            entre os cards, ficando sem contraste nenhum. Topo reto de
            propósito — encosta direto nas abas acima (truque de fusão
            german_7619). */}
        <div className="glass rounded-b-3xl p-4 sm:p-6">
          {!loading && filtered.length > 0 && (
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
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="input-field w-auto py-2 text-xs appearance-none cursor-pointer pr-8"
                aria-label="Ordenar produtos"
              >
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
              <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-son-silver-dim">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum produto disponível no momento.</p>
            </div>
          ) : isPromo ? (
            <div className="flex flex-col gap-6">
              {promoGroups.map(([label, groupProducts]) => (
                <div key={label}>
                  <h2 className="text-sm font-bold text-son-silver uppercase tracking-wide mb-3">{label}</h2>
                  <PromoCards products={groupProducts} promoByProduct={promoByProduct} onSelect={setDetailProduct} />
                </div>
              ))}
            </div>
          ) : view === 'grid' ? (
            <div className="catalogo-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {sortedFiltered.map((product, i) => (
                <GridCard key={product.id} product={product} i={i} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sortedFiltered.map((product, i) => (
                <ListCard key={product.id} product={product} i={i} />
              ))}
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
            isFavorite={favoriteIds.has(detailProduct.id)}
            onToggleFavorite={customerAuth.token ? () => requestToggleFavorite(detailProduct) : null}
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
            onConfirm={confirmRemoveFavorite}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </AnimatePresence>
    </main>
  )
}
