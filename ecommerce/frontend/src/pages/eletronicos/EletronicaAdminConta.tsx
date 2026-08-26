import { useEffect, useState } from 'react'
import { Loader2, MessageCircle } from 'lucide-react'
import { adminService } from '../../services/adminService'
import WhatsAppConnection from '../../components/ui/WhatsAppConnection'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { classifyWaHistoryError, formatWaEventLabel, formatWaEventTime, type WaHistoryEvent } from '../../lib/whatsappHistory'

// src/app/dashboard/conta/page.tsx do vrtech só tem <WhatsAppPanel/> (nada
// de horário de funcionamento -- isso não existe na página real, não
// inventar). O WhatsAppPanel real é auto-connect (dispara /api/whatsapp/
// connect sozinho, sem botão manual, QR renovando via polling+realtime na
// tabela whatsapp_state) -- esse motor não tem esse endpoint de auto-
// provisionamento, então aqui reaproveita o WhatsAppConnection genérico
// (pareamento manual via botão Conectar/Desconectar, mesmo mecanismo já
// usado por qualquer tenant do motor) como substituto funcional
// disclosed, não uma cópia visual 1:1 do painel original.

export default function EletronicaAdminConta() {
  const tenantConfig = useTenantConfig()
  const whatsappHabilitado = tenantConfig?.whatsapp_habilitado === true
  const [waEvents, setWaEvents] = useState<WaHistoryEvent[]>([])
  const [waEventsError, setWaEventsError] = useState<string | null>(null)
  const [waEventsLoading, setWaEventsLoading] = useState(false)

  const loadWaEvents = () => {
    if (!whatsappHabilitado) return
    setWaEventsError(null)
    setWaEventsLoading(true)
    adminService.whatsapp
      .connectionEvents()
      .then((events) => {
        setWaEvents(events as WaHistoryEvent[])
        setWaEventsError(null)
      })
      .catch((err) => {
        const classified = classifyWaHistoryError(err)
        setWaEvents([])
        setWaEventsError(classified.message)
      })
      .finally(() => setWaEventsLoading(false))
  }

  useEffect(() => {
    loadWaEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappHabilitado])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-lg font-bold text-white">Conta</h1>

      {whatsappHabilitado ? (
        <div>
          <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#e0211a]" /> WhatsApp
          </h2>
          <p className="text-[#d4d4d8]/60 text-sm mb-4">Conecte o número da loja pra disparar as notificações automáticas.</p>
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <WhatsAppConnection api={adminService.whatsapp} onConnected={loadWaEvents} onDisconnected={loadWaEvents} />
            <div className="flex-1 min-w-0 max-w-md bg-[#161618] border border-white/5 rounded-2xl p-5">
              <p className="font-semibold text-white text-sm mb-3">Histórico de conexões</p>
              {waEventsLoading && (
                <p className="text-[#d4d4d8]/60 text-xs flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
                </p>
              )}
              {waEventsError && <p className="text-red-400 text-xs">{waEventsError}</p>}
              {!waEventsLoading && !waEventsError && waEvents.length === 0 && (
                <p className="text-[#d4d4d8]/60 text-xs">Nenhuma conexão ainda</p>
              )}
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {waEvents.map((ev) => {
                  const when = formatWaEventTime(ev.created_at)
                  return (
                    <li key={ev.id} className="flex items-center justify-between gap-3 text-xs border-b border-white/5 pb-2 last:border-0">
                      <span
                        className={
                          ev.event_type === 'connected'
                            ? 'text-emerald-400 font-semibold'
                            : ev.event_type === 'disconnected'
                              ? 'text-red-400 font-semibold'
                              : 'text-[#d4d4d8]'
                        }
                      >
                        {formatWaEventLabel(ev)}
                      </span>
                      <time className="text-[#d4d4d8]/50 whitespace-nowrap">{when ?? '—'}</time>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[#d4d4d8]/50 text-sm">WhatsApp não habilitado pra essa loja.</p>
      )}
    </div>
  )
}
