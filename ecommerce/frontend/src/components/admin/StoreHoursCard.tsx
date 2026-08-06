import { useEffect, useState } from 'react'
import { Loader2, Plus, Power, Trash2 } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { StoreHourDay, StoreHourInterval, StoreStatus } from '../../types'
import { DAY_LABELS, isScheduledOpenNow } from '../../lib/storeHours'

// Horas inteiras de 0 a 24 (Brasil usa 24h) — granularidade de intervalo é
// por hora cheia, sem minutos.
const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

function defaultHours(): StoreHourDay[] {
  return Array.from({ length: 7 }, (_, day_of_week) => ({
    day_of_week,
    is_open: true,
    intervals: [{ opens_at: '09:00', closes_at: '18:00' }],
  }))
}

function defaultStatus(): StoreStatus {
  return { hours: defaultHours(), manually_closed: false, manual_closed_reason: null, onboarding_hours_done: false }
}

/** Normaliza "9:00" / "09:00:00" → "09:00" pra casar com os <select>. */
function normalizeTime(raw: string | null | undefined): string {
  if (!raw) return '09:00'
  const m = String(raw).trim().match(/^(\d{1,2})(?::(\d{2}))?/)
  if (!m) return '09:00'
  const h = Math.min(24, Math.max(0, Number(m[1])))
  return `${String(h).padStart(2, '0')}:00`
}

function normalizeInterval(iv: StoreHourInterval): StoreHourInterval {
  return { opens_at: normalizeTime(iv.opens_at), closes_at: normalizeTime(iv.closes_at) }
}

/** Garante 7 dias (0..6) com intervals válidos — API incompleta ou fallback. */
function normalizeHours(raw: StoreHourDay[] | null | undefined): StoreHourDay[] {
  const byDay = new Map<number, StoreHourDay>()
  for (const h of raw ?? []) {
    if (h == null || typeof h.day_of_week !== 'number') continue
    if (h.day_of_week < 0 || h.day_of_week > 6) continue
    byDay.set(h.day_of_week, {
      day_of_week: h.day_of_week,
      is_open: !!h.is_open,
      intervals: Array.isArray(h.intervals) ? h.intervals.map(normalizeInterval) : [],
    })
  }
  return Array.from({ length: 7 }, (_, day_of_week) => {
    const existing = byDay.get(day_of_week)
    if (existing) return existing
    return { day_of_week, is_open: true, intervals: [{ opens_at: '09:00', closes_at: '18:00' }] }
  })
}

