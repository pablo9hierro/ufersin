import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, Plus, QrCode, Search, Trash2, X } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { pdvService } from '../../services/pdvService'
import { orderService } from '../../services/orderService'
import { filterPdvProducts } from '../../lib/pdvHelpers'
import { tenantHasOnlinePix } from '../../lib/tenantConfig'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import type { Comanda, Order, PaymentMethod, Product } from '../../types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

/** Comanda de PDV: cliente consumindo no local, paga o total no final.
 * Fica abaixo do form de venda avulsa em /admin/pdv e /funcionarios/vendedor/pdv
 * — todo form aqui é toggle caixa de diálogo, igual pedido pelo lojista. */
export default function ComandasSection({ products }: { products: Product[] }) {
  const tenantConfig = useTenantConfig()
  const onlinePix = tenantHasOnlinePix(tenantConfig)
  const [comandas, setComandas] = useState<Comanda[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openComanda, setOpenComanda] = useState<Comanda | null>(null)

  const load = () => {
    setLoading(true)
    pdvService.comandas.list().then(setComandas).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const createComanda = async () => {
    setError(null)
    if (!newLabel.trim()) {
      setError('Diga o nome do dono da comanda ou o número da mesa.')
      return
    }
    setCreating(true)
    try {
      const c = await pdvService.comandas.create(newLabel.trim())
      setComandas((prev) => [...prev, c])
      setShowNewForm(false)
      setNewLabel('')
      setOpenComanda(c)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a comanda.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-white">Comandas</h2>
        <button type="button" onClick={() => setShowNewForm(true)} className="btn-primary text-sm py-2 px-4">
          <Plus className="w-4 h-4" /> Criar comanda
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
        </div>
      ) : comandas.length === 0 ? (
        <p className="text-sm text-son-silver-dim">Nenhuma comanda aberta.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {comandas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setOpenComanda(c)}
              className="bg-son-surface border border-white/5 rounded-2xl p-4 text-left hover:border-son-pink/30 transition-colors"
            >
              <p className="font-semibold text-white">{c.label}</p>
              <p className="text-xs text-son-silver-dim">{c.items.length} {c.items.length === 1 ? 'item' : 'itens'}</p>
              <p className="text-son-gold font-bold mt-1">{currency(c.total)}</p>
            </button>
          ))}
        </div>
      )}

      {showNewForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowNewForm(false)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Nova comanda</h3>
              <button onClick={() => setShowNewForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="label">Nome do cliente ou número da mesa</label>
            <input className="input-field" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} autoFocus />
            {error && <p className="error-msg mt-2">{error}</p>}
            <button type="button" onClick={createComanda} disabled={creating} className="btn-primary w-full mt-4">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Criar
            </button>
          </div>
        </div>
      )}

      {openComanda && (
        <ComandaDialog
          comanda={openComanda}
          products={products}
          onlinePix={onlinePix}
          onClose={() => setOpenComanda(null)}
          onChange={(updated) => {
            setOpenComanda(updated)
            setComandas((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
          }}
          onClosed={() => {
            setOpenComanda(null)
            setComandas((prev) => prev.filter((c) => c.id !== openComanda.id))
          }}
        />
      )}
    </div>
  )
}

