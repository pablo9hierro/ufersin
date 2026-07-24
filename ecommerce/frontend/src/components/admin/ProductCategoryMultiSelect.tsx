import { useState } from 'react'
import { Folder, Package, Search, X } from 'lucide-react'
import type { Category, Product } from '../../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// Busca combinada de produtos + categorias (autocomplete), com os
// selecionados renderizados numa lista (um abaixo do outro, não em
// chips) — clicar num produto selecionado abre popup com as infos dele;
// clicar numa categoria selecionada abre popup listando os produtos
// dela, e dentro desse popup também dá pra abrir o popup de um produto
// (popup em cima de popup).
export default function ProductCategoryMultiSelect({
  products,
  categories,
  selectedProductIds,
  selectedCategoryIds,
  onChangeProducts,
  onChangeCategories,
}: {
  products: Product[]
  categories: Category[]
  selectedProductIds: string[]
  selectedCategoryIds: string[]
  onChangeProducts: (ids: string[]) => void
  onChangeCategories: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [infoProduct, setInfoProduct] = useState<Product | null>(null)
  const [categoryPopup, setCategoryPopup] = useState<Category | null>(null)

  const selectedProducts = selectedProductIds.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p)
  const selectedCategories = selectedCategoryIds.map((id) => categories.find((c) => c.id === id)).filter((c): c is Category => !!c)

  const q = query.trim().toLowerCase()
  const productMatches =
    q.length > 0
      ? products
          .filter((p) => !selectedProductIds.includes(p.id) && (p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))))
          .slice(0, 6)
      : []
  const categoryMatches =
    q.length > 0 ? categories.filter((c) => !selectedCategoryIds.includes(c.id) && c.name.toLowerCase().includes(q)).slice(0, 4) : []

  const productsInCategory = (categoryId: string) => products.filter((p) => p.category_id === categoryId)

  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-son-silver-dim absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input-field pl-9"
          placeholder="Produtos e/ou Categorias"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(productMatches.length > 0 || categoryMatches.length > 0) && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-son-surface border border-white/10 rounded-xl overflow-hidden shadow-lg max-h-56 overflow-y-auto">
            {categoryMatches.map((c) => (
              <button
                key={`cat-${c.id}`}
                type="button"
                onClick={() => {
                  onChangeCategories([...selectedCategoryIds, c.id])
                  setQuery('')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-son-silver hover:bg-son-surface-light text-left"
              >
                <Folder className="w-3.5 h-3.5 text-son-gold flex-shrink-0" />
                <span className="truncate">
                  <span className="text-son-silver-dim">Categoria: </span>
                  {c.name}
                </span>
              </button>
            ))}
            {productMatches.map((p) => (
              <button
                key={`prod-${p.id}`}
                type="button"
                onClick={() => {
                  onChangeProducts([...selectedProductIds, p.id])
                  setQuery('')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-son-silver hover:bg-son-surface-light text-left"
              >
                <span className="w-6 h-6 rounded-md bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-3 h-3 text-son-silver-dim/50" />}
                </span>
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {(selectedCategories.length > 0 || selectedProducts.length > 0) && (
        <div className="space-y-1.5 mt-2">
          {selectedCategories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 bg-son-surface-light rounded-xl p-2">
              <button type="button" onClick={() => setCategoryPopup(c)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                <Folder className="w-4 h-4 text-son-gold flex-shrink-0" />
                <span className="text-sm text-white truncate">
                  <span className="text-son-silver-dim">Categoria: </span>
                  {c.name}
                </span>
              </button>
              <button type="button" onClick={() => onChangeCategories(selectedCategoryIds.filter((id) => id !== c.id))} className="flex-shrink-0">
                <X className="w-3.5 h-3.5 text-son-silver-dim hover:text-son-pink" />
              </button>
            </div>
          ))}
          {selectedProducts.map((p) => (
            <div key={p.id} className="flex items-center gap-2 bg-son-surface-light rounded-xl p-2">
              <button type="button" onClick={() => setInfoProduct(p)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                <span className="w-8 h-8 rounded-lg bg-son-surface flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-3.5 h-3.5 text-son-silver-dim/50" />}
                </span>
                <span className="text-sm text-white truncate">{p.name}</span>
              </button>
              <button type="button" onClick={() => onChangeProducts(selectedProductIds.filter((id) => id !== p.id))} className="flex-shrink-0">
                <X className="w-3.5 h-3.5 text-son-silver-dim hover:text-son-pink" />
              </button>
            </div>
          ))}
        </div>
      )}

      {categoryPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 max-w-sm w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{categoryPopup.name}</h3>
              <button onClick={() => setCategoryPopup(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {productsInCategory(categoryPopup.id).length === 0 ? (
              <p className="text-sm text-son-silver-dim">Nenhum produto nessa categoria.</p>
            ) : (
              <div className="space-y-1.5">
                {productsInCategory(categoryPopup.id).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setInfoProduct(p)}
                    className="w-full flex items-center gap-2 bg-son-surface-light rounded-xl p-2 text-left hover:bg-son-surface"
                  >
                    <span className="w-8 h-8 rounded-lg bg-son-surface flex items-center justify-center overflow-hidden flex-shrink-0">
                      {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-3.5 h-3.5 text-son-silver-dim/50" />}
                    </span>
                    <span className="text-sm text-white truncate flex-1">{p.name}</span>
                    <span className="text-xs sunset-text font-bold flex-shrink-0">{currency(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {infoProduct && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
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
            {infoProduct.description && <p className="text-sm text-son-silver-dim mb-2">{infoProduct.description}</p>}
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
