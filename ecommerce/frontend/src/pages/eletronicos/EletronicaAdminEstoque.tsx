import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'

type StockItem = {
  id: string
  name: string
  unit: string
  quantity: number
  price: number | null
  low_stock_threshold: number | null
}

export default function EletronicaAdminEstoque() {
  const [items, setItems] = useState<StockItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('unidade')
  const [quantity, setQuantity] = useState('0')
  const [price, setPrice] = useState('')
  const [entryFor, setEntryFor] = useState<string | null>(null)
  const [entryQty, setEntryQty] = useState('')

  async function load() {
    try {
      setItems(await eletronicosAdmin.stockItems.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    try {
      await eletronicosAdmin.stockItems.create({
        name: name.trim(),
        unit,
        quantity: Number(quantity.replace(',', '.')) || 0,
        price: price.trim() ? Number(price.replace(',', '.')) : undefined,
      })
      setName('')
      setQuantity('0')
      setPrice('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao criar')
    } finally {
      setCreating(false)
    }
  }

  async function handleEntry(id: string) {
    const qty = Number(entryQty.replace(',', '.'))
    if (!qty || qty <= 0) return
    try {
      await eletronicosAdmin.stockItems.stockEntry(id, qty)
      setEntryFor(null)
      setEntryQty('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao lançar entrada')
    }
  }

  if (!items) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">Estoque de peças</h1>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da peça"
          className="col-span-2 sm:col-span-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unidade"
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qtd inicial"
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Custo (R$)"
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          disabled={creating || !name.trim()}
          onClick={handleCreate}
          className="col-span-2 sm:col-span-4 rounded-lg bg-emerald-500 disabled:bg-slate-800 text-slate-950 font-semibold py-2 flex items-center justify-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" /> Cadastrar item
        </button>
      </div>

      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{it.name}</p>
              <p className="text-xs text-slate-500">
                {it.quantity} {it.unit}
                {it.price != null && ` · R$ ${it.price.toFixed(2)}`}
                {it.low_stock_threshold != null && it.quantity <= it.low_stock_threshold && (
                  <span className="text-amber-400 ml-2">estoque baixo</span>
                )}
              </p>
            </div>
            {entryFor === it.id ? (
              <div className="flex items-center gap-2">
                <input
                  value={entryQty}
                  onChange={(e) => setEntryQty(e.target.value)}
                  placeholder="qtd"
                  className="w-20 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => handleEntry(it.id)}
                  className="rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold px-3 py-1.5"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEntryFor(it.id)}
                className="text-xs text-emerald-400 hover:underline shrink-0"
              >
                + Estoque
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-slate-500">Nenhum item cadastrado.</p>}
      </div>
    </div>
  )
}
