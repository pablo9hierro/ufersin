import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Minus, Package, Plus, ShoppingBag } from 'lucide-react'
import { useProduct } from '../../hooks/useProducts'
import { useCart } from '../../store/cart'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'

export default function Uiux2ProdutoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: product, loading } = useProduct(id)
  const { items, addItem, changeQty } = useCart()

  const qty = items.find((i) => i.productId === id)?.quantity ?? 0

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
        </div>
      </Shell>
    )
  }

  if (!product) {
    return (
      <Shell>
        <div className="px-4 sm:px-8 pt-6">
          <EmptyState icon={Package} message="Produto não encontrado." actionLabel="Voltar ao catálogo" actionHref="/catalogo" />
        </div>
      </Shell>
    )
  }

  const outOfStock = product.quantity <= 0

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-16 max-w-2xl mx-auto">
        <button onClick={() => navigate(-1)} className="u2-dim flex items-center gap-1.5 text-sm font-semibold mb-4" aria-label="Voltar">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div className="u2-card aspect-square sm:aspect-video flex items-center justify-center overflow-hidden mb-5">
          {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-16 h-16 u2-dim" />}
        </div>

        {product.category_name && <p className="text-xs font-semibold u2-oncanvas-accent uppercase tracking-wide mb-1">{product.category_name}</p>}
        <h1 className="u2-oncanvas text-2xl font-black">{product.name}</h1>
        <p className="u2-oncanvas-accent text-2xl font-bold mt-2">{currency(product.price)}</p>
        {product.description && <p className="u2-oncanvas-dim mt-4 leading-relaxed text-sm">{product.description}</p>}
        {outOfStock && <p className="text-xs u2-oncanvas-dim mt-2">Sem estoque no momento</p>}

        <div className="mt-7 flex items-center gap-3">
          {outOfStock ? (
            <span className="text-sm font-semibold u2-oncanvas-dim">Esgotado</span>
          ) : qty > 0 ? (
            <div className="flex items-center gap-3 u2-surface px-3 py-2">
              <button onClick={() => changeQty(product.id, -1)} aria-label="Diminuir" className="w-8 h-8 flex items-center justify-center u2-accent">
                <Minus className="w-4 h-4" />
              </button>
              <span className="font-semibold w-6 text-center">{qty}</span>
              <button onClick={() => addItem(product)} disabled={qty >= product.quantity} aria-label="Aumentar" className="w-8 h-8 flex items-center justify-center u2-accent disabled:opacity-30">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => addItem(product)} className="u2-btn-primary flex items-center gap-2 px-5 py-3 text-sm">
              <Plus className="w-4 h-4" /> Adicionar à sacola
            </button>
          )}
          {qty > 0 && (
            <button onClick={() => navigate('/carrinho')} className="u2-btn-secondary flex items-center gap-2 px-5 py-3 text-sm">
              <ShoppingBag className="w-4 h-4" /> Ver sacola
            </button>
          )}
        </div>
      </div>
    </Shell>
  )
}
