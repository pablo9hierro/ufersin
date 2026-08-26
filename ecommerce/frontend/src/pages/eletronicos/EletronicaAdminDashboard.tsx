import { useEffect, useState } from 'react'
import { ChevronRight, Clock, FileText, Loader2, MapPin, Package, Plus, Smartphone, Wrench } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { ServiceRequestDto } from '../../lib/eletronicosApi'
import EletronicaRequestDetailModal from './EletronicaRequestDetailModal'
import EletronicaVendasTab from './EletronicaVendasTab'
import EletronicaNovoServicoDialog from './EletronicaNovoServicoDialog'

// Port 1:1 de src/app/dashboard/DashboardClient.tsx do vrtech: mesmo
// STATUS_CONFIG (14 status, mesma cor/label), mesmos 7 baldes de
// STATUS_GROUP (ver serviceLifecycle/types.ts), mesmos stats/filtros/lista
// de cards. O detalhe/edição usa EletronicaRequestDetailModal.tsx (port do
// RequestDetailModal.tsx real: fluxo guiado de status, pagamento com
// desconto/Pix, PDF). A aba "Vendas" (pedidos da vitrine de produtos) e o
// dialog "Registrar serviço" do vrtech ainda não foram portados -- ficam de
// fora por ora, não inventados.

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
  const [tab, setTab] = useState<'solicitacoes' | 'pedidos'>('solicitacoes')
  const [novoServicoOpen, setNovoServicoOpen] = useState(false)

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

  const filtered = (requests ?? []).filter((r) => STATUS_GROUP[r.status as ServiceStatus] === groupFilter)
  const counts = {
    pending: (requests ?? []).filter((r) => r.status === 'pending').length,
    in_progress: (requests ?? []).filter((r) => r.status === 'in_progress').length,
    completed: (requests ?? []).filter((r) => r.status === 'completed').length,
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-white">Solicitações</h1>
        <button
          type="button"
          onClick={() => setNovoServicoOpen(true)}
          className="shrink-0 flex items-center gap-1.5 bg-[#e0211a] hover:bg-[#a3140f] text-white text-sm font-medium px-3.5 py-2 rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Registrar serviço
        </button>
      </div>

      {novoServicoOpen && (
        <EletronicaNovoServicoDialog
          onClose={() => setNovoServicoOpen(false)}
          onDone={() => {
            setNovoServicoOpen(false)
            load()
          }}
        />
      )}

      <div className="flex gap-2 border-b border-white/5">
        {[
          { key: 'solicitacoes' as const, label: 'Solicitações' },
          { key: 'pedidos' as const, label: 'Vendas' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-[#e0211a] text-white' : 'border-transparent text-[#d4d4d8]/60 hover:text-[#d4d4d8]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pedidos' ? (
        <EletronicaVendasTab />
      ) : error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : !requests ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[#e0211a]" />
        </div>
      ) : (
        <>
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
        </>
      )}

      {selected && (
        <EletronicaRequestDetailModal
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
