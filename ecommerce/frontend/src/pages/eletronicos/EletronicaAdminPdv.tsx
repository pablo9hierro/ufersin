import { useState } from 'react'
import { Loader2, Plus, QrCode } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'

type SaleDetail = Awaited<ReturnType<typeof eletronicosAdmin.pdv.getSale>>

export default function EletronicaAdminPdv() {
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [label, setLabel] = useState('')
  const [price, setPrice] = useState('')

  const [pix, setPix] = useState<{ paymentId: string; qrBase64: string; qrText: string } | null>(null)

  async function startSale() {
    setBusy(true)
    setError(null)
    try {
      const s = await eletronicosAdmin.pdv.createSale()
      setSale(await eletronicosAdmin.pdv.getSale(s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao abrir venda')
    } finally {
      setBusy(false)
    }
  }

  async function addItem() {
    if (!sale || !label.trim() || !price.trim()) return
    setBusy(true)
    setError(null)
    try {
      await eletronicosAdmin.pdv.addItem(sale.sale.id, {
        item_type: 'service',
        label: label.trim(),
        quantity: 1,
        unit_price: Number(price.replace(',', '.')),
      })
      setLabel('')
      setPrice('')
      setSale(await eletronicosAdmin.pdv.getSale(sale.sale.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao adicionar item')
    } finally {
      setBusy(false)
    }
  }

  async function generatePix() {
    if (!sale || sale.sale.total_value <= 0) return
    setBusy(true)
    setError(null)
    try {
      const charge = await eletronicosAdmin.pix.create({
        amount: sale.sale.total_value,
        customer_name: 'Cliente PDV',
        external_reference: sale.sale.id,
      })
      await eletronicosAdmin.pdv.addPayment(sale.sale.id, {
        method: 'pix',
        amount: sale.sale.total_value,
        mp_payment_id: charge.payment_id,
      })
      setPix({ paymentId: charge.payment_id, qrBase64: charge.qr_code_base64, qrText: charge.qr_code })
      setSale(await eletronicosAdmin.pdv.getSale(sale.sale.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao gerar pix')
    } finally {
      setBusy(false)
    }
  }

  async function markManual(method: 'cartao' | 'dinheiro') {
    if (!sale) return
    setBusy(true)
    setError(null)
    try {
      await eletronicosAdmin.pdv.addPayment(sale.sale.id, { method, amount: sale.sale.total_value })
      const detail = await eletronicosAdmin.pdv.getSale(sale.sale.id)
      const pending = detail.payments.find((p) => p.status !== 'confirmado')
      if (pending) await eletronicosAdmin.pdv.confirmPayment(sale.sale.id, pending.id)
      setSale(await eletronicosAdmin.pdv.getSale(sale.sale.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao registrar pagamento')
    } finally {
      setBusy(false)
    }
  }

  if (!sale) {
    return (
      <div>
        <h1 className="text-xl font-bold text-white mb-5">PDV</h1>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={startSale}
          className="rounded-xl bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-semibold px-5 py-3 flex items-center gap-2 transition-colors"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Abrir nova venda
        </button>
      </div>
    )
  }

  const isClosed = sale.sale.status === 'concluida'

  return (
    <div className="max-w-md">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">Venda balcão</h1>
        {isClosed && <span className="text-green-400 text-sm font-semibold">Concluída ✓</span>}
      </div>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="rounded-2xl border border-white/10 bg-[#161618] p-4 mb-4">
        <div className="space-y-2 mb-3">
          {sale.items.map((it) => (
            <div key={it.id} className="flex justify-between text-sm text-[#d4d4d8]">
              <span>{it.label}</span>
              <span className="text-white">R$ {(it.quantity * it.unit_price).toFixed(2)}</span>
            </div>
          ))}
          {sale.items.length === 0 && <p className="text-sm text-[#d4d4d8]/40">Nenhum item ainda.</p>}
        </div>
        <div className="flex justify-between text-sm font-bold text-white border-t border-white/10 pt-2">
          <span>Total</span>
          <span>R$ {sale.sale.total_value.toFixed(2)}</span>
        </div>
      </div>

      {!isClosed && (
        <>
          <div className="flex gap-2 mb-4">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Item / serviço"
              className="flex-1 rounded-xl border border-white/10 bg-[#0a0a0b] text-white px-3 py-2 text-sm outline-none focus:border-[#e0211a] transition-colors"
            />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="R$"
              className="w-24 rounded-xl border border-white/10 bg-[#0a0a0b] text-white px-3 py-2 text-sm outline-none focus:border-[#e0211a] transition-colors"
            />
            <button
              type="button"
              disabled={busy}
              onClick={addItem}
              className="rounded-xl bg-[#e0211a] hover:bg-[#a3140f] text-white px-3 flex items-center justify-center transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {sale.sale.total_value > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={generatePix}
                className="rounded-xl border border-white/10 text-[#d4d4d8] py-2.5 text-sm flex flex-col items-center gap-1 hover:border-[#e0211a] hover:text-white transition-colors"
              >
                <QrCode className="w-4 h-4" /> Pix
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => markManual('cartao')}
                className="rounded-xl border border-white/10 text-[#d4d4d8] py-2.5 text-sm hover:border-[#e0211a] hover:text-white transition-colors"
              >
                Cartão
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => markManual('dinheiro')}
                className="rounded-xl border border-white/10 text-[#d4d4d8] py-2.5 text-sm hover:border-[#e0211a] hover:text-white transition-colors"
              >
                Dinheiro
              </button>
            </div>
          )}

          {pix && (
            <div className="mt-4 rounded-2xl border border-[#e0211a]/40 bg-[#e0211a]/5 p-4 text-center">
              <img
                src={`data:image/png;base64,${pix.qrBase64}`}
                alt="QR Pix"
                className="w-40 h-40 mx-auto rounded-lg bg-white p-2"
              />
              <p className="text-xs text-[#d4d4d8]/60 mt-3 break-all">{pix.qrText}</p>
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => {
          setSale(null)
          setPix(null)
        }}
        className="mt-5 text-xs text-[#d4d4d8]/40 hover:text-white transition-colors"
      >
        {isClosed ? 'Nova venda' : 'Cancelar / voltar'}
      </button>
    </div>
  )
}
