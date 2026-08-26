import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Minus, Package, Plus, Search, ShoppingBag } from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { withTenantSearch } from '../../lib/tenantConfig'
import { productService } from '../../services/productService'
import { useCart } from '../../store/cart'
import type { Product } from '../../types'

// Port 1:1 de src/app/loja/LojaClient.tsx do vrtech -- vitrine de produtos
// físicos (peças/acessórios), mesmo layout/cores. StoreLink -> Link do
// react-router; cart real do vrtech (@/lib/carrinho/context, item genérico
// product/service) -> useCart nativo do motor (só suporta Product, mas é a
// MESMA fonte de dados -- ecommerce-api/products -- então é reaproveitável
// sem inventar nada). Sem link pra "/loja/:id" (detalhe de produto) porque
// não existe página de detalhe nativa pro ramo eletrônica ainda -- o card
// inteiro já mostra o essencial e "Adicionar" é a ação real.
// AccordionTags omitido: Product (types/product.ts) não tem campo `tags`
// nesse motor (só existe no vrtech original), não tem o que exibir.

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function EletronicaLoja() {
  const tenantConfig = useTenantConfig()
  const lojaNome = tenantConfig?.loja_nome || 'VR Tech'
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const { items, addItem, changeQty } = useCart()

  useEffect(() => {
    productService
      .list()
      .then((p) => setAllProducts(p.slice().sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of allProducts) if (p.category_name) set.add(p.category_name)
    return Array.from(set).sort()
  }, [allProducts])

  const filteredProducts = useMemo(() => {
    let base = categoryFilter === 'all' ? allProducts : allProducts.filter((p) => p.category_name === categoryFilter)
    const q = search.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    )
  }, [allProducts, categoryFilter, search])

  const qtyInCart = (productId: string) => items.find((i) => i.productId === productId)?.quantity ?? 0
  const count = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <header className="px-5 sm:px-10 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Link
            to={`/${withTenantSearch()}`}
            className="flex items-center gap-1.5 text-sm font-medium text-[#d4d4d8] hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Início</span>
          </Link>
          <Link to={`/${withTenantSearch()}`} className="font-black text-lg">
            {tenantConfig?.logo_url ? (
              <img src={tenantConfig.logo_url} alt={lojaNome} width={40} height={40} className="rounded-lg block" />
            ) : (
              lojaNome
            )}
          </Link>
        </div>
        <Link
          to={`/carrinho${withTenantSearch()}`}
          className="relative flex items-center gap-2 bg-[#161618] border border-white/10 rounded-xl px-4 py-2.5 hover:border-[#e0211a]/40 transition-colors"
        >
          <ShoppingBag className="w-4 h-4 text-[#e0211a]" />
          <span className="text-sm font-medium text-white">Sacola</span>
          {count > 0 && (
            <span className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center text-xs font-bold bg-[#e0211a] text-white rounded-full">
              {count}
            </span>
          )}
        </Link>
      </header>

      <div className="max-w-6xl mx-auto px-5 sm:px-10 pb-16">
        <h1 className="text-2xl sm:text-3xl font-black mb-1">Catálogo</h1>
        <p className="text-[#d4d4d8]/60 text-sm mb-6">Escolha os produtos e finalize pela sacola.</p>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#d4d4d8]/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto..."
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#161618] border border-white/10 text-white placeholder-[#d4d4d8]/40 text-sm focus:outline-none focus:border-[#e0211a]/50"
          />
        </div>

        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-6">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all
                ${categoryFilter === 'all' ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#161618]/80'}`}
            >
              Todos
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all
                  ${categoryFilter === c ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#161618]/80'}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="text-center py-20 text-[#d4d4d8]/40">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum produto disponível no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.map((product) => {
              const inCart = qtyInCart(product.id)
              const outOfStock = Number(product.quantity) <= 0
              return (
                <div key={product.id} className="bg-white rounded-2xl overflow-hidden shadow-xl flex flex-col">
                  <div className="flex flex-col flex-1">
                    <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-10 h-10 text-gray-300" />
                      )}
                    </div>
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 leading-snug">{product.name}</p>
                        {product.category_name && <p className="text-xs text-gray-400">{product.category_name}</p>}
                        {product.description && (
                          <p className="text-xs text-gray-500 line-clamp-2 mt-1">{product.description}</p>
                        )}
                      </div>
                      <p className="text-[#e0211a] font-bold mt-auto">{currency(Number(product.price))}</p>
                    </div>
                  </div>

                  <div className="px-3 pb-3">
                    {outOfStock ? (
                      <span className="block text-xs font-semibold text-gray-400 text-center py-2">Esgotado</span>
                    ) : inCart > 0 ? (
                      <div className="flex items-center justify-between bg-gray-50 rounded-xl px-2 py-1">
                        <button
                          onClick={() => changeQty(product.id, -1)}
                          className="w-7 h-7 flex items-center justify-center text-[#e0211a]"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-semibold text-gray-800">{inCart}</span>
                        <button
                          onClick={() => addItem(product)}
                          disabled={inCart >= Number(product.quantity)}
                          className="w-7 h-7 flex items-center justify-center text-[#e0211a] disabled:opacity-30"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addItem(product as Product)}
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-[#e0211a] hover:bg-[#a3140f] text-white rounded-xl py-2 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
