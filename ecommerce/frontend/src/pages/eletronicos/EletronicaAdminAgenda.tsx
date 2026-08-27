import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CalendarDays, CalendarClock, Check, CheckCircle2, ChevronDown, Clock, History, Lock, Loader2, MessageCircle, Plus, Unlock, User, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { AppointmentDto } from '../../lib/eletronicosApi'

// Port 1:1 (parcial, gaps disclosed abaixo) de
// src/app/dashboard/agenda/AgendaClient.tsx do vrtech -- grade de
// disponibilidade do dia (livre/ocupado/bloqueado/muito em cima), seletor
// de dia (dropdown + Hoje/Amanhã), lista de atendimentos do dia com
// "Concluir"/"Remarcar"/"Cancelar" (justificativa >=20 chars + aviso
// padrão via template ou mensagem customizada, igual src/lib/agenda/notifications.ts),
// dialog "Indisponibilizar horário" com lista de bloqueios + liberar.
// Dialog de detalhe com histórico de eventos (appointment_events) --
// port de DetailDialog em AgendaClient.tsx.
// AgendaSettingsCard.tsx também portado 1:1 abaixo (antecedência mínima,
// buffer entre atendimentos, horário de funcionamento por dia com múltiplos
// blocos) via GET/PUT /api/admin/eletronicos/agenda/{settings,business-hours}.

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const SETTINGS_LABEL = 'block text-xs font-semibold text-[#d4d4d8]/60 mb-1.5 uppercase tracking-wider'
const SETTINGS_INPUT =
  'w-full px-3.5 py-2.5 rounded-xl bg-[#0a0a0b] border border-white/8 text-white text-sm placeholder-[#d4d4d8]/30 outline-none focus:border-[#e0211a]/50 transition-colors'

type AgendaSettings = {
  appointment_ai_enabled: boolean
  lead_time_minutes: number
  buffer_minutes: number
  default_duration_minutes: number
}
type HourBlock = { weekday: number; open_time: string; close_time: string }

function toInputTime(t: string): string {
  return t.slice(0, 5)
}

