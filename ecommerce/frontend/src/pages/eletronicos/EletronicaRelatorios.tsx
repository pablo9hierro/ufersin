import { useEffect, useMemo, useState } from 'react'
import { ShoppingBag, Truck, Wallet, Wrench } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import { adminService } from '../../services/adminService'
import type { Order } from '../../types'

// Port 1:1 (parcial, gaps disclosed abaixo) de
// src/app/dashboard/relatorios/RelatoriosClient.tsx do vrtech -- mesmos
// filtros (tipo/data/forma de pagamento), mesmos totais e proporção visual
// manutenção/venda/frete, mesma lista de lançamentos. "Manutenção" vem de
// service_orders fechadas (novo endpoint service-orders-closed); "Venda"
// vem de adminService.orders.list() (mesma fonte da aba Vendas).
// NÃO portado: MercadoPagoSection (config de credenciais MP -- já existe
// uma tela própria pra isso no motor, fora do escopo de relatório),
// StockActivitySection e ErrorLogSection (esse motor ainda não tem log de
// estoque/erros pro schema eletronicos).

type Transaction = {
  id: string
  type: 'manutencao' | 'venda'
  date: string
  title: string
  phone: string
  subtitle: string
  value: number
  freteValue: number
  paymentMethods: string[]
}

const TYPE_FILTERS = [
  { key: 'all', label: 'Tudo' },
  { key: 'manutencao', label: 'Manutenção' },
  { key: 'venda', label: 'Venda' },
  { key: 'frete', label: 'Frete' },
] as const

const DATE_PRESETS = [
  { key: 'all', label: 'Tudo' },
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'month', label: 'Este mês' },
] as const

