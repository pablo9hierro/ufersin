import { useEffect, useState } from 'react'
import { ChevronRight, Clock, FileText, Loader2, MapPin, Package, Smartphone, Wrench, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { ServiceRequestDto } from '../../lib/eletronicosApi'
import { generateServiceOrderPdf } from '../../lib/eletronicosPdf'
import { useTenantConfig } from '../../hooks/useTenantConfig'

// Port 1:1 de src/app/dashboard/DashboardClient.tsx do vrtech: mesmo
// STATUS_CONFIG (14 status, mesma cor/label), mesmos 7 baldes de
// STATUS_GROUP (ver serviceLifecycle/types.ts), mesmos stats/filtros/lista
// de cards. A aba "Vendas" (pedidos da vitrine de produtos) e o dialog
// "Registrar serviço" do vrtech ainda não foram portados -- ficam de fora
// por ora, não inventados.

type ServiceStatus =
  | 'pending' | 'accepted' | 'rejected' | 'retirada_local' | 'em_busca' | 'in_progress'
  | 'completed' | 'em_pagamento' | 'em_entrega' | 'delivered' | 'finished' | 'cancelled'
  | 'aguardando_diagnostico' | 'diagnostico_enviado'

type StatusGroup = 'novas' | 'em_deslocamento' | 'aguardando_aparelho' | 'em_diagnostico' | 'em_reparo' | 'retiradas' | 'concluidos'

const STATUS_GROUP: Record<ServiceStatus, StatusGroup> = {
  pending: 'novas',
  accepted: 'em_deslocamento',
  aguardando_diagnostico: 'em_diagnostico',
  diagnostico_enviado: 'em_diagnostico',
  retirada_local: 'aguardando_aparelho',
  em_busca: 'em_deslocamento',
  in_progress: 'em_reparo',
  completed: 'retiradas',
  em_pagamento: 'retiradas',
  em_entrega: 'retiradas',
  delivered: 'concluidos',
  finished: 'concluidos',
  rejected: 'concluidos',
  cancelled: 'concluidos',
}

const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  novas: 'Solicitação nova',
  em_deslocamento: 'Em deslocamento',
  aguardando_aparelho: 'Aguardando aparelho',
  em_diagnostico: 'Em diagnóstico',
  em_reparo: 'Em reparo',
  retiradas: 'Pronto',
  concluidos: 'Concluídos',
}

const GROUP_FILTERS: { key: StatusGroup; label: string }[] = [
  { key: 'novas', label: STATUS_GROUP_LABEL.novas },
  { key: 'em_deslocamento', label: STATUS_GROUP_LABEL.em_deslocamento },
  { key: 'aguardando_aparelho', label: STATUS_GROUP_LABEL.aguardando_aparelho },
  { key: 'em_diagnostico', label: STATUS_GROUP_LABEL.em_diagnostico },
  { key: 'em_reparo', label: STATUS_GROUP_LABEL.em_reparo },
  { key: 'retiradas', label: STATUS_GROUP_LABEL.retiradas },
  { key: 'concluidos', label: STATUS_GROUP_LABEL.concluidos },
]

const STATUS_CONFIG: Record<ServiceStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Solicitação nova', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  accepted: { label: 'Aceito', color: 'text-green-700', bg: 'bg-green-100' },
  rejected: { label: 'Recusado', color: 'text-red-700', bg: 'bg-red-100' },
  retirada_local: { label: 'Retirada/entrega pelo cliente', color: 'text-teal-700', bg: 'bg-teal-100' },
  em_busca: { label: 'Em rota de recolhimento', color: 'text-orange-700', bg: 'bg-orange-100' },
  in_progress: { label: 'Em reparo', color: 'text-purple-700', bg: 'bg-purple-100' },
  completed: { label: 'Pronto', color: 'text-gray-700', bg: 'bg-gray-100' },
  em_pagamento: { label: 'Em pagamento', color: 'text-lime-700', bg: 'bg-lime-100' },
  em_entrega: { label: 'Em rota de entrega', color: 'text-indigo-700', bg: 'bg-indigo-100' },
  delivered: { label: 'Aparelho entregue', color: 'text-cyan-700', bg: 'bg-cyan-100' },
  finished: { label: 'Atendimento concluído', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  cancelled: { label: 'Cancelado', color: 'text-rose-700', bg: 'bg-rose-100' },
  aguardando_diagnostico: { label: 'Aguardando diagnóstico', color: 'text-blue-700', bg: 'bg-blue-100' },
  diagnostico_enviado: { label: 'Diagnóstico enviado', color: 'text-violet-700', bg: 'bg-violet-100' },
}

function googleMapsLink(lat: number, lng: number) {
  return `https://maps.google.com/?q=${lat},${lng}`
}

