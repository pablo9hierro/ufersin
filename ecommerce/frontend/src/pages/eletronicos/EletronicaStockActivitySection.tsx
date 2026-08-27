import { useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Plus, Pencil, Trash2, RefreshCw, AlertTriangle, PackageX } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'

type StockActivityLog = Awaited<ReturnType<typeof eletronicosAdmin.stockActivityLog.list>>[number]
type EventType = StockActivityLog['event_type']

const EVENT_META: Record<EventType, { label: string; icon: React.ElementType; color: string }> = {
  created: { label: 'Criado', icon: Plus, color: 'text-green-400 bg-green-500/10' },
  updated: { label: 'Editado', icon: Pencil, color: 'text-blue-400 bg-blue-500/10' },
  deleted: { label: 'Removido', icon: Trash2, color: 'text-red-400 bg-red-500/10' },
  stock_updated: { label: 'Estoque atualizado', icon: RefreshCw, color: 'text-[#d4d4d8] bg-white/5' },
  low_stock: { label: 'Baixo estoque', icon: AlertTriangle, color: 'text-yellow-400 bg-yellow-500/10' },
  out_of_stock: { label: 'Em falta', icon: PackageX, color: 'text-red-400 bg-red-500/10' },
}

const FILTERS: { key: 'all' | EventType; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'created', label: 'Criados' },
  { key: 'updated', label: 'Editados' },
  { key: 'deleted', label: 'Removidos' },
  { key: 'stock_updated', label: 'Estoque atualizado' },
  { key: 'low_stock', label: 'Baixo estoque' },
  { key: 'out_of_stock', label: 'Em falta' },
]

// Port 1:1 de src/app/dashboard/relatorios/StockActivitySection.tsx do
// vrtech -- feed de auditoria de itens de estoque (cadastro, edição,
// remoção, entrada/saída e transições de baixo estoque/em falta). NÃO
// inclui eventos de "product" (produtos da vitrine): esses são geridos por
// um CRUD genérico da plataforma (adminService), fora do módulo eletrônica.
export default function EletronicaStockActivitySection() {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<StockActivityLog[]>([])
  const [filter, setFilter] = useState<'all' | EventType>('all')

  useEffect(() => {
    eletronicosAdmin.stockActivityLog
      .list()
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => (filter === 'all' ? logs : logs.filter((l) => l.event_type === filter)), [logs, filter])

  return (
    <div className="bg-[#161618] border border-white/5 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-[#d4d4d8]/70 flex items-center gap-1.5">
        <Boxes className="w-3.5 h-3.5" /> Atividade de estoque
      </h2>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              filter === f.key ? 'bg-[#e0211a] text-white' : 'bg-[#0a0a0b] border border-white/10 text-[#d4d4d8]/60 hover:border-[#e0211a]/30'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-[#d4d4d8]/40" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[#d4d4d8]/40 text-center py-6">Nenhum evento registrado ainda.</p>
      ) : (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto">
          {filtered.map((log) => {
            const meta = EVENT_META[log.event_type]
            const Icon = meta.icon
            return (
              <li key={log.id} className="flex items-center justify-between gap-3 bg-[#0a0a0b] rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{log.entity_name}</p>
                    <p className="text-xs text-[#d4d4d8]/40">
                      {log.entity_type === 'product' ? 'Produto' : 'Item de estoque'} · {meta.label}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-[#d4d4d8]/40 shrink-0">
                  {new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
