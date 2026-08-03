import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { CreditCard, Home, Loader2, MapPin, QrCode, Tag, Wallet } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { promotionService } from '../../services/promotionService'
import { productService } from '../../services/productService'
import { couponService } from '../../services/couponService'
import { orderService } from '../../services/orderService'
import type { CouponPreview, DiscountType, PaymentMethod, Product, Promotion, ShippingEstimate } from '../../types'
import { useBannerCart } from '../../store/bannerCart'
import { useCustomer } from '../../store/customer'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { deliveryPixOnlyError } from '../../lib/tenantConfig'
import LocationPicker from '../../components/checkout/LocationPicker'
import PickupOnlyNotice from '../../components/checkout/PickupOnlyNotice'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

const inputClass = 'u2-surface w-full px-3.5 py-2.5 text-sm outline-none'

// Checkout exclusivo pros itens escolhidos em /banner -- carrinho de
// banner é SEMPRE separado do carrinho normal (store/bannerCart.ts),
// promotion_id sempre preenchido no pedido. Mesmo formulário (com
// seletor de endereço via mapa) do Checkout padrão deste estilo.
export default function Uiux2BannerCheckout() {
  const navigate = useNavigate()
  const bannerCart = useBannerCart()
  const customer = useCustomer()
  const tenantConfig = useTenantConfig()

  const [promotion, setPromotion] = useState<Promotion | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [pickupAtStore, setPickupAtStore] = useState(false)
  const apenasRetirada = !!tenantConfig?.apenas_retirada
  const pickup = apenasRetirada || pickupAtStore
  const payAtPickup = !!tenantConfig?.pagamento_na_retirada && pickup
  const entregaSomentePix = !!tenantConfig?.entrega_somente_pix
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
    if (apenasRetirada) setPickupAtStore(true)
  }, [apenasRetirada])

  useEffect(() => {
    if (!bannerCart.promotionId || bannerCart.items.length === 0) {
      setLoadError('Seu carrinho de promoção está vazio. Volte no banner e monte o pedido primeiro.')
      setLoading(false)
      return
    }
    Promise.all([promotionService.get(bannerCart.promotionId), productService.list()])
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
    () => bannerCart.items.map((i) => ({ item: i, product: productById.get(i.productId) })).filter((l): l is { item: (typeof bannerCart.items)[number]; product: Product } => !!l.product),
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
    promotionProductDiscount = promotion.discount_type === 'percent' ? (subtotal * promotion.discount_value) / 100 : promotion.discount_value
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
      const result = await couponService.validate(couponInput.trim(), promotion.id, customer.birthdate, digits ? `55${digits}` : undefined)
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
    if (!promotion || lines.length === 0) return setError('Seu carrinho de promoção está vazio.')
    if (!customer.name.trim()) return setError('Informe seu nome.')
    const digits = customer.whatsapp.replace(/\D/g, '')
    if (digits.length < 10) return setError('Informe um WhatsApp válido.')
    if (!customer.birthdate) return setError('Informe sua data de nascimento.')
    const age = (Date.now() - new Date(customer.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (age < 18) return setError('Você precisa ser maior de idade para comprar produtos de tabacaria.')
    if (!pickup && (customer.lat == null || customer.lng == null)) return setError('Escolha sua localização no mapa ou marque retirada no local.')

    const deliveryErr = deliveryPixOnlyError(tenantConfig, pickup, paymentMethod)
    if (deliveryErr) {
      setError(deliveryErr)
      return
    }
    setSubmitting(true)
    try {
      const order = await orderService.create({
        customer_name: customer.name.trim(),
        customer_whatsapp: `55${digits}`,
        customer_birthdate: customer.birthdate,
        delivery_type: pickup ? 'retirada' : 'entrega',
        neighborhood: pickup ? undefined : customer.neighborhood,
        address: pickup ? undefined : customer.address,
        reference_point: pickup ? undefined : customer.referencePoint || undefined,
        customer_lat: pickup ? undefined : customer.lat ?? undefined,
        customer_lng: pickup ? undefined : customer.lng ?? undefined,
        payment_method: paymentMethod,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.item.quantity })),
        coupon_code: appliedCoupon?.code,
        promotion_id: promotion.id,
      })
      bannerCart.clear()
      orderService.notifyCreated(order.id).catch(() => {})
      if (paymentMethod === 'pix' && tenantConfig?.forma_pagamento === 'plataforma' && !payAtPickup) navigate(`/pagamento/${order.id}`)
      else navigate(`/consultar?order=${order.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar seu pedido. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
        </div>
      </Shell>
    )
  }

  if (loadError || !promotion) {
    return (
      <Shell>
        <div className="max-w-xl mx-auto px-4 sm:px-8 py-16 text-center">
          <p className="text-sm text-red-500">{loadError}</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-20 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-1">Checkout da promoção</h1>
        <p className="text-xs u2-dim mb-4">Este checkout é exclusivo pros itens escolhidos na promoção.</p>

        <div className="u2-card p-3 mb-5 flex items-center gap-3">
          <img src={promotion.image_url} alt={promotion.title} className="w-14 h-14 rounded-xl object-cover shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold truncate">{promotion.title}</p>
            <p className="text-xs u2-accent font-medium">{promotion.promotion_type === 'kit' ? 'Pacote fechado' : 'Carrinho selfie service'}</p>
          </div>
        </div>

        <div className="u2-card p-4 sm:p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold u2-dim">Seu nome *</label>
            <input className={inputClass} value={customer.name} onChange={(e) => customer.set({ name: e.target.value })} placeholder="Nome completo" />
          </div>
          <div>
            <label className="text-xs font-semibold u2-dim">WhatsApp *</label>
            <input className={inputClass} value={customer.whatsapp} onChange={(e) => customer.set({ whatsapp: formatPhone(e.target.value) })} type="tel" inputMode="numeric" placeholder="(83) 99999-9999" maxLength={15} />
          </div>
          <div>
            <label className="text-xs font-semibold u2-dim">Data de nascimento *</label>
            <input className={inputClass} type="date" value={customer.birthdate} onChange={(e) => customer.set({ birthdate: e.target.value })} />
          </div>

          {apenasRetirada ? (


            <PickupOnlyNotice config={tenantConfig} dimClass="u2-dim" />


          ) : (


            <>


              <label className="flex items-center gap-2 text-sm">


                <input type="checkbox" checked={pickupAtStore} onChange={(e) => setPickupAtStore(e.target.checked)} className="w-4 h-4" />


                <Home className="w-3.5 h-3.5" />


                Quero retirar no local


              </label>


              {!pickupAtStore && (
            <>
              <div>
                <label className="text-xs font-semibold u2-dim flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Endereço de entrega *
                </label>
                {customer.lat != null && customer.lng != null ? (
                  <button type="button" onClick={() => setPickerOpen(true)}
                  className="u2-surface w-full flex items-center gap-3 px-3.5 py-2.5 text-left">
                    <MapPin className="w-4 h-4 u2-accent shrink-0" />
                    <span className="flex-1 text-sm truncate">{customer.address || 'Endereço selecionado'}</span>
                    <span className="text-xs u2-dim shrink-0">Editar</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setPickerOpen(true)} className="u2-btn-secondary w-full flex items-center justify-center gap-2 py-3 text-sm">
                    <MapPin className="w-4 h-4" />
                    Escolher localização no mapa
                  </button>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold u2-dim">Ponto de referência</label>
                <input className={inputClass} value={customer.referencePoint} onChange={(e) => customer.set({ referencePoint: e.target.value })} placeholder="Opcional" />
              </div>
            </>
          )}
            </>
          )}

          {pickerOpen && !apenasRetirada && (
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
            <label className="text-xs font-semibold u2-dim">Forma de pagamento *</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(
                [
                  { value: 'pix', label: 'Pix', icon: QrCode },
                  { value: 'cartao', label: 'Cartão', icon: CreditCard },
                  { value: 'dinheiro', label: 'Dinheiro', icon: Wallet },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" onClick={() => setPaymentMethod(value)} className={paymentMethod === value ? 'u2-btn-primary flex flex-col items-center gap-1.5 py-3 text-sm' : 'u2-btn-secondary flex flex-col items-center gap-1.5 py-3 text-sm'}>
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold u2-dim">Cupom de desconto (se a promoção aceitar)</label>
            {appliedCoupon ? (
              <div className="flex items-center justify-between u2-surface px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Tag className="w-4 h-4 u2-accent" /> {appliedCoupon.code}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null)
                    setCouponInput('')
                  }}
                  className="text-xs u2-dim"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className={inputClass + ' uppercase'} value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Código do cupom" />
                <button type="button" onClick={applyCoupon} disabled={couponChecking || !couponInput.trim()} className="u2-btn-secondary px-4 shrink-0">
                  {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                </button>
              </div>
            )}
            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
          </div>

          <div className="u2-surface px-4 py-4 space-y-1.5 text-sm">
            <div className="flex justify-between u2-dim">
              <span>Subtotal</span>
              <span>{currency(subtotal)}</span>
            </div>
            {lines.map((l) => (
              <div key={l.product.id} className="flex justify-between text-xs u2-dim pl-3">
                <span className="truncate pr-2">
                  {l.product.name}
                  {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                </span>
                <span className="shrink-0">{currency(l.product.price * l.item.quantity)}</span>
              </div>
            ))}
            {promotionProductDiscount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Desconto da promoção</span>
                <span>-{currency(promotionProductDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between u2-dim">
              <span>Frete</span>
              <span>{pickup ? 'Retirada no local' : 'Calculado ao escolher o endereço'}</span>
            </div>
            <div className="flex justify-between items-center pt-1.5">
              <span className="font-bold">Total (produtos)</span>
              <span className="u2-accent font-black text-lg">{currency(Math.max(subtotal - promotionProductDiscount, 0))}</span>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button onClick={handleSubmit} disabled={submitting} className="u2-btn-primary w-full text-base py-3.5 flex items-center justify-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Finalizar pedido
          </button>
        </div>
      </div>
    </Shell>
  )
}