function ComandaDialog({
  comanda,
  products,
  onlinePix,
  onClose,
  onChange,
  onClosed,
}: {
  comanda: Comanda
  products: Product[]
  onlinePix: boolean
  onClose: () => void
  onChange: (c: Comanda) => void
  onClosed: () => void
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPay, setShowPay] = useState(false)

  const results = filterPdvProducts(products, query)

  const addItem = async (product: Product) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await pdvService.comandas.addItem(comanda.id, product.id, 1)
      onChange(updated)
      setQuery('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível adicionar o item.')
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (itemId: string) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await pdvService.comandas.removeItem(comanda.id, itemId)
      onChange(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover o item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">{comanda.label}</h3>
          <button onClick={onClose} className="text-son-silver-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-son-silver-dim" />
          <input
            className="input-field pl-9"
            placeholder="Buscar produto pra adicionar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div className="space-y-1 mb-4 max-h-40 overflow-y-auto">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => addItem(p)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-son-surface-light hover:bg-white/10 text-left text-sm"
              >
                <span className="text-white truncate">{p.name}</span>
                <span className="text-son-gold flex-shrink-0 ml-2">{currency(p.price)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2 mb-4">
          {comanda.items.length === 0 ? (
            <p className="text-sm text-son-silver-dim text-center py-4">Nenhum item ainda.</p>
          ) : (
            comanda.items.map((i) => (
              <div key={i.id} className="flex items-center justify-between bg-son-surface-light rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {i.quantity}x {i.product_name}
                  </p>
                  <p className="text-xs text-son-silver-dim">{currency(i.unit_price)} cada</p>
                </div>
                <button type="button" onClick={() => removeItem(i.id)} disabled={busy} className="text-son-silver-dim hover:text-son-pink flex-shrink-0 ml-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {error && <p className="error-msg mb-3">{error}</p>}

        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-son-silver-dim text-sm">Total</span>
          <span className="text-son-gold font-black text-xl">{currency(comanda.total)}</span>
        </div>

        <button
          type="button"
          onClick={() => setShowPay(true)}
          disabled={comanda.items.length === 0}
          className="btn-primary w-full mt-4"
        >
          Pagar conta
        </button>
      </div>

      {showPay && (
        <PayComandaDialog
          comanda={comanda}
          onlinePix={onlinePix}
          onClose={() => setShowPay(false)}
          onPaid={onClosed}
        />
      )}
    </div>
  )
}

function PayComandaDialog({
  comanda,
  onlinePix,
  onClose,
  onPaid,
}: {
  comanda: Comanda
  onlinePix: boolean
  onClose: () => void
  onPaid: () => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [pixOrder, setPixOrder] = useState<Order | null>(null)

  const pay = async () => {
    setBusy(true)
    setError(null)
    try {
      const order = await pdvService.comandas.pay(comanda.id, { payment_method: method })
      if (method === 'pix' && onlinePix) {
        try {
          const withPix = await orderService.createPixPayment(order.id)
          setPixOrder(withPix)
        } catch {
          setError('Comanda fechada, mas não foi possível gerar o QR Pix. Confirme o pagamento manualmente em Pedidos.')
          onPaid()
        }
      } else {
        onPaid()
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível fechar a comanda.')
    } finally {
      setBusy(false)
    }
  }

  const confirmCash = async () => {
    if (!pixOrder) return
    setBusy(true)
    try {
      await orderService.refreshPayment(pixOrder.id)
      onPaid()
    } catch {
      /* segue mesmo se falhar -- comanda já fechou, pagamento é acompanhado normalmente em Pedidos */
      onPaid()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Pagar conta</h3>
          <button onClick={onClose} className="text-son-silver-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {pixOrder ? (
          <div className="text-center">
            {pixOrder.pix_copia_cola ? (
              <div className="bg-white rounded-2xl p-3 inline-block mb-3">
                <QRCodeSVG value={pixOrder.pix_copia_cola} size={200} />
              </div>
            ) : (
              <QrCode className="w-16 h-16 mx-auto text-son-gold mb-3" />
            )}
            <p className="text-son-gold font-bold text-lg mb-4">{currency(comanda.total)}</p>
            <button type="button" onClick={confirmCash} disabled={busy} className="btn-secondary w-full mb-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Já recebi o Pix
            </button>
            <button type="button" onClick={onPaid} className="text-xs text-son-silver-dim hover:text-white">
              Fechar (acompanhar pagamento depois em Pedidos)
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-son-silver-dim mb-4">
              Total: <span className="text-son-gold font-semibold">{currency(comanda.total)}</span>
            </p>
            <label className="label">Forma de pagamento</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(['pix', 'cartao', 'dinheiro'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`py-2 rounded-xl border text-sm font-medium capitalize transition-all ${
                    method === m ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {method !== 'pix' && (
              <label className="flex items-center gap-2 text-sm text-son-silver mb-4">
                <input type="checkbox" className="w-4 h-4 accent-son-pink" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                Confirmo que recebi o pagamento em {method}
              </label>
            )}
            {error && <p className="error-msg mb-3">{error}</p>}
            <button
              type="button"
              onClick={pay}
              disabled={busy || (method !== 'pix' && !confirmed)}
              className="btn-primary w-full"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {method === 'pix' ? 'Gerar Pix e fechar comanda' : 'Fechar comanda'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
