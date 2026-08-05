import { useEffect, useState } from 'react'
import { Clock, Loader2, MessageCircle } from 'lucide-react'
import { adminService } from '../../services/adminService'
import WhatsAppConnection from '../../components/ui/WhatsAppConnection'
import StoreHoursCard from '../../components/admin/StoreHoursCard'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import {
  classifyWaHistoryError,
  formatWaEventLabel,
  formatWaEventTime,
  type WaHistoryEvent,
} from '../../lib/whatsappHistory'

// Troca de senha do admin saiu daqui — fica só em /meu-plano (Resolutoo),
// que já sincroniza a senha com o painel da loja (ver RedefinirSenha.tsx /
// TrocarSenha.tsx + POST /internal/sync-admin-password). Duas telas pra
// trocar a mesma senha só criava risco de ficarem dessincronizadas.
export default function AdminSenha() {
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
        // Nunca mascarar falha de schema/rota como "Nenhuma conexão ainda" —
        // Status "Conectado" + histórico vazio falso era exatamente esse bug.
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
    <div className="space-y-10">
      <div>
        <h2 className="text-2xl font-black mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5" /> Horário de funcionamento
        </h2>
        <p className="text-son-silver-dim text-sm mb-6">Defina quando a loja aceita pedidos.</p>
        <StoreHoursCard />
      </div>

      {whatsappHabilitado && (
        <div>
          <h2 className="text-2xl font-black mb-1 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" /> WhatsApp
          </h2>
          <p className="text-son-silver-dim text-sm mb-6">Conecte o número da loja pra disparar as notificações automáticas.</p>
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <WhatsAppConnection
              api={adminService.whatsapp}
              onConnected={loadWaEvents}
              onDisconnected={() => {
                loadWaEvents()
              }}
            />
            <div className="flex-1 min-w-0 max-w-md bg-son-surface border border-white/5 rounded-2xl p-5">
              <p className="font-semibold text-white text-sm mb-3">Histórico de conexões</p>
              {waEventsLoading && (
                <p className="text-son-silver-dim text-xs flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…
                </p>
              )}
              {waEventsError && <p className="error-msg text-xs" data-testid="wa-history-error">{waEventsError}</p>}
              {!waEventsLoading && !waEventsError && waEvents.length === 0 && (
                <p className="text-son-silver-dim text-xs" data-testid="wa-history-empty">
                  Nenhuma conexão ainda
                </p>
              )}
              <ul className="space-y-2 max-h-64 overflow-y-auto" data-testid="wa-history-list">
                {waEvents.map((ev) => {
                  const when = formatWaEventTime(ev.created_at)
                  return (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-3 text-xs border-b border-white/5 pb-2 last:border-0"
                      data-testid="wa-history-row"
                    >
                      <span
                        className={
                          ev.event_type === 'connected'
                            ? 'text-emerald-400 font-semibold'
                            : ev.event_type === 'disconnected'
                              ? 'text-red-400 font-semibold'
                              : 'text-son-silver'
                        }
                      >
                        {formatWaEventLabel(ev)}
                      </span>
                      <time className="text-son-silver-dim whitespace-nowrap" dateTime={ev.created_at}>
                        {when ?? '—'}
                      </time>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
