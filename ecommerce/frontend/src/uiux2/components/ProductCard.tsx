import { Minus, Package, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { PromotionalProduct, Product } from '../../types'
import FavoriteButton from './FavoriteButton'
import { OutOfStockRibbon } from '../../components/ProductDetailModal'

export function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function finalPrice(price: number, promo: PromotionalProduct) {
  return Math.max(promo.discount_type === 'percent' ? price - (price * promo.discount_value) / 100 : price - promo.discount_value, 0)
}

export default function ProductCard({
  product,
  qty,
  isFavorite,
  onToggleFavorite,
  onAdd,
  onRemove,
  promo,
}: {
  product: Product
  qty: number
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onAdd: () => void
  onRemove: () => void
  promo?: PromotionalProduct
}) {
  const outOfStock = product.quantity <= 0
  return (
    <div className={`u2-card overflow-hidden flex flex-col relative ${outOfStock ? 'grayscale opacity-70' : ''}`}>
      {outOfStock && <OutOfStockRibbon />}
      {onToggleFavorite && (
        <div className="absolute top-2 right-2 z-10">
          <FavoriteButton checked={!!isFavorite} onClick={onToggleFavorite} />
        </div>
      )}
      <Link to={`/produto/${product.id}`} className="flex flex-col flex-1" onClick={(e) => outOfStock && e.preventDefault()}>
        <div className="aspect-square flex items-center justify-center overflow-hidden" style={{ background: 'var(--uf-surface-light)' }}>
          {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <Package className="w-9 h-9 u2-dim" />}
        </div>
        <div className="p-3 flex flex-col gap-1 flex-1">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{product.name}</p>
          {product.category_name && <p className="text-xs u2-dim">{product.category_name}</p>}
          {promo ? (
            <div className="flex items-center gap-1.5 flex-wrap mt-auto">
              <span className="text-xs text-red-500 line-through">{currency(product.price)}</span>
              <span className="u2-accent font-bold">{currency(finalPrice(product.price, promo))}</span>
            </div>
          ) : (
            <p className="u2-accent font-bold mt-auto">{currency(product.price)}</p>
          )}
        </div>
      </Link>
      <div className="px-3 pb-3">
        {outOfStock ? (
          <span className="block text-xs font-semibold u2-dim text-center py-2">Em falta</span>
        ) : qty > 0 ? (
          <div className="flex items-center justify-between u2-surface !rounded-lg px-2 py-1">
            <button onClick={onRemove} aria-label="Diminuir" className="w-7 h-7 flex items-center justify-center u2-accent">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-semibold">{qty}</span>
            <button onClick={onAdd} disabled={qty >= product.quantity} aria-label="Aumentar" className="w-7 h-7 flex items-center justify-center u2-accent disabled:opacity-30">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={onAdd} className="u2-btn-primary w-full flex items-center justify-center gap-1.5 text-xs py-2">
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </button>
        )}
      </div>
    </div>
  )
}
