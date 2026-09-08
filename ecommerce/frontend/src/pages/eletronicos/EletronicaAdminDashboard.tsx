import { useEffect, useState } from 'react'
import { ChevronRight, Clock, FileText, Loader2, MapPin, Package, Plus, Smartphone, Wrench } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { ServiceRequestDto } from '../../lib/eletronicosApi'
import EletronicaRequestDetailModal from './EletronicaRequestDetailModal'
import EletronicaVendasTab from './EletronicaVendasTab'
import EletronicaNovoServicoDialog from './EletronicaNovoServicoDialog'
import LiveTrackingMap from '../../components/eletronicos/LiveTrackingMap'

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

// Badges no tom escuro do painel (fundo translúcido + texto claro da
// própria cor) -- antes usava variantes claras (bg-yellow-100/text-yellow-700
// etc), pensadas pra fundo branco, plantadas em cima do painel escuro
// (#0a0a0b/#161618): o contraste ficava artificial e destoava do resto.
const STATUS_CONFIG: Record<ServiceStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Solicitação nova', color: 'text-amber-300', bg: 'bg-amber-500/15' },
  accepted: { label: 'Aceito', color: 'text-emerald-300', bg: 'bg-emerald-500/15' },
  rejected: { label: 'Recusado', color: 'text-red-300', bg: 'bg-red-500/15' },
  retirada_local: { label: 'Retirada/entrega pelo cliente', color: 'text-teal-300', bg: 'bg-teal-500/15' },
  em_busca: { label: 'Em rota de recolhimento', color: 'text-orange-300', bg: 'bg-orange-500/15' },
  in_progress: { label: 'Em reparo', color: 'text-purple-300', bg: 'bg-purple-500/15' },
  completed: { label: 'Pronto', color: 'text-[#d4d4d8]', bg: 'bg-white/10' },
  em_pagamento: { label: 'Em pagamento', color: 'text-lime-300', bg: 'bg-lime-500/15' },
  em_entrega: { label: 'Em rota de entrega', color: 'text-indigo-300', bg: 'bg-indigo-500/15' },
  delivered: { label: 'Aparelho entregue', color: 'text-cyan-300', bg: 'bg-cyan-500/15' },
  finished: { label: 'Atendimento concluído', color: 'text-emerald-300', bg: 'bg-emerald-500/15' },
  cancelled: { label: 'Cancelado', color: 'text-rose-300', bg: 'bg-rose-500/15' },
  aguardando_diagnostico: { label: 'Aguardando diagnóstico', color: 'text-blue-300', bg: 'bg-blue-500/15' },
  diagnostico_enviado: { label: 'Diagnóstico enviado', color: 'text-violet-300', bg: 'bg-violet-500/15' },
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
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null)

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

  // Mapa de trajetória do card "em deslocamento" -- posição do
  // lojista/técnico atualizada a cada 15s (mesmo intervalo do push em
  // useDriverLocationPush), só considerada "viva" se recente.
  useEffect(() => {
    const poll = () => {
      eletronicosAdmin.driverLocation
        .get()
        .then((loc) => setDriverLoc(loc))
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 15_000)
    return () => clearInterval(id)
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
            // Mapa ao vivo só faz sentido em deslocamento de verdade
            // (técnico indo buscar/entregar) e só com endereço real --
            // retirada_local/aguardando aparelho é o cliente que se
            // desloca, não a loja.
            const showLiveMap =
              (req.status === 'em_busca' || req.status === 'em_entrega') &&
              !req.self_pickup && req.address_lat != null && req.address_lng != null
            return (
              <div
                key={req.id}
                className="w-full bg-[#161618] rounded-2xl border border-white/5 overflow-hidden hover:border-[#e0211a]/30 transition-colors group"
              >
                <button type="button" onClick={() => setSelected(req)} className="w-full p-4 text-left flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5 text-[#d4d4d8]/70" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-white truncate">{req.customer_name}</h3>
                      <span className="text-xs text-[#d4d4d8]/40 shrink-0">
                        {new Date(req.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      {req.quote_value != null && (
                        <span className="text-xs font-bold text-[#e0211a]">R$ {Number(req.quote_value).toFixed(2)}</span>
                      )}
                    </div>

                    <p className="text-[#d4d4d8]/70 text-sm truncate">
                      {req.phone_model ?? (req.diagnosis_requested ? '🔍 Diagnóstico solicitado' : '—')}
                    </p>

                    <div className="flex items-center gap-1 text-[#d4d4d8]/40 text-xs">
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

                  <ChevronRight className="w-4 h-4 text-[#d4d4d8]/30 group-hover:text-[#e0211a] transition-colors shrink-0 mt-2.5" />
                </button>
                {showLiveMap && (
                  <div className="px-4 pb-4">
                    <LiveTrackingMap destLat={req.address_lat!} destLng={req.address_lng!} driver={driverLoc} />
                  </div>
                )}
              </div>
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
