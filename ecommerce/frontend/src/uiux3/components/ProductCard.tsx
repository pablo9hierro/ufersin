import { Minus, Package, Plus } from 'lucide-react'
import { Link } from '../../lib/tenantRouter'
import type { Product } from '../../types'
import FavoriteButton from './FavoriteButton'
import { OutOfStockRibbon } from '../../components/ProductDetailModal'

export function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// Cartão de DESTAQUE -- a foto é a protagonista (grande, quadrada,
// cantos bem arredondados), nome/preço ficam ABAIXO dela, nunca dentro
// de uma moldura uniforme como o .u2-card do Ufersin nativo. Usado só na
// primeira fileira do catálogo ("Destaques"); o resto da lista usa
// ListRow.tsx (layout totalmente diferente, ver esse arquivo).
export default function ProductCard({
  product,
  qty,
  isFavorite,
  onToggleFavorite,
  onAdd,
  onRemove,
}: {
  product: Product
  qty: number
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onAdd: () => void
  onRemove: () => void
}) {
  const outOfStock = product.quantity <= 0
  return (
    <div className={`u3-feature-card flex flex-col ${outOfStock ? 'grayscale opacity-70' : ''}`}>
      <div className="relative">
        {outOfStock && <OutOfStockRibbon />}
        <Link to={`/produto/${product.id}`} className="u3-feature-photo flex items-center justify-center" onClick={(e) => outOfStock && e.preventDefault()}>
          {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-10 h-10 u3-dim" />}
        </Link>
        {onToggleFavorite && (
          <div className="absolute top-2 right-2 z-10">
            <FavoriteButton checked={!!isFavorite} onClick={onToggleFavorite} />
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <p className="text-sm font-bold leading-snug line-clamp-1">{product.name}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="u3-accent font-black text-sm">{currency(product.price)}</span>
          {outOfStock ? (
            <span className="text-[11px] font-semibold u3-dim">Em falta</span>
          ) : qty > 0 ? (
            <div className="flex items-center gap-1">
              <button onClick={onRemove} aria-label="Diminuir" className="u3-icon-btn !w-6 !h-6">
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs font-bold w-4 text-center">{qty}</span>
              <button onClick={onAdd} disabled={qty >= product.quantity} aria-label="Aumentar" className="u3-icon-btn !w-6 !h-6 disabled:opacity-30">
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button onClick={onAdd} aria-label={`Adicionar ${product.name}`} className="u3-icon-btn u3-icon-btn-accent !w-7 !h-7">
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
