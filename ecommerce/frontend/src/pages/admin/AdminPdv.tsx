import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { Camera, CheckCircle2, Loader2, Minus, Package, Plus, ScanBarcode, Search, Trash2, X } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import type { PaymentMethod, Product } from '../../lib/types'

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

interface CartLine {
  product: Product
  quantity: number
}

export default function AdminPdv() {
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
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  useEffect(() => {
    api.products
      .list()
      .then((p) => setProducts(p.filter((x) => x.active !== false)))
      .finally(() => setLoadingProducts(false))
  }, [])

  // Leitor físico (bip) é um teclado disfarçado — digita o código rapidinho
  // e manda Enter sozinho. Mantendo esse campo sempre focado, o vendedor
  // só aponta e aperta o gatilho, sem precisar tocar na tela.
  useEffect(() => {
    barcodeInputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12)
  }, [query, products])

  const cartLines = Object.values(cart)
  const cartTotal = cartLines.reduce((sum, l) => sum + l.product.price * l.quantity, 0)

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
    const product = products.find((p) => p.barcode === code)
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
        // Esse callback é assíncrono e dispara depois que a câmera já está
        // de fato transmitindo — se o usuário já fechou o scanner ANTES
        // disso, o cleanup abaixo rodou com controlsRef.current ainda nulo
        // (nada pra parar) e ninguém mais chama stop() depois. Checar
        // "cancelled" aqui dentro, a cada chamada, garante que a câmera
        // para na hora que os controles finalmente chegam, mesmo que o
        // widget já tenha sido fechado antes disso.
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        if (!result) return
        const code = result.getText()
        const product = products.find((p) => p.barcode === code)
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

  const finalizeSale = async () => {
    if (cartLines.length === 0) return
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const order = await api.pdv.createSale({
        items: cartLines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        payment_method: paymentMethod,
        customer_name: customerName.trim() || undefined,
        customer_whatsapp: customerWhatsapp.replace(/\D/g, '') ? `55${customerWhatsapp.replace(/\D/g, '')}` : undefined,
      })
      api.pdv.notifySale(order.id).catch(() => {})
      setSuccess(cartTotal)
      setCart({})
      setCustomerName('')
      setCustomerWhatsapp('')
      setPaymentMethod('dinheiro')
      // Recarrega estoque (a venda já decrementou no banco).
      api.products.list().then((p) => setProducts(p.filter((x) => x.active !== false)))
      setTimeout(() => setSuccess(null), 4000)
    } catch (e) {
      setFinalizeError(e instanceof ApiError ? e.message : 'Não foi possível finalizar a venda.')
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">PDV — nova venda</h1>

      {success !== null && (
        <div className="mb-6 flex items-center gap-2 bg-emerald-500/15 text-emerald-400 rounded-2xl px-4 py-3 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          Venda de {currency(success)} finalizada com sucesso!
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          {/* Leitor físico (bip) — campo sempre focado, some sozinho no Enter. */}
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

          <div className="flex items-center justify-between text-lg font-black mb-4 px-1">
            <span className="text-white">Total</span>
            <span className="sunset-text">{currency(cartTotal)}</span>
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

          <div className="mb-4">
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
    </div>
  )
}
