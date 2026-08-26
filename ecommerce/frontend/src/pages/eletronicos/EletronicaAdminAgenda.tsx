import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CalendarDays, CheckCircle2, Clock, Lock, Loader2, MessageCircle, Plus, Unlock, User, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { AppointmentDto } from '../../lib/eletronicosApi'

// Port 1:1 (parcial, gaps disclosed abaixo) de
// src/app/dashboard/agenda/AgendaClient.tsx do vrtech -- grade de
// disponibilidade do dia (livre/ocupado/bloqueado/muito em cima), seletor
// de dia (dropdown + Hoje/Amanhã), lista de atendimentos do dia com
// "Concluir"/"Cancelar", dialog "Indisponibilizar horário" com lista de
// bloqueios + liberar.
// Gaps disclosed: remarcar agendamento (com justificativa+aviso
// customizado por WhatsApp) e o dialog de detalhe com histórico de eventos
// não foram portados -- endpoints reschedule/appointment-events desse
// motor ainda não existem. Cancelar aqui segue simples (sem justificativa
// obrigatória de 30 chars), mesmo mecanismo que já funcionava.

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

export default function EletronicaAdminAgenda() {
  const [date, setDate] = useState(todayKey())
  const [slots, setSlots] = useState<DaySlot[] | null>(null)
  const [appointments, setAppointments] = useState<AppointmentDto[]>([])
  const [blocks, setBlocks] = useState<AgendaBlock[]>([])
  const [error, setError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(false)

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

  const cancelAppt = async (id: string) => {
    try {
      await eletronicosAdmin.appointments.cancel(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao cancelar.')
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
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-white font-semibold">
                      <Clock className="w-4 h-4 text-[#e0211a] shrink-0" />
                      {fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}
                    </div>
                    <p className="text-sm text-white mt-1 truncate">{a.service_label}</p>
                    <a href={whatsappLink(a.customer_phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[#d4d4d8]/70 hover:text-white mt-1 transition-colors">
                      <User className="w-3.5 h-3.5" />
                      {a.customer_name}
                      <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                    </a>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.className}`}>{st.label}</span>
                </div>
                {a.notes && <p className="text-sm text-[#d4d4d8]/60 border-t border-white/5 pt-2">{a.notes}</p>}
                {ativo && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                    <button
                      onClick={() => completeAppt(a.id)}
                      className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 bg-green-500/10 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Concluir
                    </button>
                    <button onClick={() => cancelAppt(a.id)} className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors">
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
    </div>
  )
}
