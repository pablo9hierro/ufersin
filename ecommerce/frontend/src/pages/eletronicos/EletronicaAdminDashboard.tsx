import { useEffect, useState } from 'react'
import { FileText, Loader2, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { ServiceRequestDto } from '../../lib/eletronicosApi'
import { STATUS_LABEL } from '../../lib/eletronicosApi'
import { generateServiceOrderPdf } from '../../lib/eletronicosPdf'
import { useTenantConfig } from '../../hooks/useTenantConfig'

// Colunas do kanban-lite (agrupamento visual, sem drag-drop por ora --
// mudança de status acontece no painel de detalhe, mais previsível que
// arrastar um card sem confirmação).
const COLUMNS: { key: string; statuses: string[] }[] = [
  { key: 'Novo', statuses: ['pending', 'aguardando_diagnostico', 'diagnostico_enviado'] },
  { key: 'Aprovado', statuses: ['accepted', 'retirada_local', 'em_busca'] },
  { key: 'Em reparo', statuses: ['in_progress'] },
  { key: 'Pronto', statuses: ['completed', 'em_pagamento'] },
  { key: 'Finalizado', statuses: ['delivered', 'finished'] },
]

export default function EletronicaAdminDashboard() {
  const [requests, setRequests] = useState<ServiceRequestDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ServiceRequestDto | null>(null)

  async function load() {
    try {
      const rows = await eletronicosAdmin.serviceRequests.list()
      setRequests(rows.filter((r) => r.status !== 'cancelled' && r.status !== 'rejected'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (error) return <p className="text-red-400 text-sm">{error}</p>
  if (!requests) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">Solicitações</h1>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const items = requests.filter((r) => col.statuses.includes(r.status))
          return (
            <div key={col.key} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs font-semibold text-slate-400 mb-3">
                {col.key} <span className="text-slate-600">({items.length})</span>
              </p>
              <div className="space-y-2">
                {items.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelected(r)}
                    className="w-full text-left rounded-xl border border-slate-800 bg-slate-900 p-3 hover:border-emerald-600 transition-colors"
                  >
                    <p className="text-sm font-medium">{r.customer_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{r.phone_model}</p>
                    <p className="text-[11px] text-emerald-400 mt-2">{STATUS_LABEL[r.status] || r.status}</p>
                  </button>
                ))}
                {items.length === 0 && <p className="text-xs text-slate-600">vazio</p>}
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <DetailPanel
          request={selected}
          onClose={() => setSelected(null)}
          onUpdated={(r) => {
            setRequests((prev) => prev?.map((x) => (x.id === r.id ? r : x)) ?? null)
            setSelected(r)
          }}
        />
      )}
    </div>
  )
}

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['aguardando_diagnostico', 'accepted', 'rejected', 'cancelled'],
  aguardando_diagnostico: ['diagnostico_enviado', 'cancelled'],
  diagnostico_enviado: ['accepted', 'rejected'],
  accepted: ['retirada_local', 'em_busca', 'in_progress'],
  retirada_local: ['in_progress'],
  em_busca: ['in_progress'],
  in_progress: ['completed'],
  completed: ['em_pagamento', 'delivered'],
  em_pagamento: ['delivered'],
  delivered: ['finished'],
  finished: [],
  rejected: [],
  cancelled: [],
}

function DetailPanel({
  request,
  onClose,
  onUpdated,
}: {
  request: ServiceRequestDto
  onClose: () => void
  onUpdated: (r: ServiceRequestDto) => void
}) {
  const [quote, setQuote] = useState(String(request.quote_value ?? request.estimated_quote_value ?? ''))
  const [notes, setNotes] = useState(request.owner_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [completedServices, setCompletedServices] = useState('')
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const tenantConfig = useTenantConfig()

  async function transitionTo(status: string) {
    setSaving(true)
    setError(null)
    try {
      const quoteNum = quote.trim() ? Number(quote.replace(',', '.')) : undefined
      const updated = await eletronicosAdmin.serviceRequests.updateStatus(request.id, {
        status,
        quote_value: quoteNum,
        owner_notes: notes.trim() || undefined,
      })
      onUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao atualizar')
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    setCompleting(true)
    setError(null)
    try {
      const order = await eletronicosAdmin.serviceOrders.getOrCreate(request.id)
      await eletronicosAdmin.serviceOrders.complete(order.id, {
        checklist: [],
        completed_services: completedServices.trim() || undefined,
      })
      const updated = await eletronicosAdmin.serviceRequests.updateStatus(request.id, { status: 'completed' })
      onUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao concluir')
    } finally {
      setCompleting(false)
    }
  }

  async function handleGeneratePdf() {
    setGeneratingPdf(true)
    setError(null)
    try {
      const order = await eletronicosAdmin.serviceOrders.getOrCreate(request.id)
      const blob = generateServiceOrderPdf(request, order, tenantConfig?.loja_nome || 'Assistência técnica')
      const url = await eletronicosAdmin.uploadMedia(blob, `os-${request.id}.pdf`)
      await eletronicosAdmin.serviceOrders.setPdf(order.id, url)
      window.open(url, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao gerar PDF')
    } finally {
      setGeneratingPdf(false)
    }
  }

  const nextOptions = NEXT_STATUS[request.status] ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-0 sm:px-4">
      <div className="w-full sm:max-w-md bg-slate-950 border border-slate-800 rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-bold">{request.customer_name}</p>
            <p className="text-xs text-slate-500">{request.customer_phone}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-slate-500">Aparelho</p>
            <p>{request.phone_model || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Problema</p>
            <p>{request.problem_description || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Status atual</p>
            <p className="inline-flex rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-medium px-3 py-1">
              {STATUS_LABEL[request.status] || request.status}
            </p>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Valor do orçamento (R$)</label>
            <input
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Observações internas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {nextOptions.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">Avançar status</p>
              <div className="flex flex-wrap gap-2">
                {nextOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={saving}
                    onClick={() => transitionTo(s)}
                    className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs hover:border-emerald-500 hover:text-emerald-300 transition-colors disabled:opacity-50"
                  >
                    {STATUS_LABEL[s] || s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {request.status === 'in_progress' && (
            <div className="pt-2 border-t border-slate-800">
              <label className="block text-xs text-slate-500 mb-1">Resumo do serviço realizado</label>
              <input
                value={completedServices}
                onChange={(e) => setCompletedServices(e.target.value)}
                placeholder="ex: troca de tela"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 mb-2"
              />
              <button
                type="button"
                disabled={completing}
                onClick={handleComplete}
                className="w-full rounded-xl bg-emerald-500 disabled:bg-slate-800 text-slate-950 font-semibold py-2.5 flex items-center justify-center gap-2"
              >
                {completing && <Loader2 className="w-4 h-4 animate-spin" />}
                Marcar como pronto
              </button>
            </div>
          )}

          {['completed', 'em_pagamento', 'delivered', 'finished'].includes(request.status) && (
            <button
              type="button"
              disabled={generatingPdf}
              onClick={handleGeneratePdf}
              className="w-full rounded-xl border border-slate-800 py-2.5 text-sm flex items-center justify-center gap-2 hover:border-emerald-500"
            >
              {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Gerar / baixar PDF da OS
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
