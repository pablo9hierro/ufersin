import { Flame, Minus, Package, Plus } from 'lucide-react'
import { Link } from '../../lib/tenantRouter'
import type { Product } from '../../types'
import { currency } from './ProductCard'
import FavoriteButton from './FavoriteButton'
import { OutOfStockRibbon } from '../../components/ProductDetailModal'

// Linha de "Menu" -- miniatura pequena + nome + selo "popular" (chama,
// puramente decorativo -- não existe campo de avaliação no contrato de
// dados, então não inventamos nota de cliente) + preço + controle de
// quantidade, tudo numa fileira compacta. Não existe equivalente no
// Ufersin nativo (lá todo produto vira o mesmo cartão de grade).
export default function ListRow({
  product,
  qty,
  popular,
  isFavorite,
  onToggleFavorite,
  onAdd,
  onRemove,
}: {
  product: Product
  qty: number
  popular?: boolean
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onAdd: () => void
  onRemove: () => void
}) {
  const outOfStock = product.quantity <= 0
  return (
    <Link
      to={`/produto/${product.id}`}
      onClick={(e) => outOfStock && e.preventDefault()}
      className={`u3-list-row flex items-center gap-3 p-2.5 ${outOfStock ? 'grayscale opacity-70' : ''}`}
    >
      <div className="relative u3-list-thumb w-14 h-14 shrink-0 flex items-center justify-center">
        {outOfStock && (
          <div className="absolute top-0 left-0 origin-top-left scale-50">
            <OutOfStockRibbon />
          </div>
        )}
        {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <Package className="w-5 h-5 u3-dim" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug line-clamp-1">{product.name}</p>
        {popular && (
          <span className="u3-badge-pop text-[11px] flex items-center gap-1 mt-0.5">
            <Flame className="w-3 h-3" /> Popular
          </span>
        )}
        <p className="u3-accent font-bold text-sm mt-0.5">{currency(product.price)}</p>
      </div>
      {onToggleFavorite && (
        <div className="shrink-0">
          <FavoriteButton checked={!!isFavorite} onClick={onToggleFavorite} />
        </div>
      )}
      {outOfStock ? (
        <span className="text-[11px] font-semibold u3-dim shrink-0">Em falta</span>
      ) : qty > 0 ? (
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.preventDefault()}>
          <button onClick={onRemove} aria-label="Diminuir" className="u3-icon-btn !w-7 !h-7">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-bold w-4 text-center">{qty}</span>
          <button onClick={onAdd} disabled={qty >= product.quantity} aria-label="Aumentar" className="u3-icon-btn !w-7 !h-7 disabled:opacity-30">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.preventDefault()
            onAdd()
          }}
          aria-label={`Adicionar ${product.name}`}
          className="u3-icon-btn u3-icon-btn-accent !w-8 !h-8 shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </Link>
  )
}
