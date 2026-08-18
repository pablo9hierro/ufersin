import { useEffect, useState } from 'react'
import { Calendar, Loader2, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { adminService } from '../../services/adminService'
import type { Appointment } from '../../types'

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABEL: Record<Appointment['status'], string> = {
  agendado: 'Agendado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
}

/** Agendamentos marcados por clientes via Assistente IA (agendar_horario/desmarcar_horario/editar_horario) — leitura + cancelamento manual aqui, criação/edição real fica com o cliente/IA. */
export default function AdminAgendamentos() {
  const { askConfirm, confirmDialogElement } = useConfirmDialog()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    adminService.appointments.list().then(setAppointments).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleCancel = (a: Appointment) => {
    askConfirm(`Cancelar agendamento de ${a.customer_name || a.customer_phone} — ${formatDateTime(a.scheduled_at)}?`, async () => {
      setBusyId(a.id)
      try {
        await adminService.appointments.cancel(a.id)
        load()
      } finally {
        setBusyId(null)
      }
    })
  }

  const ativos = appointments.filter((a) => a.status === 'agendado')
  const outros = appointments.filter((a) => a.status !== 'agendado')

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-black flex items-center gap-2">
          <Calendar className="w-5 h-5" /> Agendamentos
        </h1>
        <p className="text-sm text-son-silver-dim mt-1">
          Horários marcados por clientes pela Assistente IA (WhatsApp) — criação e remarcação acontecem direto na
          conversa; aqui você só acompanha e pode cancelar.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
        </div>
      ) : appointments.length === 0 ? (
        <Card className="p-6 text-sm text-son-silver-dim text-center">Nenhum agendamento ainda.</Card>
      ) : (
        <div className="space-y-6">
          {ativos.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs uppercase tracking-wide text-son-silver-dim font-bold">Ativos</h2>
              {ativos.map((a) => (
                <Card key={a.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{a.customer_name || a.customer_phone}</p>
                    <p className="text-xs text-son-silver-dim truncate">
                      {formatDateTime(a.scheduled_at)} · {a.customer_phone}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => handleCancel(a)}
                    className="shrink-0 p-2 rounded-lg hover:bg-red-500/10 text-red-400/80 hover:text-red-400"
                    aria-label="Cancelar agendamento"
                  >
                    {busyId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  </button>
                </Card>
              ))}
            </div>
          )}

          {outros.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs uppercase tracking-wide text-son-silver-dim font-bold">Histórico</h2>
              {outros.map((a) => (
                <Card key={a.id} className="p-4 flex items-center justify-between gap-3 opacity-60">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{a.customer_name || a.customer_phone}</p>
                    <p className="text-xs text-son-silver-dim truncate">
                      {formatDateTime(a.scheduled_at)} · {a.customer_phone}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 shrink-0">{STATUS_LABEL[a.status]}</span>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmDialogElement}
    </div>
  )
}
