import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreditCard, Home, Loader2, MapPin, QrCode, Sparkles, Tag, Wallet } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import LocationPicker from '../components/checkout/LocationPicker'
import BirthdateInput from '../components/checkout/BirthdateInput'
import { api, ApiError } from '../lib/api'
import type { CouponPreview } from '../lib/supabasePublicApi'
import type { DiscountType, PaymentMethod, Product, Promotion, ShippingEstimate } from '../lib/types'
import { useBannerCart } from '../store/bannerCart'
import { useCustomer } from '../store/customer'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

export default function BannerCheckout() {
  const navigate = useNavigate()
  const bannerCart = useBannerCart()
  const customer = useCustomer()

  const [promotion, setPromotion] = useState<Promotion | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [pickupAtStore, setPickupAtStore] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [, setShippingEstimate] = useState<ShippingEstimate | null>(null)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponPreview | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponChecking, setCouponChecking] = useState(false)

  useEffect(() => {
    if (!bannerCart.promotionId || bannerCart.items.length === 0) {
      setLoadError('Seu carrinho de promoção está vazio. Volte no banner e monte o pedido primeiro.')
      setLoading(false)
      return
    }
    Promise.all([api.promotions.get(bannerCart.promotionId), api.products.list()])
      .then(([p, prods]) => {
        setPromotion(p)
        setProducts(prods)
      })
      .catch(() => setLoadError('Essa promoção não está mais disponível.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const lines = useMemo(
    () => bannerCart.items.map((i) => ({ item: i, product: productById.get(i.productId) })).filter((l): l is { item: typeof l.item; product: Product } => !!l.product),
    [bannerCart.items, productById]
  )
  const productDiscountById = useMemo(() => {
    const map = new Map<string, { discount_type: DiscountType; discount_value: number }>()
    for (const pd of promotion?.product_discounts ?? []) map.set(pd.product_id, pd)
    return map
  }, [promotion])

  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)

  let promotionProductDiscount = 0
  if (promotion?.promotion_type === 'kit' && promotion.discount_type && promotion.discount_value != null) {
    promotionProductDiscount =
      promotion.discount_type === 'percent' ? (subtotal * promotion.discount_value) / 100 : promotion.discount_value
  } else if (promotion?.promotion_type === 'selfie_service') {
    for (const l of lines) {
      const pd = productDiscountById.get(l.product.id)
      if (!pd) continue
      const lineTotal = l.product.price * l.item.quantity
      promotionProductDiscount += pd.discount_type === 'percent' ? (lineTotal * pd.discount_value) / 100 : Math.min(pd.discount_value * l.item.quantity, lineTotal)
    }
  }

  const applyCoupon = async () => {
    if (!couponInput.trim() || !promotion) return
    setCouponError(null)
    setCouponChecking(true)
    try {
      const digits = customer.whatsapp.replace(/\D/g, '')
      const result = await api.coupons.validate(couponInput.trim(), promotion.id, customer.birthdate, digits ? `55${digits}` : undefined)
      setAppliedCoupon(result)
    } catch (e) {
      setAppliedCoupon(null)
      setCouponError(e instanceof ApiError ? e.message : 'Cupom inválido para esta promoção.')
    } finally {
      setCouponChecking(false)
    }
  }

  const handleSubmit = async () => {
    setError(null)
    if (!promotion || lines.length === 0) {
      setError('Seu carrinho de promoção está vazio.')
      return
    }
    if (!customer.name.trim()) {
      setError('Informe seu nome.')
      return
    }
    const digits = customer.whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (!customer.birthdate) {
      setError('Informe sua data de nascimento.')
      return
    }
    const age = (Date.now() - new Date(customer.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (age < 18) {
      setError('Você precisa ser maior de idade para comprar produtos de tabacaria.')
      return
    }
    if (!pickupAtStore && (customer.lat == null || customer.lng == null)) {
      setError('Escolha sua localização no mapa ou marque retirada no local.')
      return
    }

    setSubmitting(true)
    try {
      const order = await api.orders.create({
        customer_name: customer.name.trim(),
        customer_whatsapp: `55${digits}`,
        customer_birthdate: customer.birthdate,
        delivery_type: pickupAtStore ? 'retirada' : 'entrega',
        neighborhood: pickupAtStore ? undefined : customer.neighborhood,
        address: pickupAtStore ? undefined : customer.address,
        reference_point: pickupAtStore ? undefined : customer.referencePoint || undefined,
        customer_lat: pickupAtStore ? undefined : customer.lat ?? undefined,
        customer_lng: pickupAtStore ? undefined : customer.lng ?? undefined,
        payment_method: paymentMethod,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.item.quantity })),
        coupon_code: appliedCoupon?.code,
        promotion_id: promotion.id,
      })
      bannerCart.clear()
      api.orders.notifyCreated(order.id).catch(() => {})
      if (paymentMethod === 'pix') {
        navigate(`/pagamento/${order.id}`)
      } else {
        navigate(`/consultar?order=${order.id}`)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar seu pedido. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </main>
    )
  }

  if (loadError || !promotion) {
    return (
      <main className="min-h-screen text-white">
        <SiteHeader showCart={false} />
        <div className="max-w-xl mx-auto px-5 sm:px-10 py-16 text-center">
          <p className="error-msg inline-block">{loadError}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen text-white relative overflow-hidden">
      {/* Layout próprio do checkout de banner: fundo com glow laranja/roxo
          fixo no topo, cartão de promoção destacado — visualmente diferente
          do checkout comum, pra nunca confundir os dois fluxos. */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-son-orange/20 blur-[140px] pointer-events-none" />
      <SiteHeader />
      <PageTransition className="max-w-xl mx-auto px-5 sm:px-10 pb-24 relative">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-orange-400" />
          <h1 className="text-2xl sm:text-3xl font-black">Checkout da promoção</h1>
        </div>
        <p className="text-xs text-son-silver-dim mb-6">Este checkout é exclusivo pros itens escolhidos em /banner.</p>

        <div className="glass rounded-2xl p-4 mb-6 flex items-center gap-3 border border-orange-400/20">
          <img src={promotion.image_url} alt={promotion.title} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{promotion.title}</p>
            <p className="text-xs text-orange-400 font-medium">{promotion.promotion_type === 'kit' ? 'Pacote fechado' : 'Carrinho selfie service'}</p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label className="label">Seu nome *</label>
            <input className="input-field" value={customer.name} onChange={(e) => customer.set({ name: e.target.value })} placeholder="Nome completo" />
          </div>

          <div>
            <label className="label">WhatsApp *</label>
            <input
              className="input-field"
              value={customer.whatsapp}
              onChange={(e) => customer.set({ whatsapp: formatPhone(e.target.value) })}
              type="tel"
              inputMode="numeric"
              placeholder="(83) 99999-9999"
              maxLength={15}
            />
          </div>

          <div>
            <label className="label">Data de nascimento *</label>
            <BirthdateInput value={customer.birthdate} onChange={(birthdate) => customer.set({ birthdate })} />
            <p className="text-xs text-son-silver-dim mt-1">Exigido por lei — venda de produtos de tabacaria só para maiores de 18 anos.</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-son-silver">
            <input type="checkbox" checked={pickupAtStore} onChange={(e) => setPickupAtStore(e.target.checked)} className="w-4 h-4 accent-son-pink" />
            <Home className="w-3.5 h-3.5" />
            Quero retirar no local
          </label>

          {!pickupAtStore && (
            <div>
              <label className="label">Endereço de entrega *</label>
              {customer.lat != null && customer.lng != null ? (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="w-full flex items-center gap-3 bg-son-surface border border-white/10 rounded-2xl px-4 py-3 text-left hover:border-orange-400/40 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-orange-400 flex-none" />
                  <span className="flex-1 text-sm text-white truncate">{customer.address || 'Endereço selecionado'}</span>
                  <span className="text-xs text-son-silver-dim flex-none">Editar</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 border border-dashed border-white/15 rounded-2xl px-4 py-4 text-sm text-son-silver-dim hover:border-orange-400/40 hover:text-orange-400 transition-colors"
                >
                  <MapPin className="w-4 h-4" />
                  Escolher localização no mapa
                </button>
              )}
            </div>
          )}

          {!pickupAtStore && (
            <div>
              <label className="label">Ponto de referência</label>
              <input
                className="input-field"
                value={customer.referencePoint}
                onChange={(e) => customer.set({ referencePoint: e.target.value })}
                placeholder="Número da casa/Condomínio, observações de entrega..."
              />
            </div>
          )}

          {pickerOpen && (
            <LocationPicker
              initial={
                customer.lat != null && customer.lng != null
                  ? { lat: customer.lat, lng: customer.lng, label: customer.address, bairro: customer.neighborhood || undefined }
                  : null
              }
              onClose={() => setPickerOpen(false)}
              onConfirm={(result) => {
                customer.set({ address: result.label, neighborhood: result.bairro ?? '', lat: result.lat, lng: result.lng })
                setShippingEstimate(result.estimate ?? null)
                setPickerOpen(false)
              }}
            />
          )}

          <div>
            <label className="label">Forma de pagamento *</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'pix', label: 'Pix', icon: QrCode },
                  { value: 'cartao', label: 'Cartão', icon: CreditCard },
                  { value: 'dinheiro', label: 'Dinheiro', icon: Wallet },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPaymentMethod(value)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border text-sm font-medium transition-all ${
                    paymentMethod === value
                      ? 'bg-orange-500 text-white border-transparent'
                      : 'bg-son-surface border-white/10 text-son-silver hover:border-orange-400/30'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Cupom de desconto (se a promoção aceitar)</label>
            {appliedCoupon ? (
              <div className="flex items-center justify-between bg-son-surface border border-orange-400/30 rounded-2xl px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-white">
                  <Tag className="w-4 h-4 text-orange-400" /> {appliedCoupon.code}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null)
                    setCouponInput('')
                  }}
                  className="text-xs text-son-silver-dim hover:text-son-pink"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  className="input-field flex-1 uppercase"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="Código do cupom"
                />
                <button type="button" onClick={applyCoupon} disabled={couponChecking || !couponInput.trim()} className="btn-secondary px-4">
                  {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                </button>
              </div>
            )}
            {couponError && <p className="error-msg mt-1">{couponError}</p>}
          </div>

          <div className="border-t border-white/10 pt-4 space-y-1 text-sm">
            <div className="flex justify-between text-son-silver-dim font-medium">
              <span>Subtotal</span>
              <span>{currency(subtotal)}</span>
            </div>
            {lines.map((l) => (
              <div key={l.product.id} className="flex justify-between text-xs text-son-silver-dim pl-3">
                <span className="truncate pr-2">
                  {l.product.name}
                  {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                </span>
                <span className="flex-shrink-0">{currency(l.product.price * l.item.quantity)}</span>
              </div>
            ))}
            {promotionProductDiscount > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Desconto da promoção</span>
                <span>-{currency(promotionProductDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between text-son-silver-dim">
              <span>Frete</span>
              <span>{pickupAtStore ? 'Retirada no local' : 'Calculado ao escolher o endereço'}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-white">Total (produtos)</span>
              <span className="sunset-text font-black text-lg">{currency(Math.max(subtotal - promotionProductDiscount, 0))}</span>
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button onClick={handleSubmit} disabled={submitting} className="w-full text-base py-4 rounded-2xl font-bold bg-orange-500 text-white hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Finalizar pedido
          </button>
        </div>
      </PageTransition>
    </main>
  )
}
