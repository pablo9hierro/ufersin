import { useNavigate, useParams } from '../../lib/tenantRouter'
import { ArrowLeft, Loader2, Minus, Package, Plus, ShoppingBag } from 'lucide-react'
import { useProduct } from '../../hooks/useProducts'
import { useCart } from '../../store/cart'
import { useCartDrawer } from '../../store/cartDrawer'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'

// Foto GRANDE ocupando o topo com botão de voltar CIRCULAR flutuando por
// cima dela (igual à referência) -- nada de card com borda uniforme como
// o Ufersin nativo. Preço/estoque/adicionar tudo abaixo, pílula de
// largura cheia no fim.
export default function Uiux3ProdutoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: product, loading } = useProduct(id)
  const { items, addItem, changeQty } = useCart()
  const openDrawer = useCartDrawer((s) => s.openDrawer)

  const qty = items.find((i) => i.productId === id)?.quantity ?? 0

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin u3-accent" />
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
        <div className="relative">
          <div className="aspect-square sm:aspect-video flex items-center justify-center overflow-hidden rounded-b-[32px]" style={{ background: 'var(--u3-surface)' }}>
            {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <Package className="w-16 h-16 u3-dim" />}
          </div>
          <button onClick={() => navigate(-1)} className="u3-icon-btn absolute top-4 left-4" aria-label="Voltar">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-8 pt-5">
          {product.category_name && <p className="text-xs font-semibold u3-accent uppercase tracking-wide mb-1">{product.category_name}</p>}
          <h1 className="text-2xl font-black">{product.name}</h1>
          <p className="u3-accent text-2xl font-black mt-2">{currency(product.price)}</p>
          {product.description && <p className="u3-dim mt-4 leading-relaxed text-sm">{product.description}</p>}
          {outOfStock && <p className="text-xs u3-dim mt-2">Sem estoque no momento</p>}

          <div className="mt-7 flex items-center gap-3">
            {outOfStock ? (
              <span className="text-sm font-semibold u3-dim">Esgotado</span>
            ) : qty > 0 ? (
              <div className="flex items-center gap-3 rounded-full px-3 py-2" style={{ background: 'var(--u3-surface)' }}>
                <button onClick={() => changeQty(product.id, -1)} aria-label="Diminuir" className="w-8 h-8 flex items-center justify-center u3-accent">
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-semibold w-6 text-center">{qty}</span>
                <button onClick={() => addItem(product)} disabled={qty >= product.quantity} aria-label="Aumentar" className="w-8 h-8 flex items-center justify-center u3-accent disabled:opacity-30">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => addItem(product)} className="u3-pill-primary flex-1 flex items-center justify-center gap-2 py-3.5 text-sm">
                <ShoppingBag className="w-4 h-4" /> Adicionar à sacola
              </button>
            )}
            {qty > 0 && (
              <button onClick={openDrawer} className="u3-pill-secondary flex-1 flex items-center justify-center gap-2 py-3.5 text-sm">
                <ShoppingBag className="w-4 h-4" /> Ver sacola
              </button>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
