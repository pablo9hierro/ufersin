import { useState } from 'react'
import { Package, Search, Tag, X } from 'lucide-react'
import type { Category, DiscountType, Product, ProductDiscount } from '../../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// Sempre mostra o valor nos dois formatos — se o admin digitou em R$, o %
// equivalente some entre parênteses do lado, e vice-versa.
function equivalentLabel(price: number, type: DiscountType, value: number) {
  if (!price || !value) return ''
  if (type === 'percent') return `(${currency((price * value) / 100)})`
  return `(${Math.min((value / price) * 100, 100).toFixed(1).replace('.', ',')}%)`
}

export default function ProductDiscountList({
  products,
  categories,
  discounts,
  onChange,
}: {
  products: Product[]
  // Opcional — quando passado, mostra uma busca separada pra adicionar uma
  // categoria inteira de uma vez, com UM desconto só pra categoria toda
  // (não um desconto por produto). O backend só entende desconto por
  // produto, então por baixo dos panos ainda vira uma linha de
  // ProductDiscount por produto — só que todas marcadas com o mesmo
  // category_id (campo client-only) pra renderizar agrupado como
  // "Categoria: Nome" e editar/remover tudo junto.
  categories?: Category[]
  discounts: ProductDiscount[]
  onChange: (discounts: ProductDiscount[]) => void
}) {
  const [query, setQuery] = useState('')
  const [infoProduct, setInfoProduct] = useState<Product | null>(null)
  const [categoryProducts, setCategoryProducts] = useState<{ name: string; products: Product[] } | null>(null)

  const productById = new Map(products.map((p) => [p.id, p]))
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))

  const individual = discounts.filter((d) => !d.category_id).map((d) => ({ discount: d, product: productById.get(d.product_id) })).filter((x) => x.product)

  const categoryGroups = Array.from(new Set(discounts.filter((d) => d.category_id).map((d) => d.category_id!))).map((categoryId) => {
    const rows = discounts.filter((d) => d.category_id === categoryId)
    const categoryProductList = rows.map((d) => productById.get(d.product_id)).filter((p): p is Product => !!p)
    return { categoryId, name: categoryById.get(categoryId)?.name ?? categoryId, rows, products: categoryProductList }
  })

  const selectedProductIds = new Set(discounts.map((d) => d.product_id))
  const selectedCategoryIds = new Set(categoryGroups.map((g) => g.categoryId))
  const q = query.trim().toLowerCase()
  const matches =
    q.length > 0
      ? products.filter((p) => !selectedProductIds.has(p.id) && (p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q)))).slice(0, 6)
      : []
  const categoryMatches =
    categories && q.length > 0
      ? categories.filter((c) => !selectedCategoryIds.has(c.id) && c.name.toLowerCase().includes(q)).slice(0, 4)
      : []

  const addProduct = (id: string) => {
    onChange([...discounts, { product_id: id, discount_type: 'percent', discount_value: 0 }])
    setQuery('')
  }
  const addCategory = (categoryId: string) => {
    const newOnes = products
      .filter((p) => p.category_id === categoryId && !selectedProductIds.has(p.id))
      .map((p) => ({ product_id: p.id, discount_type: 'percent' as DiscountType, discount_value: 0, category_id: categoryId }))
    if (newOnes.length > 0) onChange([...discounts, ...newOnes])
    setQuery('')
  }
  const removeProduct = (id: string) => onChange(discounts.filter((d) => d.product_id !== id))
  const removeCategory = (categoryId: string) => onChange(discounts.filter((d) => d.category_id !== categoryId))
  const updateDiscount = (id: string, patch: Partial<ProductDiscount>) =>
    onChange(discounts.map((d) => (d.product_id === id ? { ...d, ...patch } : d)))
  // Um desconto só pra categoria inteira — atualiza todas as linhas do
  // grupo de uma vez, mantendo o valor sincronizado entre elas.
  const updateCategoryDiscount = (categoryId: string, patch: Partial<Pick<ProductDiscount, 'discount_type' | 'discount_value'>>) =>
    onChange(discounts.map((d) => (d.category_id === categoryId ? { ...d, ...patch } : d)))

  return (
    <div>
      {(categoryGroups.length > 0 || individual.length > 0) && (
        <div className="space-y-2 mb-2">
          {categoryGroups.map(({ categoryId, name, rows, products: groupProducts }) => {
            const first = rows[0]
            return (
              <div key={categoryId} className="flex items-center gap-2 bg-son-surface-light rounded-xl p-2">
                <button
                  type="button"
                  onClick={() => setCategoryProducts({ name, products: groupProducts })}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-xs text-white truncate">
                    Categoria: <span className="font-semibold">{name}</span>
                  </p>
                  <p className="text-xs text-son-silver-dim">{rows.length} produto(s) — clique pra ver</p>
                </button>
                <select
                  className="input-field w-20 py-1.5 text-xs appearance-none cursor-pointer flex-shrink-0"
                  value={first.discount_type}
                  onChange={(e) => updateCategoryDiscount(categoryId, { discount_type: e.target.value as DiscountType })}
                >
                  <option value="percent">%</option>
                  <option value="fixed">R$</option>
                </select>
                <input
                  className="input-field w-20 py-1.5 text-xs flex-shrink-0"
                  type="number"
                  min="0"
                  value={first.discount_value || ''}
                  onChange={(e) => updateCategoryDiscount(categoryId, { discount_value: Number(e.target.value) })}
                />
                <button type="button" onClick={() => removeCategory(categoryId)} className="flex-shrink-0">
                  <X className="w-3.5 h-3.5 text-son-silver-dim hover:text-son-pink" />
                </button>
              </div>
            )
          })}
          {individual.map(({ discount, product }) => {
            const p = product!
            const finalPrice =
              discount.discount_type === 'percent'
                ? Math.max(p.price - (p.price * discount.discount_value) / 100, 0)
                : Math.max(p.price - discount.discount_value, 0)
            return (
              <div key={p.id} className="flex items-center gap-2 bg-son-surface-light rounded-xl p-2">
                <button
                  type="button"
                  onClick={() => setInfoProduct(p)}
                  className="w-10 h-10 rounded-lg bg-son-surface flex items-center justify-center overflow-hidden flex-shrink-0"
                >
                  {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-son-silver-dim" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white truncate">{p.name}</p>
                  <p className="text-xs text-son-silver-dim">{currency(p.price)}</p>
                </div>
                <select
                  className="input-field w-20 py-1.5 text-xs appearance-none cursor-pointer flex-shrink-0"
                  value={discount.discount_type}
                  onChange={(e) => updateDiscount(p.id, { discount_type: e.target.value as DiscountType })}
                >
                  <option value="percent">%</option>
                  <option value="fixed">R$</option>
                </select>
                <input
                  className="input-field w-20 py-1.5 text-xs flex-shrink-0"
                  type="number"
                  min="0"
                  value={discount.discount_value || ''}
                  onChange={(e) => updateDiscount(p.id, { discount_value: Number(e.target.value) })}
                />
                <div className="text-right flex-shrink-0 w-24">
                  <p className="text-xs text-son-silver-dim">{equivalentLabel(p.price, discount.discount_type, discount.discount_value)}</p>
                  <p className="text-xs sunset-text font-bold">{currency(finalPrice)}</p>
                </div>
                <button type="button" onClick={() => removeProduct(p.id)} className="flex-shrink-0">
                  <X className="w-3.5 h-3.5 text-son-silver-dim hover:text-son-pink" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 text-son-silver-dim absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input-field pl-9"
          placeholder={categories ? 'Produtos e/ou Categorias' : 'Buscar produto por nome ou código de barras...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(categoryMatches.length > 0 || matches.length > 0) && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-son-surface border border-white/10 rounded-xl overflow-hidden shadow-lg max-h-56 overflow-y-auto">
            {categoryMatches.map((c) => (
              <button
                key={`cat-${c.id}`}
                type="button"
                onClick={() => addCategory(c.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-son-silver hover:bg-son-surface-light text-left"
              >
                <Tag className="w-3.5 h-3.5 text-son-gold flex-shrink-0" />
                <span className="truncate flex-1">
                  <span className="text-son-silver-dim">Categoria: </span>
                  {c.name}
                </span>
                <span className="text-xs text-son-silver-dim flex-shrink-0">
                  {products.filter((p) => p.category_id === c.id).length} produto(s)
                </span>
              </button>
            ))}
            {matches.map((p) => (
              <button
                key={`prod-${p.id}`}
                type="button"
                onClick={() => addProduct(p.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-son-silver hover:bg-son-surface-light text-left"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-son-silver-dim flex-shrink-0">{currency(p.price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {categoryProducts && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Categoria: {categoryProducts.name}</h3>
              <button onClick={() => setCategoryProducts(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {categoryProducts.products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setInfoProduct(p)}
                  className="w-full flex items-center gap-2 bg-son-surface-light rounded-xl p-2 text-left hover:bg-son-surface"
                >
                  <div className="w-10 h-10 rounded-lg bg-son-surface flex items-center justify-center overflow-hidden flex-shrink-0">
                    {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-son-silver-dim" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white truncate">{p.name}</p>
                    <p className="text-xs text-son-silver-dim">{currency(p.price)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {infoProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{infoProduct.name}</h3>
              <button onClick={() => setInfoProduct(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {infoProduct.image_url && (
              <img src={infoProduct.image_url} alt={infoProduct.name} className="w-full h-40 object-cover rounded-xl mb-3" />
            )}
            <p className="text-sm text-son-silver-dim mb-2">{infoProduct.description}</p>
            <div className="flex justify-between text-sm">
              <span className="text-son-silver-dim">Preço</span>
              <span className="sunset-text font-bold">{currency(infoProduct.price)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-son-silver-dim">Estoque</span>
              <span className="text-white">{infoProduct.quantity}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
