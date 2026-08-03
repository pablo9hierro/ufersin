import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { ChevronDown, CreditCard, Gift, Home, Loader2, MapPin, Package, QrCode, Wallet } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { productService } from '../../services/productService'
import { couponService } from '../../services/couponService'
import { shippingService } from '../../services/shippingService'
import { orderService } from '../../services/orderService'
import type { CouponPreview, PaymentMethod, Product, PromotionalProduct, ShippingEstimate } from '../../types'
import { useCart } from '../../store/cart'
import { useCustomer } from '../../store/customer'
import { useCustomerAuth } from '../../store/customerAuth'
import LocationPicker from '../../components/checkout/LocationPicker'
import PickupOnlyNotice from '../../components/checkout/PickupOnlyNotice'
import Shell from '../components/Shell'
import { currency } from '../components/ProductCard'
import EmptyState from '../components/EmptyState'
import AuthModal from '../components/AuthModal'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { useStoreStatus } from '../../hooks/useStoreStatus'
import { deliveryPixOnlyError, resolveTenantSlug, tenantHasOnlinePix} from '../../lib/tenantConfig'
import { closedStoreMessage, getStoreOpenState } from '../../lib/storeHours'
import CashAmountInput from '../../components/CashAmountInput'
import { cashCoversTotal } from '../../lib/cashMask'

const RODOLETAS_API_URL = import.meta.env.VITE_RODOLETAS_API_URL || 'http://localhost:8081'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

const inputClass = 'u2-surface w-full px-3.5 py-2.5 text-sm outline-none'

