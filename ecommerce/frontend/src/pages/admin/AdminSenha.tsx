import { useEffect, useState } from 'react'
import { Clock, KeyRound, Loader2, MessageCircle, Plus, Power, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import type { StoreHourDay, StoreStatus } from '../../lib/types'
import { DAY_LABELS, isScheduledOpenNow } from '../../lib/storeHours'
import WhatsAppConnection from '../../components/ui/WhatsAppConnection'

// Horas inteiras de 0 a 24 (Brasil usa 24h) — granularidade de intervalo é
// por hora cheia, sem minutos.
const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

function StoreHoursCard() {
  const [status, setStatus] = useState<StoreStatus | null>(null)
  const [hours, setHours] = useState<StoreHourDay[]>([])
  const [savingHours, setSavingHours] = useState(false)
  const [hoursError, setHoursError] = useState<string | null>(null)
  const [hoursSaved, setHoursSaved] = useState(false)

  const [closeReasonDraft, setCloseReasonDraft] = useState('')
  const [showCloseReasonPrompt, setShowCloseReasonPrompt] = useState(false)
  const [savingManual, setSavingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  const load = () => api.admin.storeStatus.get().then((s) => {
    setStatus(s)
    setHours(s.hours)
  })

  useEffect(() => {
    load()
  }, [])

  const patchDay = (day: number, patch: Partial<StoreHourDay>) =>
    setHours((prev) => prev.map((h) => (h.day_of_week === day ? { ...h, ...patch } : h)))

  const addInterval = (day: number) =>
    setHours((prev) =>
      prev.map((h) => (h.day_of_week === day ? { ...h, intervals: [...h.intervals, { opens_at: '10:00', closes_at: '14:00' }] } : h))
    )

  const removeInterval = (day: number, index: number) =>
    setHours((prev) =>
      prev.map((h) => (h.day_of_week === day ? { ...h, intervals: h.intervals.filter((_, i) => i !== index) } : h))
    )

  const patchInterval = (day: number, index: number, patch: Partial<{ opens_at: string; closes_at: string }>) =>
    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === day ? { ...h, intervals: h.intervals.map((iv, i) => (i === index ? { ...iv, ...patch } : iv)) } : h
      )
    )

  const saveHours = async () => {
    setSavingHours(true)
    setHoursError(null)
    setHoursSaved(false)
    try {
      await api.admin.storeStatus.setHours(hours)
      setHoursSaved(true)
      load()
    } catch (err) {
      setHoursError(err instanceof ApiError ? err.message : 'Não foi possível salvar os horários.')
    } finally {
      setSavingHours(false)
    }
  }

  const toggleManual = async (reason?: string) => {
    if (!status) return
    setSavingManual(true)
    setManualError(null)
    try {
      await api.admin.storeStatus.setManualStatus(!status.manually_closed, reason)
      setShowCloseReasonPrompt(false)
      setCloseReasonDraft('')
      load()
    } catch (err) {
      setManualError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o status da loja.')
    } finally {
      setSavingManual(false)
    }
  }

  const handleToggleClick = () => {
    if (!status) return
    // Reabrir nunca precisa de justificativa.
    if (status.manually_closed) {
      toggleManual()
      return
    }
    // Fechando: se agora é um horário que deveria estar aberto, exige motivo.
    if (isScheduledOpenNow(status)) {
      setShowCloseReasonPrompt(true)
      setManualError(null)
      return
    }
    toggleManual()
  }

  if (!status) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-son-pink" />
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-son-surface border border-white/5 rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-white flex items-center gap-2">
              <Power className={`w-4 h-4 ${status.manually_closed ? 'text-red-400' : 'text-emerald-400'}`} />
              {status.manually_closed ? 'Loja fechada manualmente' : 'Loja seguindo o horário normal'}
            </p>
            {status.manually_closed && status.manual_closed_reason && (
              <p className="text-son-silver-dim text-xs mt-1">Motivo: {status.manual_closed_reason}</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleToggleClick}
            disabled={savingManual}
            className={`inline-flex items-center w-[4.5rem] h-7 px-1 rounded-full border transition-colors duration-200 flex-shrink-0 ${
              !status.manually_closed ? 'justify-end bg-emerald-500/15 border-emerald-400/60' : 'justify-start bg-white/5 border-white/20'
            }`}
          >
            <span className={`flex items-center gap-1.5 ${!status.manually_closed ? 'flex-row-reverse' : ''}`}>
              <span className={`w-5 h-5 rounded-full flex-shrink-0 ${!status.manually_closed ? 'bg-emerald-400' : 'bg-son-silver-dim'}`} />
              <span className={`text-[10px] font-bold ${!status.manually_closed ? 'text-emerald-300' : 'text-son-silver-dim'}`}>
                {!status.manually_closed ? 'ON' : 'OFF'}
              </span>
            </span>
          </button>
        </div>
        {showCloseReasonPrompt && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <label className="label">Por que está fechando fora do previsto? (obrigatório)</label>
            <textarea
              className="input-field"
              rows={2}
              value={closeReasonDraft}
              onChange={(e) => setCloseReasonDraft(e.target.value)}
              placeholder="Ex: imprevisto, manutenção, feriado não programado..."
            />
            <p className="text-son-silver-dim text-[11px]">Essa mensagem aparece pros clientes na página inicial.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleManual(closeReasonDraft)}
                disabled={savingManual || !closeReasonDraft.trim()}
                className="btn-primary text-sm py-2 px-3"
              >
                {savingManual ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirmar fechamento
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCloseReasonPrompt(false)
                  setCloseReasonDraft('')
                }}
                className="btn-secondary text-sm py-2 px-3"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {manualError && <p className="error-msg">{manualError}</p>}
      </div>

      <div className="bg-son-surface border border-white/5 rounded-2xl p-6 space-y-4">
        <p className="font-semibold text-white">Horário semanal</p>
        <div className="space-y-4">
          {hours
            .slice()
            .sort((a, b) => a.day_of_week - b.day_of_week)
            .map((h) => (
              <div key={h.day_of_week} className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 w-28 flex-shrink-0 text-sm text-son-silver">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-son-pink"
                      checked={h.is_open}
                      onChange={(e) => patchDay(h.day_of_week, { is_open: e.target.checked })}
                    />
                    {DAY_LABELS[h.day_of_week]}
                  </label>
                  {h.is_open && (
                    <button
                      type="button"
                      onClick={() => addInterval(h.day_of_week)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-son-gold/40 text-son-gold text-[10px] font-semibold hover:bg-son-gold/10"
                    >
                      <Plus className="w-3 h-3" /> Intervalo
                    </button>
                  )}
                </div>
                {h.is_open && (
                  <div className="pl-[7.5rem] space-y-1.5">
                    {h.intervals.length === 0 && (
                      <p className="text-son-silver-dim text-xs">Nenhum intervalo — clique em "+ Intervalo" pra adicionar.</p>
                    )}
                    {h.intervals.map((iv, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          className="input-field w-24"
                          value={iv.opens_at}
                          onChange={(e) => patchInterval(h.day_of_week, i, { opens_at: e.target.value })}
                        >
                          {HOUR_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <span className="text-son-silver-dim text-xs">até</span>
                        <select
                          className="input-field w-24"
                          value={iv.closes_at}
                          onChange={(e) => patchInterval(h.day_of_week, i, { closes_at: e.target.value })}
                        >
                          {HOUR_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <button type="button" onClick={() => removeInterval(h.day_of_week, i)} className="text-son-silver-dim hover:text-son-pink">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </div>
        {hoursError && <p className="error-msg">{hoursError}</p>}
        {hoursSaved && <p className="text-green-500 text-sm">Horários salvos.</p>}
        <button onClick={saveHours} disabled={savingHours} className="btn-primary text-sm py-2.5 px-3">
          {savingHours ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Salvar horários
        </button>
      </div>
    </div>
  )
}

export default function AdminSenha() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

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
      await api.auth.setAdminPassword(newPassword)
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

      <div>
        <h2 className="text-2xl font-black mb-1 flex items-center gap-2">
          <MessageCircle className="w-5 h-5" /> WhatsApp
        </h2>
        <p className="text-son-silver-dim text-sm mb-6">Conecte o número da loja pra disparar as notificações automáticas.</p>
        <WhatsAppConnection api={api.admin.whatsapp} />
      </div>

    </div>
  )
}
