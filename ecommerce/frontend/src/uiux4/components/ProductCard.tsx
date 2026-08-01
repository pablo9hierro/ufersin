import { Minus, Package, Plus } from 'lucide-react'
import { Link } from '../../lib/tenantRouter'
import type { Product } from '../../types'
import FavoriteButton from './FavoriteButton'
import { OutOfStockRibbon } from '../../components/ProductDetailModal'

export function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// Tile QUADRADO -- a foto ocupa o espaço inteiro, nome/preço/controles
// ficam numa faixa translúcida sobreposta na base (nunca abaixo da foto
// como o BurgerBite, nunca dentro de uma moldura uniforme como o Ufersin
// nativo). Borda fica laranja quando o produto já está na sacola --
// estado real, não decorativo.
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
    <div className={`u4-tile ${qty > 0 ? 'in-cart' : ''} ${outOfStock ? 'grayscale opacity-70' : ''}`}>
      {outOfStock && <OutOfStockRibbon />}
      <Link to={`/produto/${product.id}`} className="absolute inset-0" onClick={(e) => outOfStock && e.preventDefault()}>
        {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Package className="w-9 h-9 u4-dim" /></div>}
      </Link>

      {onToggleFavorite && (
        <div className="absolute top-2 right-2 z-10">
          <FavoriteButton checked={!!isFavorite} onClick={onToggleFavorite} />
        </div>
      )}

      <div className="u4-tile-caption">
        <p className="text-xs font-bold leading-snug line-clamp-1 mb-1">{product.name}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="u4-accent font-black text-sm">{currency(product.price)}</span>
          {outOfStock ? (
            <span className="text-[10px] font-semibold u4-dim">Em falta</span>
          ) : qty > 0 ? (
            <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
              <button onClick={onRemove} aria-label="Diminuir" className="u4-icon-btn !w-6 !h-6 bg-black/40">
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-xs font-bold w-4 text-center">{qty}</span>
              <button onClick={onAdd} disabled={qty >= product.quantity} aria-label="Aumentar" className="u4-icon-btn !w-6 !h-6 bg-black/40 disabled:opacity-30">
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.preventDefault()
                onAdd()
              }}
              aria-label={`Adicionar ${product.name}`}
              className="u4-tag !rounded-full w-6 h-6 flex items-center justify-center"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