function AgendaSettingsCard() {
  const [cfg, setCfg] = useState<AgendaSettings | null>(null)
  const [blocks, setBlocks] = useState<HourBlock[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    Promise.all([eletronicosAdmin.agenda.settings.get(), eletronicosAdmin.agenda.businessHours.list()])
      .then(([settings, hours]) => {
        setCfg(settings)
        setBlocks(hours.map((h) => ({ weekday: h.weekday, open_time: toInputTime(h.open_time), close_time: toInputTime(h.close_time) })))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar a agenda.'))
  }, [])

  const set = <K extends keyof AgendaSettings>(k: K, v: AgendaSettings[K]) => setCfg((prev) => (prev ? { ...prev, [k]: v } : prev))
  const addBlock = (weekday: number) => setBlocks((prev) => [...(prev ?? []), { weekday, open_time: '09:00', close_time: '18:00' }])
  const removeBlock = (index: number) => setBlocks((prev) => (prev ?? []).filter((_, i) => i !== index))
  const updateBlock = (index: number, patch: Partial<HourBlock>) => setBlocks((prev) => (prev ?? []).map((b, i) => (i === index ? { ...b, ...patch } : b)))

  const save = async () => {
    if (!cfg || !blocks) return
    setSaving(true)
    setError(null)
    try {
      const [settingsRes, hoursRes] = await Promise.all([
        eletronicosAdmin.agenda.settings.update(cfg),
        eletronicosAdmin.agenda.businessHours.update({ blocks }),
      ])
      setCfg(settingsRes)
      setBlocks(hoursRes.map((h) => ({ weekday: h.weekday, open_time: toInputTime(h.open_time), close_time: toInputTime(h.close_time) })))
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !cfg) {
    return <div className="bg-[#161618] rounded-2xl border border-white/5 p-4 text-sm text-red-400">{error}</div>
  }
  if (!cfg || !blocks) {
    return (
      <div className="bg-[#161618] rounded-2xl border border-white/5 p-4 flex items-center gap-2 text-sm text-[#d4d4d8]/40">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando agenda...
      </div>
    )
  }

  return (
    <div className="bg-[#161618] rounded-2xl border border-white/5 overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-white/2 transition-colors">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-[#e0211a]" />
          Agendamento de atendimentos
        </h2>
        <ChevronDown className={`w-4 h-4 text-[#d4d4d8]/50 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="p-4 pt-0 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cfg.appointment_ai_enabled}
              onChange={(e) => set('appointment_ai_enabled', e.target.checked)}
              className="w-4 h-4 accent-[#e0211a]"
            />
            <span className="text-sm text-white">
              Deixar a assistente agendar atendimentos
              <span className="block text-xs text-[#d4d4d8]/50">Desligado, ela não consulta nem marca horários no WhatsApp.</span>
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={SETTINGS_LABEL}>Antecedência mínima (min)</label>
              <input
                type="number"
                min={0}
                step={5}
                value={cfg.lead_time_minutes}
                onChange={(e) => set('lead_time_minutes', Number(e.target.value))}
                className={SETTINGS_INPUT}
              />
              <p className="text-xs text-[#d4d4d8]/50 mt-1">
                Folga entre agora e o próximo horário aceito. Com 30, às 9h a assistente só oferece a partir das 9h30.
              </p>
            </div>
            <div>
              <label className={SETTINGS_LABEL}>Buffer entre atendimentos (min)</label>
              <input
                type="number"
                min={0}
                step={5}
                value={cfg.buffer_minutes}
                onChange={(e) => set('buffer_minutes', Number(e.target.value))}
                className={SETTINGS_INPUT}
              />
              <p className="text-xs text-[#d4d4d8]/50 mt-1">
                Folga obrigatória depois de um atendimento e a partir de agora — evita marcar em sequência colada.
              </p>
            </div>
          </div>

          <div className="border-t border-white/5 pt-4 space-y-3">
            <p className={SETTINGS_LABEL}>Horário de funcionamento</p>
            {WEEKDAY_LABELS.map((label, weekday) => {
              const dayBlocks = blocks.map((b, i) => ({ ...b, i })).filter((b) => b.weekday === weekday)
              return (
                <div key={weekday} className="flex flex-wrap items-start gap-2">
                  <span className="text-sm text-[#d4d4d8]/70 w-20 pt-2.5 shrink-0">{label}</span>
                  <div className="flex-1 flex flex-col gap-2 min-w-[240px]">
                    {dayBlocks.length === 0 && <span className="text-xs text-[#d4d4d8]/30 py-2.5">Fechado</span>}
                    {dayBlocks.map((b) => (
                      <div key={b.i} className="flex items-center gap-2">
                        <input type="time" value={b.open_time} onChange={(e) => updateBlock(b.i, { open_time: e.target.value })} className={`${SETTINGS_INPUT} w-32`} />
                        <span className="text-[#d4d4d8]/40 text-sm">até</span>
                        <input type="time" value={b.close_time} onChange={(e) => updateBlock(b.i, { close_time: e.target.value })} className={`${SETTINGS_INPUT} w-32`} />
                        <button onClick={() => removeBlock(b.i)} className="p-1.5 rounded-lg text-[#d4d4d8]/40 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addBlock(weekday)} className="self-start flex items-center gap-1 text-xs text-[#e0211a] hover:text-[#e0211a]/80 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Adicionar bloco
                    </button>
                  </div>
                </div>
              )
            })}
            <p className="text-xs text-[#d4d4d8]/40">Um dia pode ter mais de um bloco (ex: 08:00–12:00 e 14:00–18:00). Dia sem nenhum bloco fica fechado pra agendamento.</p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={save}
            disabled={saving}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors ${
              saved ? 'bg-green-600 text-white' : 'bg-[#e0211a] text-white hover:bg-[#a3140f] disabled:opacity-40'
            }`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
            {saved ? 'Salvo!' : 'Salvar agendamento'}
          </button>
        </div>
      )}
    </div>
  )
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const SELECT = 'bg-[#0a0a0b] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#e0211a] transition-colors'
const INPUT = 'w-full bg-[#0a0a0b] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#d4d4d8]/30 outline-none focus:border-[#e0211a] transition-colors'

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function DateDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const today = new Date()
  const year = m ? Number(m[1]) : today.getFullYear()
  const month = m ? Number(m[2]) : today.getMonth() + 1
  const day = m ? Number(m[3]) : today.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const emit = (y: number, mo: number, d: number) => onChange(`${y}-${pad(mo)}-${pad(Math.min(d, daysInMonth(y, mo)))}`)
  const anos = [today.getFullYear(), today.getFullYear() + 1]
  const dias = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1)
  return (
    <div className="flex gap-2">
      <select aria-label="Dia" value={day} onChange={(e) => emit(year, month, Number(e.target.value))} className={SELECT}>
        {dias.map((d) => (
          <option key={d} value={d}>{pad(d)}</option>
        ))}
      </select>
      <select aria-label="Mês" value={month} onChange={(e) => emit(year, Number(e.target.value), day)} className={SELECT}>
        {MESES.map((nome, i) => (
          <option key={nome} value={i + 1}>{nome}</option>
        ))}
      </select>
      <select aria-label="Ano" value={year} onChange={(e) => emit(Number(e.target.value), month, day)} className={SELECT}>
        {anos.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
    </div>
  )
}

function TimeDropdown({ value, onChange, step = 5 }: { value: string; onChange: (v: string) => void; step?: number }) {
  const [h, m] = value.split(':')
  const pad = (n: number) => String(n).padStart(2, '0')
  const horas = Array.from({ length: 24 }, (_, i) => pad(i))
  const minutos = Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step))
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Hora" value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} className={SELECT}>
        {horas.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <span className="text-[#d4d4d8]/40">:</span>
      <select aria-label="Minuto" value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} className={SELECT}>
        {minutos.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <span className="text-xs text-[#d4d4d8]/40 ml-1">h</span>
    </div>
  )
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
}

