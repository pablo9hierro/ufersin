import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { ChevronDown, CreditCard, Gift, Home, Loader2, MapPin, QrCode, Wallet } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { productService } from '../../services/productService'
import { couponService } from '../../services/couponService'
import { orderService } from '../../services/orderService'
import { shippingService } from '../../services/shippingService'
import LocationPicker from '../../components/checkout/LocationPicker'
import type { CouponPreview, PaymentMethod, Product, PromotionalProduct, ShippingEstimate } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomer } from '../../store/customer'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import AuthModal from '../components/AuthModal'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { closedStoreMessage, getStoreOpenState } from '../../lib/storeHours'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

const inputClass = 'u3-panel w-full px-3.5 py-2.5 text-sm outline-none'

export default function Uiux3Checkout() {
  const navigate = useNavigate()
  const { items, clear } = useCart()
  const customer = useCustomer()
  const customerAuth = useCustomerAuth()
  const tenantConfig = useTenantConfig()
  const { data: storeStatus } = useStoreStatus()

  const [products, setProducts] = useState<Product[]>([])
  const [pickupAtStore, setPickupAtStore] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shippingEstimate, setShippingEstimate] = useState<ShippingEstimate | null>(null)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponPreview | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponChecking, setCouponChecking] = useState(false)
  // Cupom exclusivo detectado sozinho a partir do WhatsApp digitado -- só
  // vira sugestão selecionável, nunca aplica nada sem uma ação ativa do
  // cliente.
  const [autoCoupon, setAutoCoupon] = useState<CouponPreview | null>(null)
  const [customerCoupons, setCustomerCoupons] = useState<CouponPreview[]>([])
  const [couponSelectOpen, setCouponSelectOpen] = useState(false)
  // Produto(s) em promoção de catálogo já no carrinho -- desconto próprio,
  // aplicado sozinho sem digitar cupom (só quando tem coupon_code de verdade
  // por trás; ver promoByProduct/catalogPromoItemDiscounts abaixo).
  const [promoProducts, setPromoProducts] = useState<PromotionalProduct[]>([])
  const [autoPromoCode, setAutoPromoCode] = useState<string | null>(null)

  useEffect(() => {
    productService.list().then(setProducts)
    couponService.listPromotionalProducts().then(setPromoProducts).catch(() => {})
  }, [])

  // Se o cliente já tinha escolhido um local numa visita anterior, revalida
  // o frete (o preço por km pode ter mudado desde então).
  useEffect(() => {
    if (customer.lat == null || customer.lng == null) return
    shippingService.estimate(customer.lat, customer.lng).then(setShippingEstimate).catch(() => setShippingEstimate(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Assim que o WhatsApp completo é digitado, checa se esse número tem
  // cupom exclusivo -- só alimenta a lista suspensa, nunca aplica sozinho.
  useEffect(() => {
    const digits = customer.whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setAutoCoupon(null)
      setCustomerCoupons([])
      return
    }
    const timer = setTimeout(() => {
      couponService
        .listForCustomer(`55${digits}`)
        .then((available) => {
          setCustomerCoupons(available)
          if (available.length === 0) return
          setAutoCoupon(available[0])
        })
        .catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [customer.whatsapp])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const lines = items.map((item) => ({ item, product: productById.get(item.productId) })).filter((l): l is { item: (typeof items)[number]; product: Product } => !!l.product)
  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)

  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const p of promoProducts) if (!map.has(p.product_id)) map.set(p.product_id, p)
    return map
  }, [promoProducts])

  // Produto com cupom de promoção de catálogo atrelado entrando no
  // carrinho: aplica o cupom dele sozinho, sem competir com um cupom já
  // digitado/detectado.
  useEffect(() => {
    if (appliedCoupon) return
    const match = lines.find((l) => promoByProduct.get(l.product.id)?.coupon_code)
    if (!match) return
    const promo = promoByProduct.get(match.product.id)!
    if (autoPromoCode === promo.coupon_code) return
    const digits = customer.whatsapp.replace(/\D/g, '')
    couponService
      .validate(promo.coupon_code, undefined, customer.birthdate, digits ? `55${digits}` : undefined)
      .then((result) => {
        setAutoPromoCode(promo.coupon_code)
        setAppliedCoupon((current) => current ?? result)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, promoByProduct, appliedCoupon])

  // Se o item que trouxe o desconto sai do carrinho, o cupom automático some junto.
  useEffect(() => {
    if (!autoPromoCode || appliedCoupon?.code !== autoPromoCode) return
    const stillInCart = lines.some((l) => promoByProduct.get(l.product.id)?.coupon_code === autoPromoCode)
    if (!stillInCart) {
      setAppliedCoupon(null)
      setAutoPromoCode(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, promoByProduct, autoPromoCode])

  const shippingPrice = pickupAtStore ? 0 : shippingEstimate?.price ?? 0

  const couponItemDiscounts = new Map<string, number>()
  let couponProductDiscount = 0
  let couponShippingDiscount = 0
  if (appliedCoupon) {
    if (appliedCoupon.kind === 'frete') {
      couponShippingDiscount = appliedCoupon.discount_type === 'percent' ? (shippingPrice * (appliedCoupon.discount_value ?? 0)) / 100 : appliedCoupon.discount_value ?? 0
    } else {
      if (appliedCoupon.kind === 'desconto' && appliedCoupon.discount_type) {
        couponProductDiscount = appliedCoupon.discount_type === 'percent' ? (subtotal * (appliedCoupon.discount_value ?? 0)) / 100 : appliedCoupon.discount_value ?? 0
      }
      if (appliedCoupon.kind === 'produto') {
        for (const l of lines) {
          const pd = appliedCoupon.product_discounts?.find((p) => p.product_id === l.product.id)
          if (!pd) continue
          const lineTotal = l.product.price * l.item.quantity
          const lineDiscount = pd.discount_type === 'percent' ? (lineTotal * pd.discount_value) / 100 : Math.min(pd.discount_value * l.item.quantity, lineTotal)
          couponItemDiscounts.set(l.product.id, lineDiscount)
          couponProductDiscount += lineDiscount
        }
      }
      if (appliedCoupon.shipping_discount_type) {
        couponShippingDiscount = appliedCoupon.shipping_discount_type === 'percent' ? (shippingPrice * (appliedCoupon.shipping_discount_value ?? 0)) / 100 : appliedCoupon.shipping_discount_value ?? 0
      }
    }
  }
  const couponDiscountTotal = couponProductDiscount + couponShippingDiscount

  // Produto com desconto de promoção "monte seu carrinho" sem cupom de
  // verdade por trás (coupon_code vazio) -- desconto direto no item, sempre.
  const catalogPromoItemDiscounts = new Map<string, number>()
  let catalogPromoProductDiscount = 0
  for (const l of lines) {
    const promo = promoByProduct.get(l.product.id)
    if (!promo || promo.coupon_code) continue
    const lineTotal = l.product.price * l.item.quantity
    const lineDiscount = promo.discount_type === 'percent' ? (lineTotal * promo.discount_value) / 100 : Math.min(promo.discount_value * l.item.quantity, lineTotal)
    catalogPromoItemDiscounts.set(l.product.id, lineDiscount)
    catalogPromoProductDiscount += lineDiscount
  }

  const discountAmount = Math.min(Math.max(couponProductDiscount + catalogPromoProductDiscount, 0), subtotal)
  const shippingDiscount = Math.min(Math.max(couponShippingDiscount, 0), shippingPrice)
  const total = subtotal - discountAmount + shippingPrice - shippingDiscount

  const applyCoupon = async (codeOverride?: string) => {
    const code = codeOverride ?? couponInput
    if (!code.trim()) return
    setCouponError(null)
    setCouponSelectOpen(false)
    setCouponChecking(true)
    try {
      const digits = customer.whatsapp.replace(/\D/g, '')
      const result = await couponService.validate(code.trim(), undefined, customer.birthdate, digits ? `55${digits}` : undefined)
      setAppliedCoupon(result)
    } catch (e) {
      setAppliedCoupon(null)
      setCouponError(e instanceof ApiError ? e.message : 'Cupom inválido.')
    } finally {
      setCouponChecking(false)
    }
  }

  const handleFinalizeClick = () => {
    if (!customerAuth.token) {
      setShowAuthModal(true)
      return
    }
    handleSubmit()
  }

  const handleSubmit = async () => {
    setError(null)
    if (storeStatus && !getStoreOpenState(storeStatus).open) {
      return setError(closedStoreMessage(storeStatus) || 'Loja FECHADA. Não é possível finalizar o checkout agora.')
    }
    if (lines.length === 0) return setError('Sua sacola está vazia.')
    if (!customer.name.trim()) return setError('Informe seu nome.')
    const digits = customer.whatsapp.replace(/\D/g, '')
    if (digits.length < 10) return setError('Informe um WhatsApp válido.')
    if (tenantConfig?.vende_mais_18) {
      if (!customer.birthdate) return setError('Informe sua data de nascimento.')
      const age = (Date.now() - new Date(customer.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      if (age < 18) return setError('Você precisa ser maior de 18 anos para comprar nesta loja.')
    }
    if (!pickupAtStore && (customer.lat == null || customer.lng == null)) return setError('Escolha sua localização no mapa ou marque retirada no local.')

    setSubmitting(true)
    try {
      const order = await orderService.create({
        customer_name: customer.name.trim(),
        customer_whatsapp: `55${digits}`,
        customer_birthdate: tenantConfig?.vende_mais_18 ? customer.birthdate : customer.birthdate || undefined,
        delivery_type: pickupAtStore ? 'retirada' : 'entrega',
        neighborhood: pickupAtStore ? undefined : customer.neighborhood,
        address: pickupAtStore ? undefined : customer.address,
        reference_point: pickupAtStore ? undefined : customer.referencePoint || undefined,
        customer_lat: pickupAtStore ? undefined : customer.lat ?? undefined,
        customer_lng: pickupAtStore ? undefined : customer.lng ?? undefined,
        payment_method: paymentMethod,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.item.quantity })),
        coupon_code: appliedCoupon?.code,
      })
      clear()
      orderService.notifyCreated(order.id).catch(() => {})
      if (paymentMethod === 'pix') navigate(`/pagamento/${order.id}`)
      else navigate(`/consultar?order=${order.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar seu pedido. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-20 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-4">Finalizar pedido</h1>
        <div className="u3-panel p-4 sm:p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold u3-dim">Seu nome *</label>
            <input className={inputClass} value={customer.name} onChange={(e) => customer.set({ name: e.target.value })} placeholder="Nome completo" />
          </div>
          <div>
            <label className="text-xs font-semibold u3-dim">WhatsApp *</label>
            <input className={inputClass} value={customer.whatsapp} onChange={(e) => customer.set({ whatsapp: formatPhone(e.target.value) })} type="tel" inputMode="numeric" placeholder="(83) 99999-9999" maxLength={15} />
          </div>
          {tenantConfig?.vende_mais_18 && (
            <div>
              <label className="text-xs font-semibold u3-dim">Data de nascimento *</label>
              <input className={inputClass} type="date" value={customer.birthdate} onChange={(e) => customer.set({ birthdate: e.target.value })} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pickupAtStore} onChange={(e) => setPickupAtStore(e.target.checked)} className="w-4 h-4" />
            <Home className="w-3.5 h-3.5" />
            Quero retirar no local
          </label>

          {!pickupAtStore && (
            <>
              <div>
                <label className="text-xs font-semibold u3-dim flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Endereço de entrega *
                </label>
                {customer.lat != null && customer.lng != null ? (
                  <button type="button" onClick={() => setPickerOpen(true)} className="u3-panel w-full flex items-center gap-3 px-3.5 py-2.5 text-left">
                    <MapPin className="w-4 h-4 u3-accent shrink-0" />
                    <span className="flex-1 text-sm truncate">{customer.address || 'Endereço selecionado'}</span>
                    <span className="text-xs u3-dim shrink-0">Editar</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setPickerOpen(true)} className="u3-pill-secondary w-full flex items-center justify-center gap-2 py-3.5 text-sm">
                    <MapPin className="w-4 h-4" /> Escolher localização no mapa
                  </button>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold u3-dim">Ponto de referência</label>
                <input className={inputClass} value={customer.referencePoint} onChange={(e) => customer.set({ referencePoint: e.target.value })} placeholder="Opcional" />
              </div>
            </>
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
                customer.set({
                  address: result.label,
                  neighborhood: result.bairro ?? '',
                  lat: result.lat,
                  lng: result.lng,
                })
                setShippingEstimate(result.estimate ?? null)
                setPickerOpen(false)
              }}
            />
          )}

          <div>
            <label className="text-xs font-semibold u3-dim">Forma de pagamento *</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {([
                { value: 'pix', label: 'Pix', icon: QrCode },
                { value: 'cartao', label: 'Cartão', icon: CreditCard },
                { value: 'dinheiro', label: 'Dinheiro', icon: Wallet },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" onClick={() => setPaymentMethod(value)} className={paymentMethod === value ? 'u3-pill-primary flex flex-col items-center gap-1.5 py-3 text-sm' : 'u3-pill-secondary flex flex-col items-center gap-1.5 py-3 text-sm'}>
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold u3-dim">Cupom de desconto (opcional)</label>
            {appliedCoupon && appliedCoupon.code === autoPromoCode ? (
              <p className="text-xs u3-accent">Desconto de item em promoção já aplicado automaticamente — veja o detalhe no resumo abaixo.</p>
            ) : appliedCoupon ? (
              <div className="flex items-center justify-between u3-panel px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Gift className="w-4 h-4 u3-accent" /> {appliedCoupon.code}
                  {autoCoupon?.code === appliedCoupon.code && <span className="text-[11px] u3-dim font-normal">exclusivo pra você</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null)
                    setCouponInput('')
                  }}
                  className="text-xs u3-dim"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex gap-2">
                  <input className={inputClass + ' uppercase'} value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Código do cupom" />
                  {couponInput.trim() ? (
                    <button type="button" onClick={() => applyCoupon()} disabled={couponChecking} className="u3-pill-secondary px-4 shrink-0">
                      {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setCouponSelectOpen((o) => !o)} className="u3-pill-secondary px-4 shrink-0 flex items-center gap-1.5">
                      <Gift className="w-3.5 h-3.5" />
                      Selecionar
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${couponSelectOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                {couponSelectOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setCouponSelectOpen(false)} aria-hidden="true" />
                    <div className="u3-panel absolute right-0 top-full mt-1 z-30 w-full sm:w-64 overflow-hidden">
                      {customerCoupons.length === 0 ? (
                        <p className="px-3 py-3 text-sm u3-dim text-center">Você não tem cupons exclusivos no momento.</p>
                      ) : (
                        customerCoupons.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                              setCouponInput(c.code)
                              applyCoupon(c.code)
                            }}
                            className="w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2 border-b border-white/5 last:border-b-0"
                          >
                            <span className="font-mono font-semibold">{c.code}</span>
                            <span className="text-xs u3-dim">
                              {c.discount_type === 'percent'
                                ? `-${c.discount_value}%`
                                : c.discount_type != null && c.discount_value != null
                                ? `-${currency(c.discount_value)}`
                                : c.shipping_discount_type === 'percent'
                                ? `-${c.shipping_discount_value}% frete`
                                : 'Frete'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
          </div>

          <div className="u3-panel px-4 py-4 space-y-1.5 text-sm">
            {lines.map((l) => (
              <div key={l.product.id} className="flex justify-between text-xs u3-dim pl-1">
                <span className="truncate pr-2">
                  {l.product.name}
                  {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                </span>
                <span className="shrink-0">{currency(l.product.price * l.item.quantity)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1">
              <span>Subtotal</span>
              <span>{currency(subtotal)}</span>
            </div>
            {catalogPromoProductDiscount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Desconto de produto em promoção</span>
                <span>-{currency(catalogPromoProductDiscount)}</span>
              </div>
            )}
            {couponDiscountTotal > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Desconto de cupom{appliedCoupon ? ` - ${appliedCoupon.code}` : ''}</span>
                <span>-{currency(couponDiscountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between u3-dim">
              <span>Frete</span>
              <span>{pickupAtStore ? 'Retirada no local' : currency(Math.max(shippingPrice - shippingDiscount, 0))}</span>
            </div>
            <div className="flex justify-between items-center pt-1.5">
              <span className="font-bold">Total</span>
              <span className="u3-accent font-black text-lg">{currency(total)}</span>
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button onClick={handleFinalizeClick} disabled={submitting} className="u3-pill-primary w-full text-base py-3.5 flex items-center justify-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Finalizar pedido
          </button>
        </div>

        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSuccess={() => {
              setShowAuthModal(false)
              handleSubmit()
            }}
          />
        )}
      </div>
    </Shell>
  )
}
