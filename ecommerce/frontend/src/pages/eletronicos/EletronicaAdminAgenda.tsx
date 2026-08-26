import { useEffect, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'
import type { AppointmentDto } from '../../lib/eletronicosApi'

export default function EletronicaAdminAgenda() {
  const [items, setItems] = useState<AppointmentDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const [serviceLabel, setServiceLabel] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  async function load() {
    try {
      setItems(await eletronicosAdmin.appointments.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate() {
    setError(null)
    setCreating(true)
    try {
      await eletronicosAdmin.appointments.create({
        service_label: serviceLabel.trim(),
        customer_name: customerName.trim(),
        customer_phone: customerPhone.replace(/\D/g, ''),
        date,
        time,
      })
      setServiceLabel('')
      setCustomerName('')
      setCustomerPhone('')
      setDate('')
      setTime('')
      setFormOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao agendar')
    } finally {
      setCreating(false)
    }
  }

  async function handleCancel(id: string) {
    try {
      await eletronicosAdmin.appointments.cancel(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao cancelar')
    }
  }

  if (!items) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    )
  }

  const upcoming = items
    .filter((a) => a.status === 'agendado')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Agenda</h1>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="flex items-center gap-1 rounded-lg bg-emerald-500 text-slate-950 text-sm font-semibold px-3 py-1.5"
        >
          <Plus className="w-4 h-4" /> Novo agendamento
        </button>
      </div>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="space-y-2">
        {upcoming.map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{a.service_label}</p>
              <p className="text-xs text-slate-500">
                {a.customer_name} · {new Date(a.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
              {a.notes && <p className="text-xs text-slate-600 mt-1">{a.notes}</p>}
            </div>
            <button type="button" onClick={() => handleCancel(a.id)} className="text-xs text-red-400 hover:underline shrink-0">
              Cancelar
            </button>
          </div>
        ))}
        {upcoming.length === 0 && <p className="text-sm text-slate-500">Nenhum agendamento futuro.</p>}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold">Novo agendamento</p>
              <button type="button" onClick={() => setFormOpen(false)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                value={serviceLabel}
                onChange={(e) => setServiceLabel(e.target.value)}
                placeholder="Serviço (ex: coleta iPhone 12)"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nome do cliente"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Telefone"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                disabled={creating || !serviceLabel.trim() || !customerName.trim() || !date || !time}
                onClick={handleCreate}
                className="w-full rounded-xl bg-emerald-500 disabled:bg-slate-800 text-slate-950 font-semibold py-2.5"
              >
                Agendar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
