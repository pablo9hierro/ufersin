import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from '../../lib/tenantRouter'
import { Loader2, Minus, Package, Plus, X } from 'lucide-react'
import { promotionService } from '../../services/promotionService'
import { productService } from '../../services/productService'
import type { DiscountType, Product, Promotion } from '../../types'
import { useBannerCart } from '../../store/bannerCart'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'

function finalPrice(price: number, type: DiscountType, value: number) {
  return Math.max(type === 'percent' ? price - (price * value) / 100 : price - value, 0)
}

function discountText(type: DiscountType, value: number) {
  return type === 'percent' ? `-${value}%` : `-${currency(value)}`
}

// Vitrine de uma promoção específica (kit fechado ou "monte seu carrinho"
// selfie_service), fora do fluxo normal do catálogo -- mesma lógica de
// desconto/carrinho de banner do Sunset (store/bannerCart.ts, separado do
// carrinho normal), só reapresentado com os componentes u2-*.
export default function Uiux2Banner() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const promotionId = searchParams.get('promocao')
  const bannerCart = useBannerCart()

  const [promotion, setPromotion] = useState<Promotion | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [infoProduct, setInfoProduct] = useState<Product | null>(null)

  useEffect(() => {
    if (!promotionId) {
      setError('Nenhuma promoção informada.')
      setLoading(false)
      return
    }
    Promise.all([promotionService.get(promotionId), productService.list()])
      .then(([p, prods]) => {
        setPromotion(p)
        setProducts(prods)
        if (bannerCart.promotionId !== p.id) {
          bannerCart.setPromotion(p.id, p.promotion_type === 'kit' ? p.product_ids.map((id) => ({ productId: id, quantity: 1 })) : [])
        }
      })
      .catch(() => setError('Essa promoção não está mais disponível.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionId])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const promotionProducts = useMemo(
    () => (promotion ? promotion.product_ids.map((id) => productById.get(id)).filter((p): p is Product => !!p) : []),
    [promotion, productById]
  )
  const productDiscountById = useMemo(() => {
    const map = new Map<string, { discount_type: DiscountType; discount_value: number }>()
    for (const pd of promotion?.product_discounts ?? []) map.set(pd.product_id, pd)
    return map
  }, [promotion])

  const qtyInCart = (id: string) => bannerCart.items.find((i) => i.productId === id)?.quantity ?? 0

  const summary = useMemo(() => {
    let original = 0
    let discount = 0
    let count = 0
    for (const item of bannerCart.items) {
      const product = productById.get(item.productId)
      if (!product) continue
      const lineTotal = product.price * item.quantity
      original += lineTotal
      count += item.quantity
      if (promotion?.promotion_type === 'selfie_service') {
        const pd = productDiscountById.get(item.productId)
        if (pd) discount += pd.discount_type === 'percent' ? (lineTotal * pd.discount_value) / 100 : Math.min(pd.discount_value * item.quantity, lineTotal)
      }
    }
    if (promotion?.promotion_type === 'kit' && promotion.discount_type && promotion.discount_value != null) {
      discount += promotion.discount_type === 'percent' ? (original * promotion.discount_value) / 100 : promotion.discount_value
    }
    discount = Math.min(discount, original)
    return { original, discount, total: original - discount, count }
  }, [bannerCart.items, productById, promotion, productDiscountById])

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
        </div>
      </Shell>
    )
  }

  if (error || !promotion) {
    return (
      <Shell>
        <div className="max-w-xl mx-auto px-4 sm:px-8 py-16 text-center">
          <p className="text-sm text-red-500">{error ?? 'Promoção não encontrada.'}</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-32 max-w-xl mx-auto">
        <img src={promotion.image_url} alt={promotion.title} className="w-full aspect-[2/1] object-cover rounded-2xl mb-4" loading="lazy" decoding="async" />
        <h1 className="text-xl font-black mb-1">{promotion.title}</h1>
        <p className="text-xs u2-dim mb-5">
          {promotion.promotion_type === 'kit'
            ? 'Pacote fechado — leve todos os itens juntos com o desconto da promoção.'
            : 'Monte seu carrinho escolhendo entre os itens desta promoção, cada um com seu desconto.'}
        </p>

        <div className="space-y-2">
          {promotionProducts.map((product) => {
            const pd = productDiscountById.get(product.id)
            const inCart = qtyInCart(product.id)
            const outOfStock = product.quantity <= 0
            const isKit = promotion.promotion_type === 'kit'
            return (
              <div key={product.id} className="u2-card p-3 flex items-center gap-3">
                <button type="button" onClick={() => setInfoProduct(product)} className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden shrink-0" style={{ background: 'var(--uf-surface-light)' }}>
                  {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <Package className="w-5 h-5 u2-dim" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{product.name}</p>
                  {pd ? (
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-xs text-red-500 line-through decoration-2">{currency(product.price)}</span>
                      <span className="text-xs font-semibold u2-accent">{discountText(pd.discount_type, pd.discount_value)}</span>
                      <span className="u2-accent text-sm font-bold">{currency(finalPrice(product.price, pd.discount_type, pd.discount_value))}</span>
                    </div>
                  ) : (
                    <p className="u2-accent text-sm font-bold mt-0.5">{currency(product.price)}</p>
                  )}
                </div>
                {isKit ? (
                  <span className="text-xs u2-dim shrink-0">Incluso no kit</span>
                ) : outOfStock ? (
                  <span className="text-xs font-semibold u2-dim shrink-0">Esgotado</span>
                ) : inCart > 0 ? (
                  <div className="flex items-center gap-1.5 u2-surface !rounded-lg px-2 py-1.5 shrink-0">
                    <button onClick={() => bannerCart.changeQty(product.id, -1)} className="w-6 h-6 flex items-center justify-center u2-accent">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm w-4 text-center">{inCart}</span>
                    <button onClick={() => bannerCart.addItem(product.id, product.quantity)} disabled={inCart >= product.quantity} className="w-6 h-6 flex items-center justify-center u2-accent disabled:opacity-30">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => bannerCart.addItem(product.id, product.quantity)} className="shrink-0 w-9 h-9 flex items-center justify-center u2-btn-primary !rounded-xl" aria-label={`Adicionar ${product.name}`}>
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="u2-surface u2-surface-bottom-bar fixed bottom-0 left-0 right-0 z-30 !rounded-none !border-x-0 !border-b-0 px-4 sm:px-8 py-4">
        <div className="max-w-xl mx-auto">
          <div className="flex justify-between text-xs u2-dim mb-1">
            <span>Produtos selecionados</span>
            <span>{summary.count}</span>
          </div>
          {summary.discount > 0 && (
            <div className="flex justify-between text-xs text-emerald-600 mb-1">
              <span>Desconto aplicado</span>
              <span>-{currency(summary.discount)}</span>
            </div>
          )}
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold">Valor total</span>
            <span className="u2-accent font-black text-lg">{currency(summary.total)}</span>
          </div>
          <button onClick={() => navigate('/banner/checkout')} disabled={bannerCart.items.length === 0} className="u2-btn-primary w-full text-base py-3.5 disabled:opacity-40">
            Finalizar Pedido
          </button>
        </div>
      </div>

      {infoProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setInfoProduct(null)}>
          <div className="u2-card p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{infoProduct.name}</h3>
              <button onClick={() => setInfoProduct(null)} className="u2-dim" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            {infoProduct.image_url && <img src={infoProduct.image_url} alt={infoProduct.name} className="w-full h-40 object-cover rounded-xl mb-3" loading="lazy" decoding="async" />}
            {infoProduct.description && <p className="text-sm u2-dim mb-2">{infoProduct.description}</p>}
            <div className="flex justify-between text-sm">
              <span className="u2-dim">Preço</span>
              <span className="u2-accent font-bold">{currency(infoProduct.price)}</span>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
