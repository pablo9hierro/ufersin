import { useEffect, useMemo, useState } from 'react'
import { Clock, Gift, Loader2, Package, Receipt, TrendingDown, TrendingUp, Truck, Wallet, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import { StatusBadge } from '../../components/ui/Badge'
import UsageChart from '../../components/admin/UsageChart'
import { api } from '../../lib/api'
import { useAdminAuth } from '../../store/adminAuth'
import { useVendedorAuth } from '../../store/vendedorAuth'
import type { FinanceiroSummary, FinanceiroTimeseriesPoint, Order, VendedorRelatorio } from '../../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Botões tipo aba pra escolher quais funcionários entram na conta —
// "desempenho geral" soma todo mundo, ou seleciona um/vários indivíduos.
function StaffTabs({
  names,
  selected,
  onToggle,
  onSelectAll,
}: {
  names: string[]
  selected: string[] | 'all'
  onToggle: (name: string) => void
  onSelectAll: () => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      <button
        onClick={onSelectAll}
        className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
          selected === 'all' ? 'sunset-bg text-white' : 'bg-son-surface-light text-son-silver-dim'
        }`}
      >
        Desempenho geral
      </button>
      {names.map((n) => (
        <button
          key={n}
          onClick={() => onToggle(n)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
            selected !== 'all' && selected.includes(n) ? 'sunset-bg text-white' : 'bg-son-surface-light text-son-silver-dim'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

function PdvSalesSection({ role }: { role: string }) {
  const [data, setData] = useState<VendedorRelatorio | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[] | 'all'>('all')

  useEffect(() => {
    api.pdv.relatorio().then(setData).finally(() => setLoading(false))
  }, [])

  const sellerNames = useMemo(
    () => Array.from(new Set((data?.sales ?? []).map((s) => s.sold_by_name ?? 'Sem nome'))).sort(),
    [data]
  )
  const visibleSales = (data?.sales ?? []).filter((s) => selected === 'all' || selected.includes(s.sold_by_name ?? 'Sem nome'))
  const visibleTotal = visibleSales.reduce((sum, s) => sum + s.total, 0)

  const toggle = (name: string) => {
    setSelected((cur) => {
      const list = cur === 'all' ? [] : cur
      return list.includes(name) ? list.filter((n) => n !== name) : [...list, name]
    })
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 label mb-3">
        <Receipt className="w-3.5 h-3.5" /> Vendas de balcão (PDV)
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
        </div>
      ) : !data || data.total_count === 0 ? (
        <p className="text-sm text-son-silver-dim">Nenhuma venda de balcão registrada ainda.</p>
      ) : (
        <>
          {role === 'admin' && sellerNames.length > 1 && (
            <StaffTabs names={sellerNames} selected={selected} onToggle={toggle} onSelectAll={() => setSelected('all')} />
          )}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-son-surface-light rounded-xl p-3 text-center">
              <p className="text-xs text-son-silver-dim mb-1">Total vendido</p>
              <p className="sunset-text font-black text-xl">{currency(visibleTotal)}</p>
            </div>
            <div className="bg-son-surface-light rounded-xl p-3 text-center">
              <p className="text-xs text-son-silver-dim mb-1">Nº de vendas</p>
              <p className="font-black text-xl text-white">{visibleSales.length}</p>
            </div>
          </div>
          <ul className="divide-y divide-white/5">
            {visibleSales.map((s) => (
              <li key={s.id} className="py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-son-silver-dim">
                    {formatDate(s.created_at)}
                    {role === 'admin' && <span className="px-1.5 py-0.5 rounded-full bg-white/10">{s.sold_by_name}</span>}
                  </div>
                  <span className="sunset-text font-bold text-sm">{currency(s.total)}</span>
                </div>
                <p className="text-xs text-son-silver truncate">
                  {s.items.map((i) => `${i.quantity}x ${i.product_name}`).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function MotoboysSection({ motoboys }: { motoboys: FinanceiroSummary['motoboys'] }) {
  const [selected, setSelected] = useState<string[] | 'all'>('all')
  const names = motoboys.map((m) => m.name)
  const visible = motoboys.filter((m) => selected === 'all' || selected.includes(m.name))

  const toggle = (name: string) => {
    setSelected((cur) => {
      const list = cur === 'all' ? [] : cur
      return list.includes(name) ? list.filter((n) => n !== name) : [...list, name]
    })
  }

  return (
    <Card className="p-5 mb-6">
      <div className="flex items-center gap-2 label mb-3">
        <Truck className="w-3.5 h-3.5" /> Frete dos motoboys
      </div>
      {motoboys.length === 0 ? (
        <p className="text-sm text-son-silver-dim">Nenhum motoboy cadastrado.</p>
      ) : (
        <>
          {names.length > 1 && <StaffTabs names={names} selected={selected} onToggle={toggle} onSelectAll={() => setSelected('all')} />}
          {selected !== 'all' && visible.length > 1 && (
            <div className="bg-son-surface-light rounded-xl p-3 mb-3 text-center">
              <p className="text-xs text-son-silver-dim mb-1">Total do(s) selecionado(s)</p>
              <p className="sunset-text font-black text-xl">
                {currency(visible.reduce((sum, m) => sum + m.total_shipping, 0))}
              </p>
            </div>
          )}
          <ul className="divide-y divide-white/5">
            {visible.map((m) => (
              <li key={m.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{m.name}</p>
                  <p className="text-xs text-son-silver-dim">
                    {m.total_deliveries} entrega{m.total_deliveries === 1 ? '' : 's'} · pago {currency(m.total_paid)}
                    {m.avg_delivery_minutes > 0 && ` · ${m.avg_delivery_minutes.toFixed(0)} min/entrega`}
                  </p>
                </div>
                <span className={`font-bold text-sm flex-shrink-0 ${m.pending_amount > 0 ? 'sunset-text' : 'text-son-silver-dim'}`}>
                  {m.pending_amount > 0 ? `a pagar: ${currency(m.pending_amount)}` : 'em dia'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Pedido #{order.id.slice(0, 8)}</h3>
          <button onClick={onClose} className="text-son-silver-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <StatusBadge status={order.status} />
            <span className="sunset-text font-black text-lg">{currency(order.total)}</span>
          </div>
          <p className="text-xs text-son-gold">
            Origem: {order.sold_by_role ? `PDV ${order.sold_by_role === 'admin' ? 'admin' : `— ${order.sold_by_name ?? 'vendedor'}`}` : 'Site'}
          </p>
          <div>
            <p className="text-son-silver-dim text-xs mb-0.5">Cliente</p>
            <p className="text-white">{order.customer_name}</p>
            <p className="text-son-silver-dim text-xs">{order.customer_whatsapp}</p>
          </div>
          {order.address && (
            <div>
              <p className="text-son-silver-dim text-xs mb-0.5">Endereço</p>
              <p className="text-white">{order.address}{order.neighborhood ? ` · ${order.neighborhood}` : ''}</p>
            </div>
          )}
          <div>
            <p className="text-son-silver-dim text-xs mb-1">Itens</p>
            <ul className="space-y-0.5">
              {order.items.map((i) => (
                <li key={i.product_id} className="flex justify-between text-white">
                  <span>{i.quantity}x {i.product_name}</span>
                  <span>{currency(i.unit_price * i.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-between text-son-silver-dim text-xs pt-2 border-t border-white/10">
            <span>Pagamento</span>
            <span className="capitalize">{order.payment_method} · {order.payment_status}</span>
          </div>
          {(order.discount_amount ?? 0) > 0 || (order.shipping_discount ?? 0) > 0 ? (
            <div className="flex justify-between text-emerald-400 text-xs">
              <span>Desconto concedido</span>
              <span>-{currency((order.discount_amount ?? 0) + (order.shipping_discount ?? 0))}</span>
            </div>
          ) : null}
          {order.coupon_code && (
            <p className="text-xs text-son-silver-dim">Cupom: {order.coupon_code}</p>
          )}
          <p className="text-xs text-son-silver-dim">Criado em {formatDate(order.created_at)}</p>
        </div>
      </div>
    </div>
  )
}

export default function AdminFinanceiro() {
  // Admin/vendedor têm sessões separadas (useAdminAuth/useVendedorAuth) —
  // essa tela é compartilhada pelas duas telas de dashboard, então só
  // resolve qual está ativa pra saber o que mostrar.
  const adminToken = useAdminAuth((s) => s.token)
  const vendedorToken = useVendedorAuth((s) => s.token)
  const role: 'admin' | 'vendedor' = !adminToken && vendedorToken ? 'vendedor' : 'admin'
  const [data, setData] = useState<FinanceiroSummary | null>(null)
  const [timeseries, setTimeseries] = useState<FinanceiroTimeseriesPoint[]>([])
  const [loading, setLoading] = useState(role === 'admin')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  useEffect(() => {
    if (role !== 'admin') return
    api.admin.financeiro.get().then(setData).finally(() => setLoading(false))
    api.admin.financeiro.timeseries(30).then(setTimeseries).catch(() => {})
  }, [role])

  // Vendedor só enxerga as próprias vendas de balcão — o resto do
  // financeiro (receita geral, motoboys, desconto concedido) é admin-only.
  if (role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-black mb-6">Financeiro</h1>
        <PdvSalesSection role={role} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      <h1 className="text-2xl font-black mb-6">Financeiro &amp; relatórios &amp; estatísticas</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <Wallet className="w-3.5 h-3.5" /> Receita paga
          </div>
          <p className="sunset-text font-black text-2xl">{currency(data.total_revenue)}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <Package className="w-3.5 h-3.5" /> Pedidos totais
          </div>
          <p className="font-black text-2xl text-white">{data.total_orders}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <Clock className="w-3.5 h-3.5" /> Tempo médio de entrega
          </div>
          <p className="font-black text-2xl text-white">
            {data.avg_delivery_minutes > 0 ? `${data.avg_delivery_minutes.toFixed(1).replace('.', ',')} min` : '—'}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <Gift className="w-3.5 h-3.5" /> Concedido em campanha/cupom
          </div>
          <p className={`font-black text-2xl ${data.total_discount_given > 0 ? 'text-amber-400' : 'text-white'}`}>
            {currency(data.total_discount_given)}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <TrendingDown className="w-3.5 h-3.5" /> Faturaria sem desconto
          </div>
          <p className="font-black text-2xl text-white">{currency(data.total_revenue + data.total_discount_given)}</p>
        </Card>
      </div>

      {timeseries.length > 0 && (
        <Card className="p-5 mb-6">
          <UsageChart points={timeseries} />
        </Card>
      )}

      <Card className="p-5 mb-6">
        <p className="label mb-3">Pedidos por status</p>
        <div className="flex flex-wrap gap-2">
          {data.orders_by_status.map((s) => (
            <div key={s.status} className="flex items-center gap-2 bg-son-surface-light rounded-xl px-3 py-2">
              <StatusBadge status={s.status} />
              <span className="text-sm font-bold text-white">{s.count}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 label mb-3">
          <TrendingUp className="w-3.5 h-3.5" /> Ranking de vendas
        </div>
        {data.top_products.length === 0 ? (
          <p className="text-sm text-son-silver-dim">Nenhuma venda paga ainda.</p>
        ) : (
          <ul className="space-y-2">
            {data.top_products.map((p, i) => (
              <li key={p.product_id} className="flex items-center gap-3">
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-son-surface-light text-xs font-bold text-son-gold flex-shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-white truncate">{p.product_name}</span>
                <span className="text-xs text-son-silver-dim">{p.quantity_sold}x</span>
                <span className="sunset-text font-bold text-sm">{currency(p.revenue)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <MotoboysSection motoboys={data.motoboys} />

      <div className="mb-6">
        <PdvSalesSection role={role} />
      </div>

      <Card className="p-5">
        <p className="label mb-3">Histórico recente</p>
        <ul className="divide-y divide-white/5">
          {data.recent_orders.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => setSelectedOrder(o)}
                className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{o.customer_name}</p>
                  <p className="text-xs text-son-silver-dim">{o.created_at}</p>
                </div>
                <StatusBadge status={o.status} className="flex-shrink-0" />
                <span className="sunset-text font-bold text-sm flex-shrink-0">{currency(o.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </div>
  )
}