function dateKeyToBr(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : key
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function tomorrowKey() {
  return new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function whatsappLink(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}`
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  agendado: { label: 'Agendado', className: 'bg-green-500/15 text-green-400' },
  remarcado: { label: 'Remarcado', className: 'bg-blue-500/15 text-blue-400' },
  cancelado: { label: 'Cancelado', className: 'bg-red-500/15 text-red-400' },
  concluido: { label: 'Concluído', className: 'bg-white/10 text-[#d4d4d8]' },
  nao_compareceu: { label: 'Não compareceu', className: 'bg-yellow-500/15 text-yellow-400' },
}

type DaySlot = { starts_at: string; ends_at: string; available: boolean; reason: string | null }
type AgendaBlock = { id: string; starts_at: string; ends_at: string; reason: string | null }

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-[#161618] border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 sticky top-0 bg-[#161618] z-10">
          <h2 className="font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-[#d4d4d8]/50 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function BlockDialog({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [dia, setDia] = useState(date)
  const [inicio, setInicio] = useState('12:00')
  const [fim, setFim] = useState('13:00')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = motivo.trim().length >= 10 && fim > inicio

  const submit = async () => {
    setSaving(true)
    setErr(null)
    try {
      await eletronicosAdmin.agenda.blocks.create({ data: dia, hora_inicio: inicio, hora_fim: fim, motivo })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao bloquear horário.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Indisponibilizar horário" onClose={onClose}>
      <div>
        <label className="block text-sm text-[#d4d4d8] mb-1.5">Data</label>
        <DateDropdown value={dia} onChange={setDia} />
      </div>
      <div>
        <label className="block text-sm text-[#d4d4d8] mb-1.5">Início</label>
        <TimeDropdown value={inicio} onChange={setInicio} />
      </div>
      <div>
        <label className="block text-sm text-[#d4d4d8] mb-1.5">Fim</label>
        <TimeDropdown value={fim} onChange={setFim} />
      </div>
      {fim <= inicio && <p className="text-xs text-red-400">O fim precisa ser depois do início.</p>}
      <div>
        <label className="block text-sm text-[#d4d4d8] mb-1.5">Motivo (interno)</label>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={`${INPUT} resize-none`} placeholder="Ex.: técnico em treinamento, manutenção do equipamento da bancada." />
        <p className="text-xs text-[#d4d4d8]/40 mt-1">O cliente vê apenas que o horário está indisponível — este motivo é só para você.</p>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button
        onClick={submit}
        disabled={saving || !valid}
        className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
        Indisponibilizar
      </button>
    </Dialog>
  )
}

const MIN_JUSTIFICATION_LENGTH = 20

function JustificationField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ok = value.trim().length >= MIN_JUSTIFICATION_LENGTH
  return (
    <div>
      <label className="block text-sm text-[#d4d4d8] mb-1.5">Motivo (obrigatório, visível só para você)</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={`${INPUT} resize-none`} placeholder="Explique o motivo com pelo menos 20 caracteres..." />
      {!ok && value.length > 0 && (
        <p className="text-xs text-red-400 mt-1">Faltam {MIN_JUSTIFICATION_LENGTH - value.trim().length} caracteres.</p>
      )}
    </div>
  )
}

function DefaultMessageToggle({
  useDefault,
  onToggle,
  customMessage,
  onCustomChange,
}: {
  useDefault: boolean
  onToggle: (v: boolean) => void
  customMessage: string
  onCustomChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-[#d4d4d8]">
        <input type="checkbox" checked={useDefault} onChange={(e) => onToggle(e.target.checked)} className="accent-[#e0211a]" />
        Usar mensagem padrão do WhatsApp
      </label>
      {!useDefault && (
        <div>
          <textarea
            value={customMessage}
            onChange={(e) => onCustomChange(e.target.value)}
            rows={3}
            className={`${INPUT} resize-none`}
            placeholder="Mensagem personalizada enviada ao cliente (mínimo 10 caracteres)..."
          />
          <p className="text-xs text-[#d4d4d8]/40 mt-1">Essa mensagem é enviada exatamente como escrita — não passa pelo modelo padrão.</p>
        </div>
      )}
    </div>
  )
}

function CancelDialog({ appt, onClose, onDone }: { appt: AppointmentDto; onClose: () => void; onDone: () => void }) {
  const [justification, setJustification] = useState('')
  const [useDefault, setUseDefault] = useState(true)
  const [customMessage, setCustomMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = justification.trim().length >= MIN_JUSTIFICATION_LENGTH && (useDefault || customMessage.trim().length >= 10)

  const submit = async () => {
    setSaving(true)
    setErr(null)
    try {
      await eletronicosAdmin.appointments.cancel(appt.id, {
        justification: justification.trim(),
        use_default_message: useDefault,
        custom_message: useDefault ? undefined : customMessage.trim(),
      })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao cancelar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Cancelar atendimento" onClose={onClose}>
      <p className="text-sm text-[#d4d4d8]/60">
        {appt.customer_name} — {appt.service_label} — {fmtTime(appt.starts_at)}
      </p>
      <JustificationField value={justification} onChange={setJustification} />
      <DefaultMessageToggle useDefault={useDefault} onToggle={setUseDefault} customMessage={customMessage} onCustomChange={setCustomMessage} />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button
        onClick={submit}
        disabled={saving || !valid}
        className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
        Cancelar atendimento
      </button>
    </Dialog>
  )
}

function RescheduleDialog({ appt, onClose, onDone }: { appt: AppointmentDto; onClose: () => void; onDone: () => void }) {
  const start = new Date(appt.starts_at)
  const [dia, setDia] = useState(start.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
  const [hora, setHora] = useState(fmtTime(appt.starts_at))
  const [justification, setJustification] = useState('')
  const [useDefault, setUseDefault] = useState(true)
  const [customMessage, setCustomMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const valid = justification.trim().length >= MIN_JUSTIFICATION_LENGTH && (useDefault || customMessage.trim().length >= 10)

  const submit = async () => {
    setSaving(true)
    setErr(null)
    try {
      await eletronicosAdmin.appointments.reschedule(appt.id, {
        data: dia,
        horario: hora,
        justification: justification.trim(),
        use_default_message: useDefault,
        custom_message: useDefault ? undefined : customMessage.trim(),
      })
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao remarcar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title="Remarcar atendimento" onClose={onClose}>
      <p className="text-sm text-[#d4d4d8]/60">
        {appt.customer_name} — {appt.service_label} — atual: {dateKeyToBr(start.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))} às {fmtTime(appt.starts_at)}
      </p>
      <div>
        <label className="block text-sm text-[#d4d4d8] mb-1.5">Nova data</label>
        <DateDropdown value={dia} onChange={setDia} />
      </div>
      <div>
        <label className="block text-sm text-[#d4d4d8] mb-1.5">Novo horário</label>
        <TimeDropdown value={hora} onChange={setHora} />
      </div>
      <JustificationField value={justification} onChange={setJustification} />
      <DefaultMessageToggle useDefault={useDefault} onToggle={setUseDefault} customMessage={customMessage} onCustomChange={setCustomMessage} />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button
        onClick={submit}
        disabled={saving || !valid}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
        Remarcar atendimento
      </button>
    </Dialog>
  )
}

const ACTION_LABEL: Record<string, string> = {
  created: 'Criado',
  rescheduled: 'Remarcado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  no_show: 'Não compareceu',
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type AppointmentEvent = {
  id: string
  action: string
  actor_type: string
  actor_id: string | null
  justification: string | null
  previous_starts_at: string | null
  new_starts_at: string | null
  created_at: string
}

function DetailDialog({ appointment, onClose }: { appointment: AppointmentDto; onClose: () => void }) {
  const [events, setEvents] = useState<AppointmentEvent[] | null>(null)
  const st = STATUS_CONFIG[appointment.status] ?? { label: appointment.status, className: 'bg-white/10 text-[#d4d4d8]' }
  const dur = Math.round((new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60_000)

  useEffect(() => {
    eletronicosAdmin.appointments.events(appointment.id).then(setEvents).catch(() => setEvents([]))
  }, [appointment.id])

  return (
    <Dialog title="Detalhes do agendamento" onClose={onClose}>
      <div className="space-y-1.5 text-sm">
        <p className="text-white font-semibold">{appointment.service_label}</p>
        <p className="text-[#d4d4d8]">{appointment.customer_name} — {appointment.customer_phone}</p>
        <p className="text-[#d4d4d8]">
          {dateKeyToBr(new Date(appointment.starts_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))}, {fmtTime(appointment.starts_at)}–{fmtTime(appointment.ends_at)}
          <span className="text-[#d4d4d8]/40"> ({dur} min)</span>
        </p>
        <p>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
        </p>
        {appointment.notes && <p className="text-[#d4d4d8]/70 pt-1">{appointment.notes}</p>}
      </div>

      <div className="border-t border-white/5 pt-3">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
          <History className="w-4 h-4 text-[#e0211a]" /> Histórico
        </h3>
        {!events ? (
          <div className="flex items-center gap-2 text-[#d4d4d8]/40 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-[#d4d4d8]/40">Sem eventos registrados.</p>
        ) : (
          <div className="space-y-2.5">
            {events.map((ev) => (
              <div key={ev.id} className="text-sm border-l-2 border-white/10 pl-3">
                <p className="text-white">
                  {ACTION_LABEL[ev.action] ?? ev.action}
                  <span className="text-[#d4d4d8]/40 text-xs ml-2">
                    {ev.actor_type}{ev.actor_id ? ` · ${ev.actor_id}` : ''}
                  </span>
                </p>
                <p className="text-[#d4d4d8]/50 text-xs">{fmtDateTime(ev.created_at)}</p>
                {ev.previous_starts_at && ev.new_starts_at && ev.previous_starts_at !== ev.new_starts_at && (
                  <p className="text-[#d4d4d8]/70 text-xs mt-0.5">
                    {fmtDateTime(ev.previous_starts_at)} → {fmtDateTime(ev.new_starts_at)}
                  </p>
                )}
                {ev.justification && <p className="text-[#d4d4d8]/70 text-xs mt-0.5 italic">&ldquo;{ev.justification}&rdquo;</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

export default function EletronicaAdminAgenda() {
  const [date, setDate] = useState(todayKey())
  const [slots, setSlots] = useState<DaySlot[] | null>(null)
  const [appointments, setAppointments] = useState<AppointmentDto[]>([])
  const [blocks, setBlocks] = useState<AgendaBlock[]>([])
  const [error, setError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(false)
  const [cancelling, setCancelling] = useState<AppointmentDto | null>(null)
  const [rescheduling, setRescheduling] = useState<AppointmentDto | null>(null)
  const [detail, setDetail] = useState<AppointmentDto | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [day, appts, blks] = await Promise.all([
        eletronicosAdmin.agenda.day(date),
        eletronicosAdmin.appointments.list({ from: `${date}T00:00:00-03:00`, to: `${date}T23:59:59-03:00` }),
        eletronicosAdmin.agenda.blocks.list(date),
      ])
      setSlots(day)
      setAppointments(appts)
      setBlocks(blks)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar a agenda.')
      setSlots([])
    }
  }, [date])

  useEffect(() => {
    load()
  }, [load])

  const completeAppt = async (id: string) => {
    try {
      await eletronicosAdmin.appointments.complete(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao concluir.')
    }
  }

  const unblock = async (id: string) => {
    try {
      await eletronicosAdmin.agenda.blocks.delete(id)
      load()
    } catch {
      // silencioso, load() já reflete o estado real
    }
  }

  const livres = slots?.filter((s) => s.available).length ?? 0
  const total = slots?.length ?? 0

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[#e0211a]" />
            Agenda
          </h1>
          <p className="text-sm text-[#d4d4d8]/50 mt-0.5">Mesma agenda usada pela assistente IA no WhatsApp.</p>
        </div>
        <button
          onClick={() => setBlocking(true)}
          className="shrink-0 flex items-center gap-1.5 bg-[#e0211a] hover:bg-[#a3140f] text-white text-sm font-medium px-3.5 py-2 rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          Indisponibilizar horário
        </button>
      </div>

      <AgendaSettingsCard />

      <div className="flex flex-wrap items-center gap-2">
        <DateDropdown value={date} onChange={setDate} />
        <button
          onClick={() => setDate(todayKey())}
          className={`text-sm px-3 py-2 rounded-xl transition-colors ${date === todayKey() ? 'bg-[#e0211a] text-white' : 'bg-[#161618] text-[#d4d4d8]/70 hover:text-white'}`}
        >
          Hoje
        </button>
        <button
          onClick={() => setDate(tomorrowKey())}
          className={`text-sm px-3 py-2 rounded-xl transition-colors ${date === tomorrowKey() ? 'bg-[#e0211a] text-white' : 'bg-[#161618] text-[#d4d4d8]/70 hover:text-white'}`}
        >
          Amanhã
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2.5 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!slots ? (
        <div className="flex items-center gap-2 text-[#d4d4d8]/40 text-sm py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando agenda...
        </div>
      ) : slots.length === 0 ? (
        <div className="text-center py-12 text-[#d4d4d8]/40">
          <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>A loja não abre em {dateKeyToBr(date)}</p>
        </div>
      ) : (
        <section className="bg-[#161618] rounded-2xl border border-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Disponibilidade — {dateKeyToBr(date)}</h2>
            <span className="text-xs text-[#d4d4d8]/50">
              {livres} de {total} horários livres
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {slots.map((s) => {
              const cls = s.available
                ? 'bg-green-500/10 border-green-500/25 text-green-400'
                : s.reason === 'bloqueado'
                  ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400'
                  : s.reason === 'muito_em_cima'
                    ? 'bg-white/[0.03] border-white/5 text-[#d4d4d8]/25'
                    : 'bg-red-500/10 border-red-500/25 text-red-400'
              return (
                <div key={s.starts_at} className={`rounded-xl border px-2 py-2 text-center ${cls}`}>
                  <div className="text-sm font-semibold">{fmtTime(s.starts_at)}</div>
                  <div className="text-[10px] truncate opacity-80">
                    {s.available ? 'livre' : s.reason === 'bloqueado' ? 'bloqueado' : s.reason === 'muito_em_cima' ? '—' : 'ocupado'}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-[#d4d4d8]/40">
            O dia começa todo livre e vai sendo ocupado conforme os atendimentos são marcados — pelo cliente no WhatsApp ou por você aqui.
          </p>
        </section>
      )}

      {blocks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-yellow-400" /> Horários bloqueados
          </h2>
          {blocks.map((b) => (
            <div key={b.id} className="bg-[#161618] rounded-xl border border-white/5 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-white">
                  {fmtTime(b.starts_at)} – {fmtTime(b.ends_at)}
                </p>
                <p className="text-xs text-[#d4d4d8]/50 truncate">
                  {b.reason ?? 'Sem motivo registrado'}
                  <span className="text-[#d4d4d8]/30"> · só você vê isto</span>
                </p>
              </div>
              <button onClick={() => unblock(b.id)} className="shrink-0 flex items-center gap-1.5 text-sm text-[#d4d4d8]/70 hover:text-white bg-[#232327] px-3 py-1.5 rounded-lg transition-colors">
                <Unlock className="w-3.5 h-3.5" /> Liberar
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Atendimentos de {dateKeyToBr(date)}</h2>
        {appointments.length === 0 ? (
          <p className="text-sm text-[#d4d4d8]/40 py-4">Nenhum atendimento marcado neste dia.</p>
        ) : (
          appointments.map((a) => {
            const st = STATUS_CONFIG[a.status] ?? { label: a.status, className: 'bg-white/10 text-[#d4d4d8]' }
            const ativo = a.status === 'agendado' || a.status === 'remarcado'
            return (
              <div key={a.id} className="bg-[#161618] rounded-2xl border border-white/5 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setDetail(a)} className="min-w-0 text-left">
                    <div className="flex items-center gap-2 text-white font-semibold">
                      <Clock className="w-4 h-4 text-[#e0211a] shrink-0" />
                      {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}
                    </div>
                    <p className="text-sm text-white mt-1 truncate">{a.service_label}</p>
                  </button>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.className}`}>{st.label}</span>
                </div>
                <a href={whatsappLink(a.customer_phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[#d4d4d8]/70 hover:text-white transition-colors">
                  <User className="w-3.5 h-3.5" />
                  {a.customer_name}
                  <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                </a>
                {a.notes && <p className="text-sm text-[#d4d4d8]/60 border-t border-white/5 pt-2">{a.notes}</p>}
                {ativo && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                    <button
                      onClick={() => completeAppt(a.id)}
                      className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 bg-green-500/10 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Concluir
                    </button>
                    <button onClick={() => setRescheduling(a)} className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors">
                      <CalendarClock className="w-3.5 h-3.5" /> Remarcar
                    </button>
                    <button onClick={() => setCancelling(a)} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors">
                      <X className="w-3.5 h-3.5" /> Cancelar
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>

      {blocking && (
        <BlockDialog
          date={date}
          onClose={() => setBlocking(false)}
          onDone={() => {
            setBlocking(false)
            load()
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          appt={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null)
            load()
          }}
        />
      )}
      {rescheduling && (
        <RescheduleDialog
          appt={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            setRescheduling(null)
            load()
          }}
        />
      )}
      {detail && <DetailDialog appointment={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