/** Mensagens amigáveis — nunca "Erro 404", "Invalid schema: ufersin", etc. */
function friendlyHoursError(err: unknown, action: 'carregar' | 'salvar' | 'status'): string | null {
  // Falha ao carregar: UI já tem defaults editáveis — sem banner vermelho.
  if (action === 'carregar') return null

  const status = err instanceof ApiError ? err.status : undefined
  const raw = err instanceof ApiError ? err.message : ''
  const lower = raw.toLowerCase()

  if (status === 404 || status === 502 || status === 503 || status === 0) {
    return action === 'salvar'
      ? 'Servidor ainda atualizando. Você pode editar os intervalos; tente salvar de novo em alguns minutos.'
      : 'Servidor ainda atualizando. Tente de novo em alguns minutos.'
  }
  if (
    lower.includes('invalid schema') ||
    lower.includes('store_hours') ||
    lower.includes('does not exist') ||
    lower.includes('relation') ||
    /^erro\s*404\b/i.test(raw) ||
    raw === 'Erro 404'
  ) {
    return action === 'salvar'
      ? 'Horários ainda não disponíveis no servidor. Edite e tente salvar de novo em instantes.'
      : 'Status da loja ainda não disponível no servidor. Tente de novo em instantes.'
  }
  if (status === 401 || lower.includes('unauthorized')) {
    return 'Sessão expirada — faça login de novo.'
  }
  // Evita despejar JSON/técnico no painel.
  if (!raw || raw.length > 120 || /[{}\[\]`]/.test(raw) || /sql|schema|postgres|stack/i.test(raw)) {
    return action === 'salvar'
      ? 'Não foi possível salvar os horários. Tente de novo.'
      : 'Não foi possível atualizar o status da loja. Tente de novo.'
  }
  return raw
}

export default function StoreHoursCard({
  onSaved,
  hideManualToggle = false,
}: {
  onSaved?: () => void
  hideManualToggle?: boolean
}) {
  const [status, setStatus] = useState<StoreStatus | null>(null)
  const [hours, setHours] = useState<StoreHourDay[]>([])
  const [savingHours, setSavingHours] = useState(false)
  const [hoursError, setHoursError] = useState<string | null>(null)
  const [hoursSaved, setHoursSaved] = useState(false)
  const [hoursHint, setHoursHint] = useState<string | null>(null)

  const [closeReasonDraft, setCloseReasonDraft] = useState('')
  const [showCloseReasonPrompt, setShowCloseReasonPrompt] = useState(false)
  const [savingManual, setSavingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  const applyLoaded = (s: StoreStatus) => {
    const normalized = normalizeHours(s.hours)
    setStatus({ ...s, hours: normalized })
    setHours(normalized)
    setHoursError(null)
    setHoursHint(null)
  }

  const applyLocalDefaults = (hint?: string | null) => {
    const s = defaultStatus()
    setStatus(s)
    setHours(s.hours)
    setHoursError(null)
    setHoursHint(hint ?? null)
  }

  useEffect(() => {
    // Timeout de segurança: se a API travar, libera a UI em ≤8s.
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      applyLocalDefaults(null)
    }, 8000)

    adminService.storeStatus
      .get()
      .then((s) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        applyLoaded(s)
      })
      .catch(() => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        applyLocalDefaults(null)
      })

    return () => window.clearTimeout(timer)
  }, [])

  const patchDay = (day: number, patch: Partial<StoreHourDay>) =>
    setHours((prev) => prev.map((h) => (h.day_of_week === day ? { ...h, ...patch } : h)))

  const addInterval = (day: number) =>
    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === day
          ? { ...h, intervals: [...h.intervals, { opens_at: '18:00', closes_at: '22:00' }] }
          : h
      )
    )

  const removeInterval = (day: number, index: number) =>
    setHours((prev) =>
      prev.map((h) => (h.day_of_week === day ? { ...h, intervals: h.intervals.filter((_, i) => i !== index) } : h))
    )

  const patchInterval = (day: number, index: number, patch: Partial<{ opens_at: string; closes_at: string }>) =>
    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === day
          ? {
              ...h,
              intervals: h.intervals.map((iv, i) =>
                i === index ? normalizeInterval({ ...iv, ...patch }) : iv
              ),
            }
          : h
      )
    )

  const saveHours = async () => {
    setHoursError(null)
    setHoursSaved(false)
    setHoursHint(null)
    const payload = normalizeHours(hours)
    // Loja não pode ficar sem nenhum dia aberto — pelo menos 1, no máximo os 7.
    if (!payload.some((h) => h.is_open)) {
      setHoursError('Marque pelo menos 1 dia de funcionamento — a loja não pode ficar fechada todos os dias.')
      return
    }
    setSavingHours(true)
    try {
      await adminService.storeStatus.setHours(payload)
      setHours(payload)
      setHoursSaved(true)
      onSaved?.()
      // Recarrega do servidor, mas se falhar mantém o que acabou de salvar localmente.
      try {
        const s = await adminService.storeStatus.get()
        applyLoaded(s)
      } catch {
        setStatus((prev) => ({
          hours: payload,
          manually_closed: prev?.manually_closed ?? false,
          manual_closed_reason: prev?.manual_closed_reason ?? null,
          onboarding_hours_done: true,
        }))
      }
    } catch (err) {
      setHoursError(friendlyHoursError(err, 'salvar'))
      // Mantém edições locais (incluindo intervalos) pra o lojista tentar de novo.
      setHours(payload)
    } finally {
      setSavingHours(false)
    }
  }

  const toggleManual = async (reason?: string) => {
    if (!status) return
    setSavingManual(true)
    setManualError(null)
    const nextClosed = !status.manually_closed
    try {
      await adminService.storeStatus.setManualStatus(nextClosed, reason)
      setShowCloseReasonPrompt(false)
      setCloseReasonDraft('')
      setStatus({
        ...status,
        hours,
        manually_closed: nextClosed,
        manual_closed_reason: nextClosed ? reason?.trim() || null : null,
      })
      try {
        const s = await adminService.storeStatus.get()
        applyLoaded(s)
      } catch {
        /* já atualizou o toggle localmente */
      }
    } catch (err) {
      setManualError(friendlyHoursError(err, 'status'))
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
    if (isScheduledOpenNow({ ...status, hours })) {
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
      {!hideManualToggle && (
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
      )}

      <div className="bg-son-surface border border-white/5 rounded-2xl p-6 space-y-4">
        <p className="font-semibold text-white">Horário semanal</p>
        <p className="text-son-silver-dim text-xs">
          Use &quot;+ Intervalo&quot; pra dias com mais de um turno (ex.: 10h–14h e 18h–22h).
        </p>
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
                      <p className="text-son-silver-dim text-xs">Nenhum intervalo — clique em &quot;+ Intervalo&quot; pra adicionar.</p>
                    )}
                    {h.intervals.map((iv, i) => (
                      <div key={`${h.day_of_week}-${i}-${iv.opens_at}-${iv.closes_at}`} className="flex items-center gap-2">
                        <select
                          className="input-field w-24"
                          value={HOUR_OPTIONS.includes(iv.opens_at) ? iv.opens_at : normalizeTime(iv.opens_at)}
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
                          value={HOUR_OPTIONS.includes(iv.closes_at) ? iv.closes_at : normalizeTime(iv.closes_at)}
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
        {hoursHint && <p className="text-son-silver-dim text-xs">{hoursHint}</p>}
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

