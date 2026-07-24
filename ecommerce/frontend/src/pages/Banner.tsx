import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Minus, Package, Plus, X } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import { api } from '../lib/api'
import type { DiscountType, Product, Promotion } from '../lib/types'
import { useBannerCart } from '../store/bannerCart'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function finalPrice(price: number, type: DiscountType, value: number) {
  return Math.max(type === 'percent' ? price - (price * value) / 100 : price - value, 0)
}

function discountText(type: DiscountType, value: number) {
  return type === 'percent' ? `-${value}%` : `-${currency(value)}`
}

export default function Banner() {
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
    Promise.all([api.promotions.get(promotionId), api.products.list()])
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
      <main className="min-h-screen text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </main>
    )
  }

  if (error || !promotion) {
    return (
      <main className="min-h-screen text-white">
        <SiteHeader />
        <div className="max-w-xl mx-auto px-5 sm:px-10 py-16 text-center">
          <p className="error-msg inline-block">{error ?? 'Promoção não encontrada.'}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen text-white">
      <SiteHeader />
      <PageTransition className="max-w-xl mx-auto px-5 sm:px-10 pb-56">
        <img src={promotion.image_url} alt={promotion.title} className="w-full aspect-[2/1] object-cover rounded-2xl mb-4" />
        <h1 className="text-2xl font-black mb-1">{promotion.title}</h1>
        <p className="text-xs text-son-silver-dim mb-5">
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
              <div key={product.id} className="bg-son-surface border border-white/5 rounded-2xl p-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setInfoProduct(product)}
                  className="w-14 h-14 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0"
                >
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-5 h-5 text-son-silver-dim/40" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{product.name}</p>
                  {pd ? (
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className="text-xs text-red-500 line-through decoration-2">{currency(product.price)}</span>
                      <span className="text-xs font-semibold text-orange-400">{discountText(pd.discount_type, pd.discount_value)}</span>
                      <span className="sunset-text text-sm font-bold">{currency(finalPrice(product.price, pd.discount_type, pd.discount_value))}</span>
                    </div>
                  ) : (
                    <p className="sunset-text text-sm font-bold mt-0.5">{currency(product.price)}</p>
                  )}
                </div>
                {isKit ? (
                  <span className="text-xs text-son-silver-dim flex-shrink-0">Incluso no kit</span>
                ) : outOfStock ? (
                  <span className="text-xs font-semibold text-son-silver-dim flex-shrink-0">Esgotado</span>
                ) : inCart > 0 ? (
                  <div className="flex items-center gap-1.5 bg-son-surface-light rounded-xl px-2 py-1.5 flex-shrink-0">
                    <button onClick={() => bannerCart.changeQty(product.id, -1)} className="w-6 h-6 flex items-center justify-center text-son-pink">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm w-4 text-center">{inCart}</span>
                    <button
                      onClick={() => bannerCart.addItem(product.id, product.quantity)}
                      disabled={inCart >= product.quantity}
                      className="w-6 h-6 flex items-center justify-center text-son-pink disabled:opacity-30"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => bannerCart.addItem(product.id, product.quantity)}
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center sunset-bg text-white rounded-xl"
                    aria-label={`Adicionar ${product.name}`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </PageTransition>

      <div className="fixed bottom-0 left-0 right-0 bg-son-surface border-t border-white/10 px-5 sm:px-10 py-4">
        <div className="max-w-xl mx-auto">
          <div className="flex justify-between text-xs text-son-silver-dim mb-1">
            <span>Produtos selecionados</span>
            <span>{summary.count}</span>
          </div>
          {summary.discount > 0 && (
            <div className="flex justify-between text-xs text-emerald-400 mb-1">
              <span>Desconto aplicado</span>
              <span>-{currency(summary.discount)}</span>
            </div>
          )}
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold text-white">Valor total</span>
            <span className="sunset-text font-black text-lg">{currency(summary.total)}</span>
          </div>
          <button
            onClick={() => navigate('/banner/checkout')}
            disabled={bannerCart.items.length === 0}
            className="btn-primary w-full text-base py-4 disabled:opacity-40"
          >
            Finalizar Pedido
          </button>
        </div>
      </div>

      {infoProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setInfoProduct(null)}>
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
          </div>
        </div>
      )}
    </main>
  )
}
