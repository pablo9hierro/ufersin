import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Minus, Package, Plus, ShoppingBag } from 'lucide-react'
import { useProduct } from '../../hooks/useProducts'
import { useCart } from '../../store/cart'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'

// Foto quadrada com botão de voltar minimalista (traço fino, sem fundo
// preenchido -- diferente do círculo cheio do BurgerBite), título em
// tipografia condensada. Preço em selo laranja sólido, não texto solto.
export default function Uiux4ProdutoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: product, loading } = useProduct(id)
  const { items, addItem, changeQty } = useCart()

  const qty = items.find((i) => i.productId === id)?.quantity ?? 0

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin u4-accent" />
        </div>
      </Shell>
    )
  }

  if (!product) {
    return (
      <Shell>
        <div className="px-4 sm:px-8 pt-6">
          <EmptyState icon={Package} message="Produto não encontrado." actionLabel="Voltar ao cardápio" actionHref="/catalogo" />
        </div>
      </Shell>
    )
  }

  const outOfStock = product.quantity <= 0

  return (
    <Shell>
      <div className="max-w-2xl mx-auto pb-16">
        <div className="relative px-4 sm:px-8 pt-4">
          <div className="aspect-square flex items-center justify-center overflow-hidden rounded-2xl" style={{ background: 'var(--u4-surface)' }}>
            {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-16 h-16 u4-dim" />}
          </div>
          <button onClick={() => navigate(-1)} className="u4-arrow-btn absolute top-8 left-8" style={{ background: 'rgba(0,0,0,0.5)' }} aria-label="Voltar">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-8 pt-5">
          {product.category_name && <p className="text-xs font-bold u4-dim uppercase tracking-widest mb-1.5">{product.category_name}</p>}
          <h1 className="u4-display text-3xl mb-2">{product.name}</h1>
          <span className="u4-tag inline-block px-3 py-1 text-sm">{currency(product.price)}</span>
          {product.description && <p className="u4-dim mt-4 leading-relaxed text-sm">{product.description}</p>}
          {outOfStock && <p className="text-xs u4-dim mt-2">Sem estoque no momento</p>}

          <div className="mt-7 flex items-center gap-3">
            {outOfStock ? (
              <span className="text-sm font-semibold u4-dim">Esgotado</span>
            ) : qty > 0 ? (
              <div className="flex items-center gap-3 u4-panel px-3 py-2">
                <button onClick={() => changeQty(product.id, -1)} aria-label="Diminuir" className="w-8 h-8 flex items-center justify-center u4-accent">
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-semibold w-6 text-center">{qty}</span>
                <button onClick={() => addItem(product)} disabled={qty >= product.quantity} aria-label="Aumentar" className="w-8 h-8 flex items-center justify-center u4-accent disabled:opacity-30">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => addItem(product)} className="u4-btn-primary flex-1 flex items-center justify-center gap-2 py-3.5 text-sm">
                <ShoppingBag className="w-4 h-4" /> Adicionar à sacola
              </button>
            )}
            {qty > 0 && (
              <button onClick={() => navigate('/carrinho')} className="u4-btn-secondary flex-1 flex items-center justify-center gap-2 py-3.5 text-sm">
                <ShoppingBag className="w-4 h-4" /> Ver sacola
              </button>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
