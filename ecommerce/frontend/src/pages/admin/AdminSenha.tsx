import { useEffect, useState } from 'react'
import { Clock, KeyRound, Loader2, MessageCircle } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { adminService } from '../../services/adminService'
import WhatsAppConnection from '../../components/ui/WhatsAppConnection'
import StoreHoursCard from '../../components/admin/StoreHoursCard'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { validatePasswordChange } from '../../lib/adminValidators'
import {
  classifyWaHistoryError,
  formatWaEventLabel,
  formatWaEventTime,
  type WaHistoryEvent,
} from '../../lib/whatsappHistory'

export default function AdminSenha() {
  const tenantConfig = useTenantConfig()
  const whatsappHabilitado = tenantConfig?.whatsapp_habilitado === true
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const validation = validatePasswordChange(newPassword, confirmPassword)
    if (validation) {
      setError(validation)
      return
    }

    setLoading(true)
    try {
      await authService.staff.setAdminPassword(newPassword)
      setSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao trocar a senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-black mb-1 flex items-center gap-2">
          <KeyRound className="w-5 h-5" /> Trocar senha
        </h1>
        <p className="text-son-silver-dim text-sm mb-6">Defina uma nova senha de login do admin.</p>

        <form onSubmit={handleSubmit} className="max-w-sm bg-son-surface border border-white/5 rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">Nova senha</label>
            <input
              className="input-field"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="label">Confirmar senha</label>
            <input
              className="input-field"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          {success && <p className="text-emerald-400 text-sm">Senha atualizada.</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Salvar senha
          </button>
        </form>
      </div>

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
