import { tenantHasOnlinePix } from '../../lib/tenantConfig'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { QRCodeSVG } from 'qrcode.react'
import {
  Camera,
  CheckCircle2,
  Copy,
  Loader2,
  Minus,
  Package,
  Plus,
  QrCode,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { filterPdvProducts, findProductByBarcode, pdvCartTotals } from '../../lib/pdvHelpers'
import { orderService } from '../../services/orderService'
import { pdvService } from '../../services/pdvService'
import type { Order, PaymentMethod, Product } from '../../types'
import CashAmountInput from '../../components/CashAmountInput'
import { cashCoversTotal, formatCashMask, formatTrocoLabel, computeTroco } from '../../lib/cashMask'
import CardPaymentDialog from '../../components/checkout/CardPaymentDialog'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function paymentMethodLabel(method: PaymentMethod): string {
  if (method === 'cartao') return 'cartão'
  return method
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

interface CartLine {
  product: Product
  quantity: number
}

export default function AdminPdv() {
  const tenantConfig = useTenantConfig()
  const plataformaPix = tenantHasOnlinePix(tenantConfig)

  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [query, setQuery] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)

  const [scannerOpen, setScannerOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)

  const barcodeInputRef = useRef<HTMLInputElement>(null)

  const [customerName, setCustomerName] = useState('')
  const [customerWhatsapp, setCustomerWhatsapp] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('dinheiro')
  // "Não gerar QR" — unchecked por padrão (gera QR). Só força marcado quando
  // a loja está em cobrança manual (sem plataforma de Pix).
  const [skipQrcode, setSkipQrcode] = useState(false)
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  const [confirmCashOpen, setConfirmCashOpen] = useState(false)
  const [cashCents, setCashCents] = useState(0)
  // Cartão de verdade via Mercado Pago (mesma conta do Pix): escolhe a
  // forma ANTES de existir venda (a venda já nasce pendente pra link/
  // transparente) — NFC continua nascendo paga na hora, igual sempre foi.
  const [cardChoiceOpen, setCardChoiceOpen] = useState(false)
  const [cardDialog, setCardDialog] = useState<{ order: Order; step: 'link' | 'transparente' } | null>(null)
  const [pixOrder, setPixOrder] = useState<Order | null>(null)
  const [pixPaidFlash, setPixPaidFlash] = useState(false)
  const [regeneratingPix, setRegeneratingPix] = useState(false)
  const [copiedPix, setCopiedPix] = useState(false)

  // Enquanto o modal Pix estiver aberto, consulta o gateway; ao confirmar
  // pagamento envia msg 3 (WhatsApp) no backend e fecha o modal.
  useEffect(() => {
    if (!pixOrder?.id || pixOrder.payment_status === 'pago') return
    let cancelled = false
    const tick = async () => {
      try {
        const updated = await orderService.refreshPayment(pixOrder.id)
        if (cancelled) return
        if (updated.payment_status === 'pago') {
          setPixPaidFlash(true)
          setPixOrder(null)
          setTimeout(() => setPixPaidFlash(false), 4000)
        } else {
          setPixOrder(updated)
        }
      } catch {
        // polling best-effort
      }
    }
    const id = window.setInterval(tick, 4000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [pixOrder?.id, pixOrder?.payment_status])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      setLoadingProducts(true)
      // Mesma fonte do CRUD admin no Railway (JWT); catálogo público no
      // Supabase legado. Recarrega ao focar a aba pra produto recém-criado
      // aparecer sem F5.
      pdvService
        .listProducts()
        .then((p) => {
          if (!cancelled) setProducts(p.filter((x) => x.active !== false))
        })
        .finally(() => {
          if (!cancelled) setLoadingProducts(false)
        })
    }
    load()
    const onFocus = () => load()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    // Desmarcado = gerar QR (plataforma). Marcado forçado só em cobrança manual.
    setSkipQrcode(!plataformaPix)
  }, [plataformaPix])

  // Leitor físico (bip) é um teclado disfarçado — digita o código rapidinho
  // e manda Enter sozinho. Mantendo esse campo sempre focado, o vendedor
  // só aponta e aperta o gatilho, sem precisar tocar na tela.
  useEffect(() => {
    barcodeInputRef.current?.focus()
  }, [])

  const results = useMemo(() => filterPdvProducts(products, query), [query, products])

  const cartLines = Object.values(cart)
  const { subtotal: cartSubtotal, discount: discountAmount, total: cartTotal } = pdvCartTotals(
    cartLines.map((l) => ({ price: l.product.price, quantity: l.quantity })),
    discountType,
    Number(discountValue) || 0
  )

  const addToCart = (product: Product, qty = 1) => {
    setCart((c) => {
      const existing = c[product.id]
      const nextQty = (existing?.quantity ?? 0) + qty
      if (nextQty > product.quantity) {
        setScanError(`Só tem ${product.quantity} em estoque de ${product.name}.`)
        return c
      }
      setScanError(null)
      return { ...c, [product.id]: { product, quantity: nextQty } }
    })
  }

  const changeQty = (productId: string, delta: number) => {
    setCart((c) => {
      const line = c[productId]
      if (!line) return c
      const nextQty = line.quantity + delta
      if (nextQty <= 0) {
        const { [productId]: _removed, ...rest } = c
        return rest
      }
      if (nextQty > line.product.quantity) return c
      return { ...c, [productId]: { ...line, quantity: nextQty } }
    })
  }

  const removeFromCart = (productId: string) => {
    setCart((c) => {
      const { [productId]: _removed, ...rest } = c
      return rest
    })
  }

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = barcodeInput.trim()
    setBarcodeInput('')
    if (!code) return
    const product = findProductByBarcode(products, code)
    if (!product) {
      setScanError(`Nenhum produto com o código de barras "${code}".`)
      return
    }
    addToCart(product)
  }

  const openScanner = async () => {
    setScanError(null)
    setScannerOpen(true)
  }

  const closeScanner = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setScannerOpen(false)
    barcodeInputRef.current?.focus()
  }

  // Câmera só é iniciada DEPOIS do <video> já estar montado (scannerOpen
  // true), senão videoRef.current ainda é null — mesma armadilha de timing
  // que já mordeu o mapa em outras telas desse projeto.
  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return
    let cancelled = false
    const reader = new BrowserMultiFormatReader()
    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result, _err, controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        if (!result) return
        const code = result.getText()
        const product = findProductByBarcode(products, code)
        if (!product) {
          setScanError(`Nenhum produto com o código de barras "${code}".`)
          return
        }
        addToCart(product)
        closeScanner()
      })
      .catch(() => {
        if (!cancelled) setScanError('Não consegui acessar a câmera. Verifique a permissão do navegador.')
      })
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen])

  const resetFormAfterSale = (total: number) => {
    setSuccess(total)
    setCart({})
    setCustomerName('')
    setCustomerWhatsapp('')
    setPaymentMethod('dinheiro')
    setSkipQrcode(!plataformaPix)
    setDiscountType('percent')
    setDiscountValue('')
    pdvService.listProducts().then((p) => setProducts(p.filter((x) => x.active !== false)))
    setTimeout(() => setSuccess(null), 4000)
  }

  const buildSalePayload = () => ({
    items: cartLines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
    payment_method: paymentMethod,
    customer_name: customerName.trim() || undefined,
    customer_whatsapp: customerWhatsapp.replace(/\D/g, '') ? `55${customerWhatsapp.replace(/\D/g, '')}` : undefined,
    discount_type: discountAmount > 0 ? discountType : undefined,
    discount_value: discountAmount > 0 ? Number(discountValue) || 0 : undefined,
  })

  /** Dinheiro / cartão / Pix sem QR: baixa imediata + WhatsApp "obrigado". */
  const commitSalePaid = async () => {
    const order = await pdvService.createSale(buildSalePayload())
    pdvService.notifySale(order.id).catch(() => {})
    resetFormAfterSale(cartTotal)
  }

  const finalizeSale = async () => {
    if (cartLines.length === 0) return
    setFinalizeError(null)

    // Pix + gerar QR (plataforma): cria venda, gera cobrança, mostra QR e
    // manda copia-cola no WhatsApp do comprador se informado.
    if (paymentMethod === 'pix' && plataformaPix && !skipQrcode) {
      setFinalizing(true)
      try {
        const order = await pdvService.createSale(buildSalePayload())
        let withPix = order
        try {
          withPix = await orderService.createPixPayment(order.id)
          if (!withPix.pix_copia_cola) {
            throw new ApiError(502, 'Cobrança Pix sem QR / copia-e-cola.')
          }
        } catch (e) {
          setFinalizeError(
            e instanceof ApiError
              ? e.message
              : 'Venda criada, mas não foi possível gerar o QR Pix. Confirme o pagamento manualmente.',
          )
          // Ainda mostra o modal pra confirmar baixa mesmo sem QR.
          setPixOrder(order)
          resetFormAfterSale(cartTotal)
          return
        }
        setPixOrder(withPix)
        if (withPix.customer_whatsapp?.replace(/\D/g, '')) {
          pdvService.notifyPixCharge(withPix.id).catch(() => {})
        }
        resetFormAfterSale(cartTotal)
      } catch (e) {
        setFinalizeError(e instanceof ApiError ? e.message : 'Não foi possível finalizar a venda.')
      } finally {
        setFinalizing(false)
      }
      return
    }

    // Cartão de verdade (conta MP conectada): pergunta NFC/link/transparente
    // antes de criar a venda — sem MP conectado, cai no fluxo antigo abaixo
    // (confirmação manual, igual dinheiro).
    if (paymentMethod === 'cartao' && plataformaPix) {
      setCardChoiceOpen(true)
      return
    }

    // Dinheiro / cartão sem MP / Pix sem QR: diálogo de confirmação de recebimento.
    if (paymentMethod === 'dinheiro') setCashCents(0)
    setConfirmCashOpen(true)
  }

  const confirmCashReceived = async () => {
    if (paymentMethod === 'dinheiro' && !cashCoversTotal(cashCents, cartTotal)) {
      setFinalizeError('Informe o valor recebido em dinheiro (maior ou igual ao total).')
      return
    }
    setFinalizing(true)
    setFinalizeError(null)
    try {
      await commitSalePaid()
      setConfirmCashOpen(false)
    } catch (e) {
      setFinalizeError(e instanceof ApiError ? e.message : 'Não foi possível finalizar a venda.')
    } finally {
      setFinalizing(false)
    }
  }

  // NFC = maquininha física do lojista, fora do nosso sistema — mesma
  // venda "nasce paga" de sempre, só que agora atrás de uma escolha
  // explícita em vez de cair direto no cartão como único caminho.
  const handleCardNfc = async () => {
    setCardChoiceOpen(false)
    setFinalizing(true)
    setFinalizeError(null)
    try {
      await commitSalePaid()
    } catch (e) {
      setFinalizeError(e instanceof ApiError ? e.message : 'Não foi possível finalizar a venda.')
    } finally {
      setFinalizing(false)
    }
  }

  // Link/transparente: a venda nasce pendente (backend só marca 'pago' de
  // verdade depois que o cliente completar o pagamento online).
  const handleCardOnline = async (mode: 'link' | 'transparente') => {
    setCardChoiceOpen(false)
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const order = await pdvService.createSale({ ...buildSalePayload(), card_payment_mode: mode })
      setCardDialog({ order, step: mode })
    } catch (e) {
      setFinalizeError(e instanceof ApiError ? e.message : 'Não foi possível iniciar a venda.')
    } finally {
      setFinalizing(false)
    }
  }

  const dismissPixModal = () => {
    if (regeneratingPix) return
    setPixOrder(null)
  }

  const regeneratePixCharge = async () => {
    if (!pixOrder) return
    setRegeneratingPix(true)
    setFinalizeError(null)
    try {
      const withPix = await orderService.createPixPayment(pixOrder.id, true)
      if (!withPix.pix_copia_cola) {
        throw new ApiError(502, 'Nova cobrança criada sem QR / copia-e-cola.')
      }
      setPixOrder(withPix)
      if (withPix.customer_whatsapp?.replace(/\D/g, '')) {
        // Reenvia msg 1 (resumo) + msg 2 (novo copia-e-cola).
        pdvService.notifyPixCharge(withPix.id).catch(() => {})
      }
    } catch (e) {
      setFinalizeError(
        e instanceof ApiError ? e.message : 'Não foi possível gerar nova cobrança Pix.',
      )
    } finally {
      setRegeneratingPix(false)
    }
  }

  const copyPixCode = () => {
    if (!pixOrder?.pix_copia_cola) return
    navigator.clipboard.writeText(pixOrder.pix_copia_cola)
    setCopiedPix(true)
    setTimeout(() => setCopiedPix(false), 2000)
  }

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">PDV — nova venda</h1>

      {success !== null && !pixOrder && (
        <div className="mb-6 flex items-center gap-2 bg-emerald-500/15 text-emerald-400 rounded-2xl px-4 py-3 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          Venda de {currency(success)} finalizada com sucesso!
        </div>
      )}
      {pixPaidFlash && (
        <div className="mb-6 flex items-center gap-2 bg-emerald-500/15 text-emerald-400 rounded-2xl px-4 py-3 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          Pagamento Pix confirmado!
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <form onSubmit={handleBarcodeSubmit} className="mb-4">
            <label className="label flex items-center gap-1.5">
              <ScanBarcode className="w-3.5 h-3.5" /> Bipar código de barras
            </label>
            <div className="flex gap-2">
              <input
                ref={barcodeInputRef}
                className="input-field"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Aponte o leitor ou digite o código..."
                autoFocus
              />
              <button type="button" onClick={openScanner} className="btn-secondary px-4 flex-none" aria-label="Escanear com a câmera">
                <Camera className="w-4 h-4" />
              </button>
            </div>
          </form>

          {scanError && <p className="error-msg mb-4">{scanError}</p>}

          <div className="mb-2">
            <label className="label flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" /> Buscar produto pelo nome
            </label>
            <input
              className="input-field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite pelo menos 2 letras..."
            />
          </div>

          {loadingProducts ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
            </div>
          ) : (
            query.trim().length >= 2 && (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-xs text-son-silver-dim py-3">Nenhum produto encontrado.</p>
                ) : (
                  results.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      disabled={p.quantity <= 0}
                      className="w-full flex items-center gap-3 bg-son-surface border border-white/5 rounded-2xl px-3 py-2.5 text-left hover:border-son-pink/30 transition-colors disabled:opacity-40"
                    >
                      <div className="w-10 h-10 rounded-lg bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-4 h-4 text-son-silver-dim/40" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{p.name}</p>
                        <p className="text-xs text-son-silver-dim">{p.quantity} em estoque</p>
                      </div>
                      <span className="sunset-text font-bold text-sm flex-none">{currency(p.price)}</span>
                    </button>
                  ))
                )}
              </div>
            )
          )}
        </div>

        <div>
          <p className="label mb-2">Carrinho da venda</p>
          {cartLines.length === 0 ? (
            <div className="text-center py-10 text-son-silver-dim bg-son-surface border border-white/5 rounded-2xl">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Bipe, escaneie ou busque um produto pra começar.</p>
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {cartLines.map((l) => (
                <div key={l.product.id} className="flex items-center gap-3 bg-son-surface border border-white/5 rounded-2xl px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{l.product.name}</p>
                    <p className="text-xs text-son-silver-dim">{currency(l.product.price)} un.</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    <button
                      onClick={() => changeQty(l.product.id, -1)}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm text-white">{l.quantity}</span>
                    <button
                      onClick={() => changeQty(l.product.id, 1)}
                      disabled={l.quantity >= l.product.quantity}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white disabled:opacity-30"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className="sunset-text font-bold text-sm flex-none w-16 text-right">
                    {currency(l.product.price * l.quantity)}
                  </span>
                  <button onClick={() => removeFromCart(l.product.id)} className="text-son-silver-dim hover:text-son-pink flex-none">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {discountAmount > 0 && (
            <div className="flex items-center justify-between text-sm mb-1 px-1 text-son-silver-dim">
              <span>Subtotal</span>
              <span>{currency(cartSubtotal)}</span>
            </div>
          )}
          {discountAmount > 0 && (
            <div className="flex items-center justify-between text-sm mb-1 px-1 text-emerald-400">
              <span>Desconto</span>
              <span>-{currency(discountAmount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-lg font-black mb-4 px-1">
            <span className="text-white">Total</span>
            <span className="sunset-text">{currency(cartTotal)}</span>
          </div>

          <div className="mb-3">
            <label className="label">Desconto na venda (opcional)</label>
            <div className="flex gap-2">
              <div className="flex rounded-2xl overflow-hidden border border-white/10 flex-none">
                <button
                  type="button"
                  onClick={() => setDiscountType('percent')}
                  className={`px-3 py-2 text-sm font-semibold ${discountType === 'percent' ? 'sunset-bg text-white' : 'bg-son-surface text-son-silver-dim'}`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('fixed')}
                  className={`px-3 py-2 text-sm font-semibold ${discountType === 'fixed' ? 'sunset-bg text-white' : 'bg-son-surface text-son-silver-dim'}`}
                >
                  R$
                </button>
              </div>
              <input
                className="input-field"
                type="number"
                min={0}
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percent' ? 'Ex: 10' : 'Ex: 5,00'}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="label">Cliente (opcional)</label>
              <input className="input-field" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome" />
            </div>
            <div>
              <label className="label">WhatsApp (opcional)</label>
              <input
                className="input-field"
                value={customerWhatsapp}
                onChange={(e) => setCustomerWhatsapp(formatPhone(e.target.value))}
                placeholder="(83) 99999-9999"
                type="tel"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="label">Forma de pagamento</label>
            <div className="grid grid-cols-3 gap-2">
              {(['dinheiro', 'pix', 'cartao'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPaymentMethod(value)}
                  className={`py-2.5 rounded-2xl border text-sm font-medium transition-all capitalize ${
                    paymentMethod === value
                      ? 'sunset-bg text-white border-transparent'
                      : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'pix' && (
            <label
              className={`mb-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-son-surface px-3 py-2.5 ${
                plataformaPix ? 'cursor-pointer' : 'opacity-70'
              }`}
            >
              <input
                type="checkbox"
                checked={skipQrcode || !plataformaPix}
                disabled={!plataformaPix}
                onChange={(e) => setSkipQrcode(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span className="text-xs text-son-silver-dim">
                <QrCode className="w-3.5 h-3.5 inline mr-1" />
                <span className="text-white font-semibold">não gerar qrcode</span>
                <br />
                {plataformaPix
                  ? 'Se marcado, confirma o Pix recebido sem gerar cobrança na plataforma.'
                  : 'Sua loja está em cobrança manual — Pix no balcão é sempre confirmação sem QR de plataforma.'}
              </span>
            </label>
          )}

          {finalizeError && <p className="error-msg mb-3">{finalizeError}</p>}

          <button onClick={finalizeSale} disabled={finalizing || cartLines.length === 0} className="btn-primary w-full py-3.5">
            {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Finalizar venda — {currency(cartTotal)}
          </button>
        </div>
      </div>

      {scannerOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={closeScanner}>
          <div className="glass rounded-2xl p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white text-sm">Aponte pro código de barras</h3>
              <button onClick={closeScanner} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <video ref={videoRef} className="w-full rounded-xl bg-black aspect-square object-cover" muted playsInline />
          </div>
        </div>
      )}

      {confirmCashOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !finalizing && setConfirmCashOpen(false)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">Confirmar pagamento</h3>
            <p className="text-sm text-son-silver-dim mb-4">
              Confirmar pagamento de{' '}
              <span className="sunset-text font-bold">{currency(cartTotal)}</span> em{' '}
              {paymentMethodLabel(paymentMethod)}?
            </p>
            {paymentMethod === 'dinheiro' && (
              <CashAmountInput
                className="mb-4"
                label="Valor recebido em dinheiro"
                orderTotal={cartTotal}
                valueCents={cashCents}
                onChange={setCashCents}
              />
            )}
            {paymentMethod === 'dinheiro' && cashCents > 0 && (
              <p className="text-xs text-son-silver-dim mb-4">
                Recebido R$ {formatCashMask(cashCents)} · {formatTrocoLabel(computeTroco(cashCents, cartTotal))}
              </p>
            )}
            {finalizeError && <p className="error-msg mb-3">{finalizeError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmCashOpen(false)} disabled={finalizing} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmCashReceived}
                disabled={finalizing || (paymentMethod === 'dinheiro' && !cashCoversTotal(cashCents, cartTotal))}
                className="btn-primary flex-1"
              >
                {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {cardChoiceOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !finalizing && setCardChoiceOpen(false)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white mb-2">Como o cliente vai pagar?</h3>
            <p className="text-sm text-son-silver-dim mb-4">
              Total <span className="sunset-text font-bold">{currency(cartTotal)}</span>
            </p>
            {finalizeError && <p className="error-msg mb-3">{finalizeError}</p>}
            <div className="space-y-2">
              <button type="button" disabled={finalizing} onClick={handleCardNfc} className="btn-primary w-full">
                {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Aproximar / inserir na maquininha
              </button>
              <button
                type="button"
                disabled={finalizing}
                onClick={() => handleCardOnline('link')}
                className="btn-secondary w-full"
              >
                Link de pagamento
              </button>
              <button
                type="button"
                disabled={finalizing}
                onClick={() => handleCardOnline('transparente')}
                className="btn-secondary w-full"
              >
                Conectar cartão do cliente aqui
              </button>
              <button
                type="button"
                disabled={finalizing}
                onClick={() => setCardChoiceOpen(false)}
                className="text-xs text-son-silver-dim underline w-full text-center pt-1"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {cardDialog && (
        <CardPaymentDialog
          orderId={cardDialog.order.id}
          amount={cardDialog.order.total}
          mode="pdv"
          initialStep={cardDialog.step}
          customerWhatsapp={cardDialog.order.customer_whatsapp}
          onClose={() => setCardDialog(null)}
          onSuccess={(updated) => {
            setCardDialog(null)
            pdvService.notifySale(updated.id).catch(() => {})
            resetFormAfterSale(updated.total)
          }}
        />
      )}

      {pixOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass rounded-2xl p-6 max-w-lg w-full text-center relative">
            <button
              type="button"
              onClick={dismissPixModal}
              disabled={regeneratingPix}
              className="absolute top-3 right-3 text-son-silver-dim hover:text-white disabled:opacity-40"
              aria-label="Fechar cobrança Pix"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-white mb-1 pr-6">Pix da venda</h3>
            <p className="text-sm text-son-silver-dim mb-4">
              Peça ao cliente para escanear o QR ou use o copia-e-cola.
              {pixOrder.customer_whatsapp?.replace(/\D/g, '')
                ? ' Enviamos o resumo e o código no WhatsApp informado.'
                : ''}
              {' '}A confirmação chega automaticamente quando o Pix for pago.
            </p>
            <p className="sunset-text font-black text-xl mb-4">{currency(pixOrder.total)}</p>
            {finalizeError && <p className="error-msg mb-3 text-left">{finalizeError}</p>}
            <div className="bg-white rounded-2xl p-4 inline-block mb-4">
              {pixOrder.pix_copia_cola ? (
                <QRCodeSVG value={pixOrder.pix_copia_cola} size={350} />
              ) : (
                <div className="w-[350px] h-[350px] flex items-center justify-center text-gray-400 text-sm">QR indisponível</div>
              )}
            </div>
            {pixOrder.pix_copia_cola && (
              <button type="button" onClick={copyPixCode} className="btn-secondary w-full mb-3 text-sm">
                <Copy className="w-4 h-4" />
                {copiedPix ? 'Copiado!' : 'Copiar Pix copia-e-cola'}
              </button>
            )}
            <button
              type="button"
              onClick={regeneratePixCharge}
              disabled={regeneratingPix}
              className="btn-secondary w-full text-sm"
            >
              {regeneratingPix ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              Gerar nova cobrança
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
