import { useEffect, useState } from 'react'
import { Clock, KeyRound, Loader2, MessageCircle } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { adminService } from '../../services/adminService'
import WhatsAppConnection from '../../components/ui/WhatsAppConnection'
import StoreHoursCard from '../../components/admin/StoreHoursCard'
import { useTenantConfig } from '../../hooks/useTenantConfig'

interface WaEvent {
  id: string
  event_type: string
  previous_state: string | null
  new_state: string | null
  created_at: string
}

function formatEventLabel(e: WaEvent): string {
  if (e.event_type === 'connected') return 'Conectado'
  if (e.event_type === 'disconnected') return 'Desconectado'
  return e.event_type
}

export default function AdminSenha() {
  const tenantConfig = useTenantConfig()
  const whatsappHabilitado = tenantConfig?.whatsapp_habilitado === true
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [waEvents, setWaEvents] = useState<WaEvent[]>([])
  const [waEventsError, setWaEventsError] = useState<string | null>(null)

  const loadWaEvents = () => {
    if (!whatsappHabilitado) return
    setWaEventsError(null)
    adminService.whatsapp
      .connectionEvents()
      .then((events) => {
        setWaEvents(events)
        setWaEventsError(null)
      })
      .catch((err) => {
        // Deploy gap / rota ainda não no ar: empty state, never raw "Erro 404".
        const status = err instanceof ApiError ? err.status : undefined
        const msg = err instanceof ApiError ? err.message : ''
        if (
          status === 404 ||
          status === 502 ||
          status === 503 ||
          status === 0 ||
          /^erro\s*404\b/i.test(msg) ||
          /does not exist|relation|whatsapp_connection_events/i.test(msg)
        ) {
          setWaEvents([])
          setWaEventsError(null)
          return
        }
        if (status === 401 || /unauthorized|expired token/i.test(msg)) {
          setWaEventsError('Sessão expirada — faça login de novo.')
          return
        }
        setWaEventsError('Não foi possível carregar o histórico.')
      })
  }

  useEffect(() => {
    loadWaEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappHabilitado])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setError('A confirmação não confere com a nova senha.')
      return
    }
    if (newPassword.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.')
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
              minLength={6}
              required
            />
          </div>
          <div>
            <label className="label">Repetir nova senha</label>
            <input
              className="input-field"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          {success && <p className="text-green-500 text-sm">Senha alterada com sucesso.</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Salvar
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-2xl font-black mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5" /> Horário de funcionamento
        </h2>
        <p className="text-son-silver-dim text-sm mb-6">
          Defina os dias e horários que a loja atende, ou force fechar/abrir manualmente a qualquer momento.
        </p>
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
                // emitWhatsAppGateChange(false) already fired inside WhatsAppConnection;
                // refresh history — AdminLayout listens and re-locks the full-screen gate.
                loadWaEvents()
              }}
            />
            <div className="flex-1 min-w-0 max-w-md bg-son-surface border border-white/5 rounded-2xl p-5">
              <p className="font-semibold text-white text-sm mb-3">Histórico de conexões</p>
              {waEventsError && <p className="error-msg text-xs">{waEventsError}</p>}
              {!waEventsError && waEvents.length === 0 && (
                <p className="text-son-silver-dim text-xs">Nenhuma conexão ainda</p>
              )}
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {waEvents.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between gap-3 text-xs border-b border-white/5 pb-2 last:border-0">
                    <span
                      className={
                        ev.event_type === 'connected'
                          ? 'text-emerald-400 font-semibold'
                          : ev.event_type === 'disconnected'
                            ? 'text-red-400 font-semibold'
                            : 'text-son-silver'
                      }
                    >
                      {formatEventLabel(ev)}
                    </span>
                    <time className="text-son-silver-dim whitespace-nowrap">
                      {new Date(ev.created_at).toLocaleString('pt-BR')}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