export default function EletronicaAdminDashboard() {
  const [requests, setRequests] = useState<ServiceRequestDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<StatusGroup>('novas')
  const [selected, setSelected] = useState<ServiceRequestDto | null>(null)

  async function load() {
    try {
      setRequests(await eletronicosAdmin.serviceRequests.list())
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
        <Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" />
      </div>
    )
  }

  const filtered = requests.filter((r) => STATUS_GROUP[r.status as ServiceStatus] === groupFilter)
  const counts = {
    pending: requests.filter((r) => r.status === 'pending').length,
    in_progress: requests.filter((r) => r.status === 'in_progress').length,
    completed: requests.filter((r) => r.status === 'completed').length,
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-lg font-bold text-white">Solicitações</h1>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pendentes', value: counts.pending, icon: <Clock className="w-5 h-5 text-[#e0211a]" /> },
          { label: 'Em reparo', value: counts.in_progress, icon: <Wrench className="w-5 h-5 text-[#e0211a]" /> },
          { label: 'Concluídos', value: counts.completed, icon: <FileText className="w-5 h-5 text-[#e0211a]" /> },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/5 bg-[#161618] p-4">
            {s.icon}
            <div className="text-2xl font-bold text-white mt-1">{s.value}</div>
            <div className="text-xs text-[#d4d4d8]/60">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {GROUP_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setGroupFilter(f.key)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              groupFilter === f.key ? 'bg-[#e0211a] text-white' : 'bg-[#161618] border border-white/5 text-[#d4d4d8] hover:bg-[#232327]'
            }`}
          >
            {f.label}
            <span className={`ml-1.5 px-1.5 rounded-full text-xs ${groupFilter === f.key ? 'bg-white/20 text-white' : 'bg-white/5 text-[#d4d4d8]/60'}`}>
              {requests.filter((r) => STATUS_GROUP[r.status as ServiceStatus] === f.key).length}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[#d4d4d8]/40">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma solicitação encontrada</p>
          </div>
        ) : (
          filtered.map((req) => {
            const sc = STATUS_CONFIG[req.status as ServiceStatus]
            return (
              <button
                key={req.id}
                type="button"
                onClick={() => setSelected(req)}
                className="w-full bg-[#161618] rounded-2xl border border-white/5 overflow-hidden hover:border-[#e0211a]/30 transition-all group text-left"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>{sc.label}</span>
                        {req.quote_value != null && (
                          <span className="text-xs font-bold text-[#e0211a]">R$ {Number(req.quote_value).toFixed(2)}</span>
                        )}
                      </div>
                      <h3 className="font-semibold text-white truncate">{req.customer_name}</h3>
                      <div className="flex items-center gap-1 text-[#d4d4d8]/70 text-sm">
                        <Smartphone className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{req.phone_model ?? (req.diagnosis_requested ? '🔍 Diagnóstico solicitado' : '—')}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[#d4d4d8]/40 text-xs mt-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{req.self_pickup ? 'Retirada pelo cliente' : req.address_label || 'Coleta/entrega'}</span>
                        {!req.self_pickup && req.address_lat != null && req.address_lng != null && (
                          <a
                            href={googleMapsLink(req.address_lat, req.address_lng)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-400 hover:underline shrink-0"
                          >
                            📍
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-xs text-[#d4d4d8]/40">
                        {new Date(req.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <ChevronRight className="w-4 h-4 text-[#d4d4d8]/30 group-hover:text-[#e0211a] transition-colors" />
                    </div>
                  </div>
                </div>
              </button>
            )
          })
        )}
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

// Painel de detalhe/edição -- ainda a versão simplificada minha (não o
// RequestDetailModal.tsx real de 1066 linhas do vrtech, com checklist
// item a item, dialog de pagamento com Pix e timeline de mensagens
// WhatsApp). Cobre o essencial (ver status, avançar, orçamento, concluir,
// gerar PDF), mas o port fiel do modal completo ainda está pendente.
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
  const sc = STATUS_CONFIG[request.status as ServiceStatus]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-0 sm:px-4">
      <div className="w-full sm:max-w-md bg-[#0a0a0b] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="font-bold text-white">{request.customer_name}</p>
            <p className="text-xs text-[#d4d4d8]/50">{request.customer_phone}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#d4d4d8]/50 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-[#d4d4d8]">
          <div>
            <p className="text-xs text-[#d4d4d8]/50">Aparelho</p>
            <p className="text-white">{request.phone_model || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[#d4d4d8]/50">Problema</p>
            <p className="text-white">{request.problem_description || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[#d4d4d8]/50 mb-1">Status atual</p>
            <p className={`inline-flex rounded-full text-xs font-medium px-3 py-1 ${sc.bg} ${sc.color}`}>{sc.label}</p>
          </div>

          <div>
            <label className="block text-xs text-[#d4d4d8]/50 mb-1">Valor do orçamento (R$)</label>
            <input
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-white/10 bg-[#161618] text-white px-3 py-2 text-sm outline-none focus:border-[#e0211a]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#d4d4d8]/50 mb-1">Observações internas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-white/10 bg-[#161618] text-white px-3 py-2 text-sm outline-none focus:border-[#e0211a] resize-none"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {nextOptions.length > 0 && (
            <div>
              <p className="text-xs text-[#d4d4d8]/50 mb-2">Avançar status</p>
              <div className="flex flex-wrap gap-2">
                {nextOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={saving}
                    onClick={() => transitionTo(s)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#d4d4d8] hover:border-[#e0211a] hover:text-[#e0211a] transition-colors disabled:opacity-50"
                  >
                    {STATUS_CONFIG[s as ServiceStatus]?.label ?? s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {request.status === 'in_progress' && (
            <div className="pt-2 border-t border-white/10">
              <label className="block text-xs text-[#d4d4d8]/50 mb-1">Resumo do serviço realizado</label>
              <input
                value={completedServices}
                onChange={(e) => setCompletedServices(e.target.value)}
                placeholder="ex: troca de tela"
                className="w-full rounded-xl border border-white/10 bg-[#161618] text-white px-3 py-2 text-sm outline-none focus:border-[#e0211a] mb-2"
              />
              <button
                type="button"
                disabled={completing}
                onClick={handleComplete}
                className="w-full rounded-xl bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-50 text-white font-semibold py-2.5 flex items-center justify-center gap-2 transition-all"
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
              className="w-full rounded-xl border border-white/10 py-2.5 text-sm text-[#d4d4d8] flex items-center justify-center gap-2 hover:border-[#e0211a] hover:text-[#e0211a] transition-colors"
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
