import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, CreditCard, Gift, Home, Loader2, MapPin, Phone, QrCode, StickyNote, Tag, User, Wallet } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import LocationPicker from '../components/checkout/LocationPicker'
import BirthdateInput from '../components/checkout/BirthdateInput'
import { api, ApiError } from '../lib/api'
import type { CouponPreview, PromotionalProduct } from '../lib/supabasePublicApi'
import type { Promotion, PaymentMethod, Product, ShippingEstimate } from '../lib/types'
import { useCart } from '../store/cart'
import { useCustomer } from '../store/customer'
import { useCustomerAuth } from '../store/customerAuth'
import CustomerAuthModal from '../components/CustomerAuthModal'

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

type AppliedCoupon = CouponPreview

export default function Checkout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const promotionId = searchParams.get('promocao')
  const { items, clear } = useCart()
  const customer = useCustomer()
  const customerAuth = useCustomerAuth()

  const [products, setProducts] = useState<Product[]>([])
  const [pickupAtStore, setPickupAtStore] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [shippingEstimate, setShippingEstimate] = useState<ShippingEstimate | null>(null)
  // Finalizar exige login — sem sessão, abre o toggle de entrar/criar
  // conta em vez de seguir com o pedido; ao logar/cadastrar com sucesso,
  // tenta finalizar de novo sozinho.
  const [showAuthModal, setShowAuthModal] = useState(false)

  // Checkout de promoção: veio de um clique no banner da landing, com o(s)
  // produto(s) e desconto já definidos pelo admin — ignora o carrinho normal
  // enquanto essa promoção estiver carregada. Na prática esse fluxo tá morto
  // (Landing.tsx manda pra /banner agora), mas os tipos/identificadores
  // seguem acompanhando o rename campaign->promotion por consistência.
  const [promotion, setPromotion] = useState<Promotion | null>(null)
  const [promotionError, setPromotionError] = useState<string | null>(null)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponChecking, setCouponChecking] = useState(false)
  // Cupom exclusivo detectado automaticamente pelo whatsapp digitado — sem
  // precisar digitar código nenhum. Guardado à parte de appliedCoupon pra
  // saber se o que tá aplicado agora veio daqui (trava o campo manual, a
  // não ser que o próprio cupom libere combinar com um avulso).
  const [autoCoupon, setAutoCoupon] = useState<AppliedCoupon | null>(null)
  // Cupons exclusivos desse cliente (já resgatados na raspadinha) — o
  // select do campo de cupom lista esses, pra ele escolher em vez de ter
  // que digitar o código na mão.
  const [customerCoupons, setCustomerCoupons] = useState<AppliedCoupon[]>([])
  const [couponSelectOpen, setCouponSelectOpen] = useState(false)
  // Produto(s) em promoção que já entraram no carrinho — mesmo destaque
  // laranja usado em /catalogo, desconto aplicado sozinho sem digitar cupom.
  const [promoProducts, setPromoProducts] = useState<PromotionalProduct[]>([])
  const [autoPromoCode, setAutoPromoCode] = useState<string | null>(null)

  useEffect(() => {
    api.products.list().then(setProducts)
    api.coupons.listPromotionalProducts().then(setPromoProducts).catch(() => {})
  }, [])

  useEffect(() => {
    if (!promotionId) return
    api.promotions
      .get(promotionId)
      .then(setPromotion)
      .catch(() => setPromotionError('Essa campanha não está mais disponível.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionId])

  // Se o cliente já tinha escolhido um local numa visita anterior, revalida
  // o frete (o preço por km do admin pode ter mudado desde então).
  useEffect(() => {
    if (customer.lat == null || customer.lng == null) return
    api.estimateShipping(customer.lat, customer.lng).then(setShippingEstimate).catch(() => setShippingEstimate(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Identidade do cliente é sempre o telefone (chave primária de verdade,
  // não o nome digitado) — assim que o whatsapp completo é digitado, checa
  // se esse número foi contemplado com algum cupom exclusivo e alimenta o
  // select. NÃO aplica sozinho — o cliente precisa selecionar/digitar um
  // cupom ativamente (era auto-aplicado antes, reportado como indesejado:
  // o campo "opcional" já vinha preenchido sem o cliente fazer nada).
  useEffect(() => {
    const digits = customer.whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setAutoCoupon(null)
      setCustomerCoupons([])
      return
    }
    const timer = setTimeout(() => {
      api.coupons
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
  const lines = promotion
    ? promotion.product_ids
        .map((id) => productById.get(id))
        .filter((p): p is Product => !!p)
        .map((product) => ({ item: { productId: product.id, quantity: 1 }, product }))
    : items
        .map((item) => ({ item, product: productById.get(item.productId) }))
        .filter((l): l is { item: typeof items[number]; product: Product } => !!l.product)
  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.item.quantity, 0)

  const promoByProduct = useMemo(() => {
    const map = new Map<string, PromotionalProduct>()
    for (const p of promoProducts) if (!map.has(p.product_id)) map.set(p.product_id, p)
    return map
  }, [promoProducts])

  // Assim que um produto em promoção entra no carrinho, o cupom dele é
  // aplicado sozinho — não compete com um cupom já digitado/detectado.
  // Só entra aqui quem tem cupom de verdade por trás (coupon_code
  // preenchido) — promoção selfie_service sem cupom (coupon_code vazio)
  // é resolvida direto por catalogPromoItemDiscounts, mais abaixo.
  useEffect(() => {
    if (appliedCoupon) return
    const match = lines.find((l) => promoByProduct.get(l.product.id)?.coupon_code)
    if (!match) return
    const promo = promoByProduct.get(match.product.id)!
    if (autoPromoCode === promo.coupon_code) return
    const digits = customer.whatsapp.replace(/\D/g, '')
    api.coupons
      .validate(promo.coupon_code, promotion?.id, customer.birthdate, digits ? `55${digits}` : undefined)
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

  // Promoção (campanha) e cupom são fontes de desconto separadas — cada uma
  // some numa linha própria no resumo ("Desconto de promoção" / "Desconto de
  // cupom"), mas o cálculo de frete/total usa os dois somados.
  let promotionProductDiscount = 0
  let promotionShippingDiscount = 0
  if (promotion) {
    if (promotion.discount_type === 'percent') promotionProductDiscount = (subtotal * (promotion.discount_value ?? 0)) / 100
    else if (promotion.discount_type === 'fixed') promotionProductDiscount = promotion.discount_value ?? 0
    if (promotion.shipping_discount_type === 'percent')
      promotionShippingDiscount = (shippingPrice * (promotion.shipping_discount_value ?? 0)) / 100
    else if (promotion.shipping_discount_type === 'fixed') promotionShippingDiscount = promotion.shipping_discount_value ?? 0
  }
  const promotionDiscountTotal = promotionProductDiscount + promotionShippingDiscount

  // Mapa produto -> desconto desse item pelo cupom (kind='produto') — usado
  // aqui pro total e também pra linha "item promocional" do resumo.
  const couponItemDiscounts = new Map<string, number>()
  let couponProductDiscount = 0
  let couponShippingDiscount = 0
  if (appliedCoupon) {
    if (appliedCoupon.kind === 'frete') {
      // legado: discount_type/value É a taxa de frete
      couponShippingDiscount =
        appliedCoupon.discount_type === 'percent'
          ? (shippingPrice * (appliedCoupon.discount_value ?? 0)) / 100
          : appliedCoupon.discount_value ?? 0
    } else {
      if (appliedCoupon.kind === 'desconto' && appliedCoupon.discount_type) {
        couponProductDiscount =
          appliedCoupon.discount_type === 'percent'
            ? (subtotal * (appliedCoupon.discount_value ?? 0)) / 100
            : appliedCoupon.discount_value ?? 0
      }
      if (appliedCoupon.kind === 'produto') {
        for (const l of lines) {
          const pd = appliedCoupon.product_discounts?.find((p) => p.product_id === l.product.id)
          if (!pd) continue
          const lineTotal = l.product.price * l.item.quantity
          const lineDiscount =
            pd.discount_type === 'percent' ? (lineTotal * pd.discount_value) / 100 : Math.min(pd.discount_value * l.item.quantity, lineTotal)
          couponItemDiscounts.set(l.product.id, lineDiscount)
          couponProductDiscount += lineDiscount
        }
      }
      if (appliedCoupon.shipping_discount_type) {
        couponShippingDiscount =
          appliedCoupon.shipping_discount_type === 'percent'
            ? (shippingPrice * (appliedCoupon.shipping_discount_value ?? 0)) / 100
            : appliedCoupon.shipping_discount_value ?? 0
      }
    }
  }
  const couponDiscountTotal = couponProductDiscount + couponShippingDiscount

  // Produto com desconto vindo de promoção selfie_service definida em
  // /promoções (coupon_code vem vazio de list_promotional_products — não
  // tem cupom de verdade por trás) vale em QUALQUER checkout, não só
  // quando o cliente veio do banner — aplica direto aqui, sem depender de
  // validar cupom nenhum. Mesma lógica do create_order (ver
  // sunset_promocao_desconto_global_catalogo.sql). Item com cupom REAL
  // (coupon_code preenchido) continua indo pelo fluxo de auto-aplicar
  // cupom acima, não duplica aqui.
  const catalogPromoItemDiscounts = new Map<string, number>()
  let catalogPromoProductDiscount = 0
  for (const l of lines) {
    const promo = promoByProduct.get(l.product.id)
    if (!promo || promo.coupon_code) continue
    const lineTotal = l.product.price * l.item.quantity
    const lineDiscount =
      promo.discount_type === 'percent' ? (lineTotal * promo.discount_value) / 100 : Math.min(promo.discount_value * l.item.quantity, lineTotal)
    catalogPromoItemDiscounts.set(l.product.id, lineDiscount)
    catalogPromoProductDiscount += lineDiscount
  }

  const discountAmount = Math.min(Math.max(promotionProductDiscount + couponProductDiscount + catalogPromoProductDiscount, 0), subtotal)
  const shippingDiscount = Math.min(Math.max(promotionShippingDiscount + couponShippingDiscount, 0), shippingPrice)
  const total = subtotal - discountAmount + shippingPrice - shippingDiscount

  const applyCoupon = async (codeOverride?: string) => {
    const code = codeOverride ?? couponInput
    if (!code.trim()) return
    setCouponError(null)
    setCouponSelectOpen(false)
    setCouponChecking(true)
    try {
      const digits = customer.whatsapp.replace(/\D/g, '')
      const result = await api.coupons.validate(code.trim(), promotion?.id, customer.birthdate, digits ? `55${digits}` : undefined)
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
    if (lines.length === 0) {
      setError(promotion ? 'Essa campanha não tem produtos disponíveis no momento.' : 'Sua sacola está vazia.')
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
        promotion_id: promotion?.id,
      })
      // Checkout de campanha nunca mexeu no carrinho normal — só limpa o
      // carrinho quando o pedido realmente veio dele.
      if (!promotion) clear()
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

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} />
      <PageTransition className="max-w-xl mx-auto px-5 sm:px-10 pt-6 pb-24">
        {promotionError && <p className="error-msg mb-4">{promotionError}</p>}

        {promotion && (
          <div className="glass rounded-2xl p-4 mb-5 flex items-center gap-3">
            <img src={promotion.image_url} alt={promotion.title} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-white truncate">{promotion.title}</p>
              <p className="text-xs text-son-pink font-medium">
                {promotion.discount_type === 'percent' && `${promotion.discount_value}% off`}
                {promotion.discount_type === 'fixed' && `R$ ${promotion.discount_value?.toFixed(2).replace('.', ',')} off`}
                {promotion.discount_type && promotion.shipping_discount_type && ' + '}
                {promotion.shipping_discount_type === 'percent' && `${promotion.shipping_discount_value}% off no frete`}
                {promotion.shipping_discount_type === 'fixed' &&
                  `R$ ${promotion.shipping_discount_value?.toFixed(2).replace('.', ',')} off no frete`}
              </p>
            </div>
          </div>
        )}

        <div className="bg-son-black/75 backdrop-blur-md border border-white/10 rounded-3xl p-4 sm:p-6 space-y-5">
          <div>
            <label className="label">Seu nome *</label>
            <div className="sunset-input-icon-wrap">
              <input
                className="input-field sunset-checkout-input pr-11"
                value={customer.name}
                onChange={(e) => customer.set({ name: e.target.value })}
                placeholder="Nome completo"
              />
              <span className="sunset-input-icon">
                <User />
              </span>
            </div>
          </div>

          <div>
            <label className="label">WhatsApp *</label>
            <div className="sunset-input-icon-wrap">
              <input
                className="input-field sunset-checkout-input pr-11"
                value={customer.whatsapp}
                onChange={(e) => customer.set({ whatsapp: formatPhone(e.target.value) })}
                type="tel"
                inputMode="numeric"
                placeholder="(83) 99999-9999"
                maxLength={15}
              />
              <span className="sunset-input-icon">
                <Phone />
              </span>
            </div>
          </div>

          <div>
            <label className="label">Data de nascimento *</label>
            <BirthdateInput value={customer.birthdate} onChange={(birthdate) => customer.set({ birthdate })} />
            <p className="text-xs text-son-silver-dim mt-1">Exigido por lei — venda de produtos de tabacaria só para maiores de 18 anos.</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-son-silver">
            <input
              type="checkbox"
              checked={pickupAtStore}
              onChange={(e) => setPickupAtStore(e.target.checked)}
              className="w-4 h-4 accent-son-pink"
            />
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
                  className="w-full flex items-center gap-3 bg-son-surface border border-white/10 rounded-2xl px-4 py-3 text-left hover:border-son-pink/40 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-son-pink flex-none" />
                  <span className="flex-1 text-sm text-white truncate">{customer.address || 'Endereço selecionado'}</span>
                  <span className="text-xs text-son-silver-dim flex-none">Editar</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 border border-dashed border-white/15 rounded-2xl px-4 py-4 text-sm text-son-silver-dim hover:border-son-pink/40 hover:text-son-pink transition-colors"
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
              <div className="sunset-input-icon-wrap">
                <input
                  className="input-field sunset-checkout-input pr-11"
                  value={customer.referencePoint}
                  onChange={(e) => customer.set({ referencePoint: e.target.value })}
                  placeholder="Número da casa/Condomínio, observações de entrega..."
                />
                <span className="sunset-input-icon">
                  <StickyNote />
                </span>
              </div>
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
                      ? 'sunset-bg text-white border-transparent'
                      : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
            {paymentMethod !== 'pix' && (
              <p className="text-xs text-son-silver-dim mt-2">
                Pagamento em {paymentMethod === 'cartao' ? 'cartão' : 'dinheiro'} na entrega/retirada.
              </p>
            )}
          </div>

          <div>
            <label className="label">Cupom de desconto (opcional)</label>
            {appliedCoupon && appliedCoupon.code === autoCoupon?.code ? (
              <div>
                <div className="flex items-center justify-between bg-son-surface border border-amber-400/40 rounded-2xl px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <Gift className="w-4 h-4 text-amber-400" /> {appliedCoupon.code}
                    <span className="text-xs text-amber-400/80 font-normal">exclusivo pra você</span>
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
                {autoCoupon?.combinable_with_public && (
                  <div className="flex gap-2 mt-2">
                    <input
                      className="input-field sunset-checkout-input flex-1 uppercase"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Ou digite outro código"
                    />
                    <button
                      type="button"
                      onClick={() => applyCoupon()}
                      disabled={couponChecking || !couponInput.trim()}
                      className="btn-secondary px-4"
                    >
                      {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                    </button>
                  </div>
                )}
              </div>
            ) : appliedCoupon && appliedCoupon.code !== autoPromoCode ? (
              <div className="flex items-center justify-between bg-son-surface border border-son-pink/30 rounded-2xl px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-white">
                  <Tag className="w-4 h-4 text-son-pink" /> {appliedCoupon.code}
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
              <div>
                {appliedCoupon && appliedCoupon.code === autoPromoCode && (
                  <p className="text-xs text-orange-400 mb-2">
                    Desconto de item(ns) em promoção já aplicado automaticamente — veja o detalhe no resumo abaixo.
                  </p>
                )}
                <div className="relative">
                  <div className="flex gap-2">
                    <input
                      className="input-field sunset-checkout-input flex-1 uppercase"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Código do cupom"
                    />
                    {couponInput.trim() ? (
                      // Digitou algo — vira "Aplicar" pra validar o código avulso.
                      <button
                        type="button"
                        onClick={() => applyCoupon()}
                        disabled={couponChecking}
                        className="btn-secondary px-4 flex-shrink-0"
                      >
                        {couponChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aplicar'}
                      </button>
                    ) : (
                      // Campo vazio — vira "Selecionar", abre a lista dos
                      // cupons exclusivos desse cliente (já resgatados).
                      <button
                        type="button"
                        onClick={() => setCouponSelectOpen((o) => !o)}
                        className={`sunset-coupon-select-btn px-4 flex-shrink-0 flex items-center gap-1.5 ${couponSelectOpen ? 'sunset-coupon-select-btn-open' : ''}`}
                      >
                        <Gift className="w-3.5 h-3.5" />
                        Selecionar
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${couponSelectOpen ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                  {couponSelectOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setCouponSelectOpen(false)} aria-hidden="true" />
                      <div className="absolute right-0 top-full mt-1 z-30 w-full sm:w-64 bg-son-surface border border-son-gold/40 rounded-xl shadow-xl overflow-hidden">
                        {customerCoupons.length === 0 ? (
                          <p className="px-3 py-3 text-sm text-son-silver-dim text-center">Você não tem cupons exclusivos no momento.</p>
                        ) : (
                          customerCoupons.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => {
                                setCouponInput(c.code)
                                applyCoupon(c.code)
                              }}
                              className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-white/5 flex items-center justify-between gap-2 border-b border-white/5 last:border-b-0"
                            >
                              <span className="font-mono font-semibold">{c.code}</span>
                              <span className="text-xs text-son-silver-dim">
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
              </div>
            )}
            {couponError && <p className="error-msg mt-1">{couponError}</p>}
          </div>

          <div className="bg-son-black/70 border border-white/10 rounded-2xl pt-4 px-4 pb-4 space-y-1 text-sm">
            {lines.map((l) => {
              const lineTotal = l.product.price * l.item.quantity
              const pd = appliedCoupon?.kind === 'produto' ? appliedCoupon.product_discounts?.find((p) => p.product_id === l.product.id) : undefined
              const catalogPromo = !pd ? promoByProduct.get(l.product.id) : undefined
              const isCatalogPromoItem = catalogPromo && !catalogPromo.coupon_code
              if (pd || isCatalogPromoItem) {
                const lineDiscount = pd ? couponItemDiscounts.get(l.product.id) ?? 0 : catalogPromoItemDiscounts.get(l.product.id) ?? 0
                const finalTotal = Math.max(lineTotal - lineDiscount, 0)
                const discountType = pd ? pd.discount_type : catalogPromo!.discount_type
                const discountValue = pd ? pd.discount_value : catalogPromo!.discount_value
                const discountText = discountType === 'percent' ? `-${discountValue}%` : `-${currency(discountValue)}`
                return (
                  <div key={l.product.id} className="flex justify-between items-baseline text-xs pl-3 gap-2">
                    <span className="truncate pr-2 text-orange-400">
                      {l.product.name}
                      {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                    </span>
                    <span className="flex-shrink-0 flex items-center gap-1.5">
                      <span className="text-red-500 line-through decoration-2">{currency(lineTotal)}</span>
                      <span className="text-orange-400">{discountText}</span>
                      <span className="text-orange-400 font-bold">{currency(finalTotal)}</span>
                    </span>
                  </div>
                )
              }
              return (
                <div key={l.product.id} className="flex justify-between text-xs text-son-silver-dim pl-3">
                  <span className="truncate pr-2">
                    {l.product.name}
                    {l.item.quantity > 1 ? ` x${l.item.quantity}` : ''}
                  </span>
                  <span className="flex-shrink-0">{currency(lineTotal)}</span>
                </div>
              )
            })}
            {promotionDiscountTotal > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Desconto de promoção{promotion ? ` - ${promotion.title}` : ''}</span>
                <span>-{currency(promotionDiscountTotal)}</span>
              </div>
            )}
            {couponDiscountTotal > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Desconto de cupom{appliedCoupon ? ` - ${appliedCoupon.code}` : ''}</span>
                <span>-{currency(couponDiscountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-son-silver-dim">
              <span>Frete</span>
              <span>
                {pickupAtStore ? (
                  'Retirada no local'
                ) : shippingDiscount >= shippingPrice && shippingPrice > 0 ? (
                  <span className="text-emerald-400">Grátis</span>
                ) : shippingDiscount > 0 ? (
                  <span className="text-emerald-400">{currency(shippingPrice - shippingDiscount)}</span>
                ) : (
                  currency(shippingPrice)
                )}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-white">Total</span>
              <span className="sunset-text font-black text-lg">{currency(total)}</span>
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button onClick={handleFinalizeClick} disabled={submitting} className="btn-primary sunset-checkout-submit w-full text-base py-4">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Finalizar pedido
          </button>
        </div>
      </PageTransition>
      {showAuthModal && (
        <CustomerAuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false)
            handleSubmit()
          }}
        />
      )}
    </main>
  )
}