export default function Uiux2Checkout() {
  const navigate = useNavigate()
  const { items, clear } = useCart()
  const customer = useCustomer()
  const customerAuth = useCustomerAuth()
  const tenantConfig = useTenantConfig()
  const { data: storeStatus } = useStoreStatus()

  const [products, setProducts] = useState<Product[]>([])
  const [pickupAtStore, setPickupAtStore] = useState(false)
  const apenasRetirada = !!tenantConfig?.apenas_retirada
  const pickup = apenasRetirada || pickupAtStore
  const payAtPickup = !!tenantConfig?.pagamento_na_retirada && pickup
  const entregaSomentePix = !!tenantConfig?.entrega_somente_pix
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [cashCents, setCashCents] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aceiteCompraNormal, setAceiteCompraNormal] = useState(false)
  const [aceiteMais18, setAceiteMais18] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shippingEstimate, setShippingEstimate] = useState<ShippingEstimate | null>(null)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<CouponPreview | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponChecking, setCouponChecking] = useState(false)
  // Cupons exclusivos detectados pelo whatsapp digitado -- só alimentam a
  // lista de seleção abaixo, nunca aplicam nada sozinhos.
  const [customerCoupons, setCustomerCoupons] = useState<CouponPreview[]>([])
  const [couponSelectOpen, setCouponSelectOpen] = useState(false)
  // Produto(s) em promoção de catálogo (desconto próprio, com ou sem cupom
  // atrelado) que já estão no carrinho.
  const [promoProducts, setPromoProducts] = useState<PromotionalProduct[]>([])
  const [autoPromoCode, setAutoPromoCode] = useState<string | null>(null)

  useEffect(() => {
    productService.list().then(setProducts)
    couponService.listPromotionalProducts().then(setPromoProducts).catch(() => {})
  }, [])

  useEffect(() => {
    if (apenasRetirada) setPickupAtStore(true)
  }, [apenasRetirada])

  useEffect(() => {
    if (entregaSomentePix && !pickup && paymentMethod !== 'pix') setPaymentMethod('pix')
  }, [entregaSomentePix, pickup, paymentMethod])

  // Se o cliente já tinha escolhido um endereço numa visita anterior,
  // revalida o frete (o preço por km pode ter mudado desde então).
  useEffect(() => {
    if (customer.lat == null || customer.lng == null) return
    shippingService.estimate(customer.lat, customer.lng).then(setShippingEstimate).catch(() => setShippingEstimate(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Assim que o whatsapp completo é digitado (após uma pausa), checa se
  // esse número tem cupons exclusivos -- só popula a lista de seleção, não
  // aplica nada sozinho.
  useEffect(() => {
    const digits = customer.whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setCustomerCoupons([])
      return
    }
    const timer = setTimeout(() => {
      couponService
        .listForCustomer(`55${digits}`)
        .then(setCustomerCoupons)
        .catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [customer.whatsapp])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const lines = items.map((item) => ({ item, product: productById.get(item.productId) })).filter((l): l is { item: (typeof items)[number]; product: Product } => !!l.product)
  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)
  const shippingPrice = pickup ? 0 : shippingEstimate?.price ?? 0

  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const p of promoProducts) if (!map.has(p.product_id)) map.set(p.product_id, p)
    return map
  }, [promoProducts])

  // Assim que um produto com cupom de promoção de catálogo entra no
  // carrinho, o cupom dele é aplicado sozinho -- só se nenhum outro cupom
  // já estiver aplicado.
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

  // Se o item que trouxe o desconto sai do carrinho, o cupom automático
  // some junto.
  useEffect(() => {
    if (!autoPromoCode || appliedCoupon?.code !== autoPromoCode) return
    const stillInCart = lines.some((l) => promoByProduct.get(l.product.id)?.coupon_code === autoPromoCode)
    if (!stillInCart) {
      setAppliedCoupon(null)
      setAutoPromoCode(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, promoByProduct, autoPromoCode])

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

  // Produto com desconto de promoção de catálogo SEM cupom de verdade por
  // trás (promoção "monte seu carrinho" sem coupon_code) -- vale sozinho,
  // sem depender de validar cupom nenhum.
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
      if (!aceiteMais18) return setError('Aceite o consentimento para compra de produtos 18+ para continuar.')
    }
    if (!pickup && (customer.lat == null || customer.lng == null)) return setError('Escolha sua localização no mapa ou marque retirada no local.')
    if (!aceiteCompraNormal) return setError('Aceite os termos de consentimento de compra para continuar.')

    const deliveryErr = deliveryPixOnlyError(tenantConfig, pickup, paymentMethod)
    if (deliveryErr) {
      setError(deliveryErr)
      return
    }
    if (paymentMethod === 'dinheiro' && !cashCoversTotal(cashCents, total)) {
      setError('Informe um valor em dinheiro maior ou igual ao total do pedido.')
      return
    }
    setSubmitting(true)
    try {
      const slug = resolveTenantSlug() || tenantConfig?.slug
      const acceptKinds = tenantConfig?.vende_mais_18
        ? (['checkout_compra_normal', 'checkout_mais18'] as const)
        : (['checkout_compra_normal'] as const)
      if (slug) {
        await Promise.allSettled(
          acceptKinds.map((kind) =>
            fetch(`${RODOLETAS_API_URL}/api/public/contratos/accept-checkout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind,
                tenant_slug: slug,
                acceptor_email: customerAuth.customer?.email ?? undefined,
                acceptor_name: customer.name.trim(),
                channel: 'checkbox',
              }),
            }),
          ),
        )
      }

      const order = await orderService.create({
        customer_name: customer.name.trim(),
        customer_whatsapp: `55${digits}`,
        customer_birthdate: tenantConfig?.vende_mais_18 ? customer.birthdate : customer.birthdate || undefined,
        delivery_type: pickup ? 'retirada' : 'entrega',
        neighborhood: pickup ? undefined : customer.neighborhood,
        address: pickup ? undefined : customer.address,
        reference_point: pickup ? undefined : customer.referencePoint || undefined,
        customer_lat: pickup ? undefined : customer.lat ?? undefined,
        customer_lng: pickup ? undefined : customer.lng ?? undefined,
        payment_method: paymentMethod,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.item.quantity })),
        coupon_code: appliedCoupon?.code,
      })
      clear()
      orderService.notifyCreated(order.id).catch(() => {})
      if (paymentMethod === 'pix' && tenantHasOnlinePix(tenantConfig) && !payAtPickup) {
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

  if (lines.length === 0) {
    return (
      <Shell>
        <div className="px-4 sm:px-8 pt-6">
          <EmptyState icon={Package} message="Sua sacola está vazia." actionLabel="Ver catálogo" actionHref="/catalogo" />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-20 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-4">Finalizar pedido</h1>
        <div className="u2-card p-4 sm:p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold u2-dim">Seu nome *</label>
            <input className={inputClass} value={customer.name} onChange={(e) => customer.set({ name: e.target.value })} placeholder="Nome completo" />
          </div>
          <div>
            <label className="text-xs font-semibold u2-dim">WhatsApp *</label>
            <input className={inputClass} value={customer.whatsapp} onChange={(e) => customer.set({ whatsapp: formatPhone(e.target.value) })} type="tel" inputMode="numeric" placeholder="(83) 99999-9999" maxLength={15} />
          </div>
          {tenantConfig?.vende_mais_18 && (
            <div>
              <label className="text-xs font-semibold u2-dim">Data de nascimento *</label>
              <input className={inputClass} type="date" value={customer.birthdate} onChange={(e) => customer.set({ birthdate: e.target.value })} />
            </div>
          )}

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
            {payAtPickup && (
              <p className="text-xs u2-dim mt-1 mb-2">
                O pagamento será processado no ato da retirada na loja — sem cobrança Pix agora.
              </p>
            )}
            {entregaSomentePix && !pickup && (
              <p className="text-xs u2-dim mt-1 mb-2">
                Entrega só com Pix pago no checkout. Cartão e dinheiro são só para retirada na loja.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(
                [
                  { value: 'pix', label: 'Pix', icon: QrCode },
                  { value: 'cartao', label: 'Cartão', icon: CreditCard },
                  { value: 'dinheiro', label: 'Dinheiro', icon: Wallet },
                ] as const
              )
                .filter(({ value }) => !(entregaSomentePix && !pickup && value !== 'pix'))
                .map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" onClick={() => { setPaymentMethod(value); if (value !== 'dinheiro') setCashCents(0) }} className={paymentMethod === value ? 'u2-btn-primary flex flex-col items-center gap-1.5 py-3 text-sm' : 'u2-btn-secondary flex flex-col items-center gap-1.5 py-3 text-sm'}>
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
            {paymentMethod === 'dinheiro' && (
              <CashAmountInput
                className="mt-3"
                orderTotal={total}
                valueCents={cashCents}
                onChange={setCashCents}
                inputClassName={inputClass + ' pl-10 font-mono tabular-nums tracking-wide'}
                trocoClassName={`text-sm font-semibold whitespace-nowrap ${cashCents / 100 < total ? 'text-amber-500' : 'u2-accent'}`}
              />
            )}
          </div>

          <div>
            <label className="text-xs font-semibold u2-dim">Cupom de desconto (opcional)</label>
            {appliedCoupon ? (
              <div>
                <div className="flex items-center justify-between u2-surface px-3.5 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Gift className="w-4 h-4 u2-accent" /> {appliedCoupon.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedCoupon(null)
                      setAutoPromoCode(null)
                      setCouponInput('')
                    }}
                    className="text-xs u2-dim"
                  >
                    Remover
                  </button>
                </div>
                {appliedCoupon.code === autoPromoCode && <p className="text-xs u2-accent mt-1.5">Desconto de item em promoção aplicado automaticamente.</p>}
              </div>
            ) : (
              <div className="relative">
                <div className="flex gap-2">
                  <input className={inputClass + ' uppercase'} value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Código do cupom" />
                  {couponInput.trim() ? (
                    <button type="button" onClick={() => applyCoupon()} disabled={couponChecking} className="u2-btn-secondary px-4 shrink-0">
                      {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setCouponSelectOpen((o) => !o)} className="u2-btn-secondary px-4 shrink-0 flex items-center gap-1.5">
                      <Gift className="w-3.5 h-3.5" />
                      Selecionar
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${couponSelectOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                {couponSelectOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setCouponSelectOpen(false)} aria-hidden="true" />
                    <div className="u2-card absolute right-0 top-full mt-1 z-30 w-full sm:w-64 p-1 overflow-hidden">
                      {customerCoupons.length === 0 ? (
                        <p className="px-3 py-3 text-sm u2-dim text-center">Você não tem cupons exclusivos no momento.</p>
                      ) : (
                        customerCoupons.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                              setCouponInput(c.code)
                              applyCoupon(c.code)
                            }}
                            className="w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2"
                          >
                            <span className="font-mono font-semibold">{c.code}</span>
                            <span className="text-xs u2-dim">
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

          <div className="u2-surface px-4 py-4 space-y-1.5 text-sm">
            {lines.map((l) => {
              const lineTotal = l.product.price * l.item.quantity
              const pd = appliedCoupon?.kind === 'produto' ? appliedCoupon.product_discounts?.find((p) => p.product_id === l.product.id) : undefined
              const catalogPromo = !pd ? promoByProduct.get(l.product.id) : undefined
              const isCatalogPromoItem = catalogPromo && !catalogPromo.coupon_code
              if (pd || isCatalogPromoItem) {
                const lineDiscount = pd ? couponItemDiscounts.get(l.product.id) ?? 0 : catalogPromoItemDiscounts.get(l.product.id) ?? 0
                const finalTotal = Math.max(lineTotal - lineDiscount, 0)
                return (
                  <div key={l.product.id} className="flex justify-between items-baseline text-xs gap-2">
                    <span className="truncate pr-2 u2-accent">
                      {l.product.name}
                      {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5">
                      <span className="text-red-500 line-through">{currency(lineTotal)}</span>
                      <span className="u2-accent font-bold">{currency(finalTotal)}</span>
                    </span>
                  </div>
                )
              }
              return (
                <div key={l.product.id} className="flex justify-between text-xs u2-dim">
                  <span className="truncate pr-2">
                    {l.product.name}
                    {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                  </span>
                  <span className="shrink-0">{currency(lineTotal)}</span>
                </div>
              )
            })}
            {discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Desconto{appliedCoupon ? ` - ${appliedCoupon.code}` : ''}</span>
                <span>-{currency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between u2-dim">
              <span>Frete</span>
              <span>{pickup ? 'Retirada no local' : currency(Math.max(shippingPrice - shippingDiscount, 0))}</span>
            </div>
            <div className="flex justify-between items-center pt-1.5">
              <span className="font-bold">Total</span>
              <span className="u2-accent font-black text-lg">{currency(total)}</span>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs u2-dim">
              <input
                type="checkbox"
                checked={aceiteCompraNormal}
                onChange={(e) => setAceiteCompraNormal(e.target.checked)}
                className="w-4 h-4 mt-0.5"
              />
              <span>
                <span className="block font-semibold mb-0.5" style={{ color: 'inherit' }}>
                  Aceito os termos de compra
                </span>
                Consentimento de compra normal registrado localmente (checkbox).
              </span>
            </label>
            {tenantConfig?.vende_mais_18 && (
              <label className="flex items-start gap-2.5 cursor-pointer text-xs u2-dim">
                <input
                  type="checkbox"
                  checked={aceiteMais18}
                  onChange={(e) => setAceiteMais18(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                />
                <span>
                  <span className="block font-semibold mb-0.5" style={{ color: 'inherit' }}>
                    Aceito os termos para maiores de 18
                  </span>
                  Esta loja pode vender produtos 18+ — os dois consentimentos se aplicam ao checkout.
                </span>
              </label>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleFinalizeClick}
            disabled={submitting || !aceiteCompraNormal || (tenantConfig?.vende_mais_18 && !aceiteMais18)}
            className="u2-btn-primary w-full text-base py-3.5 flex items-center justify-center gap-2"
          >
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
