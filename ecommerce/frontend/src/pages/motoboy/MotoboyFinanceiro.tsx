import { useEffect, useState } from 'react'
import { Clock, Loader2, MapPin, Package, Wallet } from 'lucide-react'
import Card from '../../components/ui/Card'
import { api } from '../../lib/api'
import type { MotoboyFinanceiro as MotoboyFinanceiroData } from '../../lib/types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function MotoboyFinanceiro() {
  const [data, setData] = useState<MotoboyFinanceiroData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.motoboy.financeiro.get().then(setData).finally(() => setLoading(false))
  }, [])

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
      <h1 className="text-2xl font-black mb-6">Financeiro</h1>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <Wallet className="w-3.5 h-3.5" /> A receber
          </div>
          <p className="sunset-text font-black text-2xl">{currency(data.pending_amount)}</p>
          <p className="text-xs text-son-silver-dim mt-1">100% do frete de cada entrega</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
            <Package className="w-3.5 h-3.5" /> Entregas concluídas
          </div>
          <p className="font-black text-2xl text-son-silver">{data.total_deliveries}</p>
        </Card>
      </div>

      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 text-son-silver-dim text-xs mb-2">
          <Clock className="w-3.5 h-3.5" /> Tempo médio por entrega
        </div>
        <p className="font-black text-xl text-son-silver">
          {data.avg_delivery_minutes > 0 ? `${data.avg_delivery_minutes.toFixed(1).replace('.', ',')} min` : '—'}
        </p>
      </Card>

      <Card className="p-5 mb-6">
        <p className="label mb-3">Histórico de entregas</p>
        {data.deliveries.length === 0 ? (
          <p className="text-sm text-son-silver-dim">Nenhuma entrega concluída ainda.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.deliveries.map((d) => (
              <li key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-son-silver truncate">{d.customer_name}</p>
                  <p className="text-xs text-son-silver-dim flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {d.neighborhood ?? '-'}
                    {d.duration_minutes != null && ` · ${d.duration_minutes.toFixed(0)} min`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`font-bold text-sm ${d.paid ? 'text-son-silver-dim' : 'sunset-text'}`}>{currency(d.earned)}</p>
                  <p className="text-xs text-son-silver-dim">{d.paid ? 'pago' : 'pendente'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <p className="label mb-3">Pagamentos recebidos ({currency(data.total_paid)} no total)</p>
        {data.settlements.length === 0 ? (
          <p className="text-sm text-son-silver-dim">Nenhum pagamento registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.settlements.map((s) => (
              <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-son-silver capitalize">{s.payment_method}</p>
                  <p className="text-xs text-son-silver-dim">{new Date(s.paid_at).toLocaleString('pt-BR')}</p>
                </div>
                <span className="font-bold text-sm text-son-silver flex-shrink-0">{currency(s.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
