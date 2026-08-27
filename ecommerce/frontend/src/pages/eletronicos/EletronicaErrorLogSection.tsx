import { useEffect, useMemo, useState } from 'react'
import { Bug, Loader2, Check, AlertCircle } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'

type ErrorLogRow = Awaited<ReturnType<typeof eletronicosAdmin.errorLog.list>>[number]

const SOURCE_LABEL: Record<ErrorLogRow['source'], string> = {
  middleware: 'Middleware',
  api: 'API',
  client: 'Cliente',
  webhook: 'Webhook',
}

const FILTERS: { key: 'all' | ErrorLogRow['source']; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'middleware', label: 'Middleware' },
  { key: 'api', label: 'API' },
  { key: 'client', label: 'Cliente' },
  { key: 'webhook', label: 'Webhook' },
]

// Port 1:1 (parcial, gap disclosed abaixo) de
// src/app/dashboard/relatorios/ErrorLogSection.tsx do vrtech.
// Só a fonte 'client' é populada hoje (captura de erro JS não tratado no
// painel eletrônica, via window.onerror em EletronicaAdminLayout). As
// fontes 'middleware'/'api'/'webhook' exigiriam um hook de erro central em
// todo o backend da plataforma (não só nesta vertical) -- a tabela e os
// filtros já estão prontos pra isso quando existir.
export default function EletronicaErrorLogSection() {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<ErrorLogRow[]>([])
  const [filter, setFilter] = useState<'all' | ErrorLogRow['source']>('all')
  const [showResolved, setShowResolved] = useState(false)

  const load = () => {
    setLoading(true)
    eletronicosAdmin.errorLog
      .list()
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(
    () => logs.filter((l) => (filter === 'all' || l.source === filter) && (showResolved || !l.resolved)),
    [logs, filter, showResolved],
  )

  const markResolved = async (id: string) => {
    await eletronicosAdmin.errorLog.resolve(id)
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, resolved: true } : l)))
  }

  return (
    <div className="bg-[#161618] border border-white/5 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-[#d4d4d8]/70 flex items-center gap-1.5">
        <Bug className="w-3.5 h-3.5" /> Erros
      </h2>

      <div className="flex items-center justify-between gap-2">
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
        <button
          type="button"
          onClick={() => setShowResolved((v) => !v)}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
            showResolved ? 'bg-[#e0211a]/20 text-[#e0211a]' : 'bg-[#0a0a0b] border border-white/10 text-[#d4d4d8]/60'
          }`}
        >
          {showResolved ? 'Ocultar resolvidos' : 'Mostrar resolvidos'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-[#d4d4d8]/40" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[#d4d4d8]/40 text-center py-6">Nenhum erro registrado.</p>
      ) : (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto">
          {filtered.map((log) => (
            <li
              key={log.id}
              className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ${log.resolved ? 'bg-[#0a0a0b]/50 opacity-50' : 'bg-[#0a0a0b]'}`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-white break-words">{log.message}</p>
                  <p className="text-xs text-[#d4d4d8]/40">
                    {SOURCE_LABEL[log.source]}
                    {log.route ? ` · ${log.route}` : ''} ·{' '}
                    {new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              {!log.resolved && (
                <button
                  type="button"
                  onClick={() => markResolved(log.id)}
                  className="shrink-0 text-[#d4d4d8]/40 hover:text-green-400 transition-colors p-1"
                  title="Marcar como resolvido"
                >
                  <Check className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