type TypeFilter = (typeof TYPE_FILTERS)[number]['key']
type DatePreset = (typeof DATE_PRESETS)[number]['key']

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function startOfPreset(preset: DatePreset): Date | null {
  const now = new Date()
  if (preset === 'today') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (preset === '7d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 6)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (preset === '30d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 29)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (preset === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

function formatDay(day: string) {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}

export default function EletronicaRelatorios() {
  const [orders, setOrders] = useState<Order[]>([])
  const [serviceOrders, setServiceOrders] = useState<Awaited<ReturnType<typeof eletronicosAdmin.serviceOrders.listClosed>>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([adminService.orders.list(), eletronicosAdmin.serviceOrders.listClosed()])
      .then(([o, so]) => {
        setOrders(o)
        setServiceOrders(so)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar os relatórios.'))
  }, [])

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [datePreset, setDatePreset] = useState<DatePreset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('all')

  const transactions = useMemo<Transaction[]>(() => {
    const manutencao: Transaction[] = serviceOrders
      .filter((o) => o.closed_at && o.final_value != null)
      .map((o) => ({
        id: `os-${o.id}`,
        type: 'manutencao' as const,
        date: o.closed_at as string,
        title: o.customer_name,
        phone: o.customer_phone,
        subtitle: o.phone_model ?? '',
        value: Number(o.final_value),
        freteValue: Number(o.shipping_price ?? 0),
        paymentMethods: (o.payment_methods ?? []).map((p) => p.method),
      }))

    const venda: Transaction[] = orders
      .filter((o) => o.payment_status === 'pago')
      .map((order) => ({
        id: `order-${order.id}`,
        type: 'venda' as const,
        date: order.created_at,
        title: order.customer_name,
        phone: order.customer_whatsapp,
        subtitle: order.items.map((i) => `${i.quantity}x ${i.product_name}`).join(', '),
        value: Math.max(0, order.total - order.shipping_price),
        freteValue: order.shipping_price,
        paymentMethods: [order.payment_method],
      }))

    return [...manutencao, ...venda].sort((a, b) => b.date.localeCompare(a.date))
  }, [serviceOrders, orders])

  const rangeStart = useMemo(() => (datePreset !== 'all' ? startOfPreset(datePreset) : null), [datePreset])

  const availablePaymentMethods = useMemo(
    () => Array.from(new Set(transactions.flatMap((t) => t.paymentMethods))).sort(),
    [transactions],
  )

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (typeFilter === 'frete' && t.freteValue <= 0) return false
      if (typeFilter !== 'all' && typeFilter !== 'frete' && t.type !== typeFilter) return false
      if (paymentFilter !== 'all' && !t.paymentMethods.includes(paymentFilter)) return false
      const d = new Date(t.date)
      if (customFrom || customTo) {
        if (customFrom && d < new Date(customFrom)) return false
        if (customTo) {
          const to = new Date(customTo)
          to.setHours(23, 59, 59, 999)
          if (d > to) return false
        }
        return true
      }
      if (rangeStart && d < rangeStart) return false
      return true
    })
  }, [transactions, typeFilter, paymentFilter, rangeStart, customFrom, customTo])

  const totals = useMemo(() => {
    const base = typeFilter === 'frete' ? transactions : filtered
    const manutencao = base.filter((t) => t.type === 'manutencao').reduce((s, t) => s + t.value, 0)
    const venda = base.filter((t) => t.type === 'venda').reduce((s, t) => s + t.value, 0)
    const frete = base.reduce((s, t) => s + t.freteValue, 0)
    return { manutencao, venda, frete, total: manutencao + venda + frete }
  }, [filtered, transactions, typeFilter])

  const total3 = totals.manutencao + totals.venda + totals.frete
  const pctManutencao = total3 > 0 ? Math.round((totals.manutencao / total3) * 100) : 0
  const pctVenda = total3 > 0 ? Math.round((totals.venda / total3) * 100) : 0
  const pctFrete = total3 > 0 ? 100 - pctManutencao - pctVenda : 0

  const dailyBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of filtered) {
      const day = t.date.slice(0, 10)
      map.set(day, (map.get(day) ?? 0) + t.value)
    }
    const days = Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 14)
    const max = Math.max(...days.map(([, v]) => v), 1)
    return { days, max }
  }, [filtered])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-lg font-bold text-white flex items-center gap-2">
        <Wallet className="w-5 h-5 text-[#e0211a]" />
        Financeiro
      </h1>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2.5 text-red-400 text-sm">{error}</div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTypeFilter(f.key)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              typeFilter === f.key ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setDatePreset(p.key)
                setCustomFrom('')
                setCustomTo('')
              }}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                datePreset === p.key && !customFrom && !customTo ? 'bg-white text-[#0a0a0b]' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-[#161618] border border-white/10 text-white text-sm outline-none focus:border-[#e0211a] [color-scheme:dark]"
          />
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-[#161618] border border-white/10 text-white text-sm outline-none focus:border-[#e0211a] [color-scheme:dark]"
          />
        </div>
      </div>

      {availablePaymentMethods.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setPaymentFilter('all')}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              paymentFilter === 'all' ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
            }`}
          >
            Todas as formas
          </button>
          {availablePaymentMethods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPaymentFilter(m)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                paymentFilter === m ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#161618] rounded-2xl p-3.5 col-span-2">
          <p className="text-xs text-[#d4d4d8]/50">Total no período</p>
          <p className="text-2xl font-black text-white">{currency(totals.total)}</p>
        </div>
        <div className="bg-[#161618] rounded-2xl p-3.5">
          <p className="text-xs text-[#d4d4d8]/50 flex items-center gap-1">
            <Wrench className="w-3 h-3 text-[#e0211a]" /> Manutenção
          </p>
          <p className="text-base font-bold text-white">{currency(totals.manutencao)}</p>
          {total3 > 0 && <p className="text-xs text-[#d4d4d8]/40">{pctManutencao}% do total</p>}
        </div>
        <div className="bg-[#161618] rounded-2xl p-3.5">
          <p className="text-xs text-[#d4d4d8]/50 flex items-center gap-1">
            <ShoppingBag className="w-3 h-3 text-green-500" /> Venda
          </p>
          <p className="text-base font-bold text-white">{currency(totals.venda)}</p>
          {total3 > 0 && <p className="text-xs text-[#d4d4d8]/40">{pctVenda}% do total</p>}
        </div>
        <div className="bg-[#161618] rounded-2xl p-3.5 col-span-2">
          <p className="text-xs text-[#d4d4d8]/50 flex items-center gap-1">
            <Truck className="w-3 h-3 text-blue-400" /> Frete (coleta + entrega)
          </p>
          <p className="text-base font-bold text-white">{currency(totals.frete)}</p>
          {total3 > 0 && <p className="text-xs text-[#d4d4d8]/40">{pctFrete}% do total</p>}
        </div>
      </div>

      {total3 > 0 && (
        <div className="bg-[#161618] rounded-2xl p-4 space-y-2">
          <div className="flex h-3 rounded-full overflow-hidden bg-[#0a0a0b]">
            <div style={{ width: `${pctManutencao}%` }} className="bg-[#e0211a] transition-all" />
            <div style={{ width: `${pctVenda}%` }} className="bg-green-500 transition-all" />
            <div style={{ width: `${pctFrete}%` }} className="bg-blue-400 transition-all" />
          </div>
          <div className="flex justify-between text-xs text-[#d4d4d8]/60">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#e0211a] inline-block" /> Manutenção {pctManutencao}%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Venda {pctVenda}%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Frete {pctFrete}%
            </span>
          </div>
        </div>
      )}

      {dailyBreakdown.days.length > 0 && (
        <div className="space-y-1.5">
          <h2 className="text-xs font-bold text-[#d4d4d8]/50 uppercase tracking-wider">Por dia</h2>
          {dailyBreakdown.days.map(([day, value]) => (
            <div key={day} className="flex items-center gap-2">
              <span className="text-xs text-[#d4d4d8]/50 w-10 shrink-0">{formatDay(day)}</span>
              <div className="flex-1 h-5 bg-[#0a0a0b] rounded-lg overflow-hidden">
                <div className="h-full bg-[#e0211a] rounded-lg transition-all" style={{ width: `${(value / dailyBreakdown.max) * 100}%` }} />
              </div>
              <span className="text-xs text-white font-semibold w-24 text-right shrink-0">{currency(value)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-xs font-bold text-[#d4d4d8]/50 uppercase tracking-wider">Lançamentos ({filtered.length})</h2>
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[#d4d4d8]/40">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum lançamento no período selecionado</p>
          </div>
        ) : (
          filtered.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 bg-[#161618] rounded-xl px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    t.type === 'manutencao' ? 'bg-[#e0211a]/15 text-[#e0211a]' : 'bg-green-500/15 text-green-500'
                  }`}
                >
                  {t.type === 'manutencao' ? <Wrench className="w-4 h-4" /> : <ShoppingBag className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="text-sm text-white truncate">{t.title}</p>
                    {t.phone && <p className="text-xs text-[#d4d4d8]/40 shrink-0">{t.phone}</p>}
                  </div>
                  {t.subtitle && <p className="text-xs text-[#d4d4d8]/50 truncate">{t.subtitle}</p>}
                  {t.paymentMethods.length > 0 && <p className="text-xs text-[#d4d4d8]/40 truncate">{t.paymentMethods.join(' + ')}</p>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-white">{currency(typeFilter === 'frete' ? t.freteValue : t.value)}</p>
                {typeFilter === 'frete' && t.value > 0 && <p className="text-xs text-[#d4d4d8]/40">serviço: {currency(t.value)}</p>}
                <p className="text-xs text-[#d4d4d8]/40">{new Date(t.date).toLocaleDateString('pt-BR')}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
