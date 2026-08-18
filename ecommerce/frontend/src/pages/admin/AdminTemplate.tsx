import { useEffect, useState } from 'react'
import { Clock, Loader2, MessageSquareText, Save } from 'lucide-react'
import Card from '../../components/ui/Card'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { MessageTemplate } from '../../types'

const LATE_KEY = 'agendamento_atraso'

const PLACEHOLDERS = [
  { tag: '{cliente}', desc: 'nome do cliente' },
  { tag: '{loja}', desc: 'nome da sua loja' },
  { tag: '{data}', desc: 'data marcada (ex: 19/08)' },
  { tag: '{hora}', desc: 'hora marcada (ex: 14:00)' },
  { tag: '{motivo}', desc: 'motivo do agendamento' },
]

/** Textos das mensagens automáticas que a loja dispara sozinha no WhatsApp do cliente. */
export default function AdminTemplate() {
  const [template, setTemplate] = useState<MessageTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminService.messageTemplates
      .list()
      .then((list) => setTemplate(list.find((t) => t.template_key === LATE_KEY) ?? null))
      .catch(() => setError('Não foi possível carregar os templates.'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    if (!template) return
    setSaving(true)
    setError(null)
    try {
      const updated = await adminService.messageTemplates.save(LATE_KEY, {
        body: template.body,
        enabled: template.enabled,
        trigger_delay_minutes: template.trigger_delay_minutes,
      })
      setTemplate(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
      </div>
    )
  }
  if (!template) {
    return <Card className="p-6 text-sm text-son-silver-dim">{error ?? 'Não foi possível carregar.'}</Card>
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-black flex items-center gap-2">
          <MessageSquareText className="w-5 h-5" /> Mensagens automáticas
        </h1>
        <p className="text-sm text-son-silver-dim mt-1">
          Textos que a loja envia sozinha no WhatsApp do cliente, sem ninguém precisar digitar.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" /> Disparo por atraso (agendamento)
            </h2>
            <p className="text-xs text-son-silver-dim mt-1">
              Se o cliente marcou um horário e não apareceu, manda uma mensagem perguntando se ele está a caminho ou
              quer remarcar.
            </p>
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={template.enabled}
              onChange={(e) => setTemplate({ ...template, enabled: e.target.checked })}
            />
            <span className="text-xs text-son-silver-dim">{template.enabled ? 'Ativo' : 'Desativado'}</span>
          </label>
        </div>

        <div>
          <label className="label">Tolerância de atraso</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1440}
              className="input-field w-28"
              value={template.trigger_delay_minutes}
              onChange={(e) => setTemplate({ ...template, trigger_delay_minutes: Number(e.target.value) || 15 })}
            />
            <span className="text-xs text-son-silver-dim">minutos depois do horário marcado</span>
          </div>
          <p className="text-[11px] text-son-silver-dim mt-1">
            Quanto tempo esperar antes de cobrar o cliente. Ex: 15 = se o horário era 14:00, a mensagem sai às 14:15
            caso ele não tenha chegado.
          </p>
        </div>

        <div>
          <label className="label">Texto da mensagem</label>
          <textarea
            className="input-field min-h-28"
            value={template.body}
            onChange={(e) => setTemplate({ ...template, body: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <button
                key={p.tag}
                type="button"
                title={`Inserir ${p.desc}`}
                onClick={() => setTemplate({ ...template, body: `${template.body}${p.tag}` })}
                className="text-[11px] px-2 py-1 rounded-lg border border-white/10 hover:bg-white/5 font-mono"
              >
                {p.tag}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-son-silver-dim mt-1.5">
            Clique numa etiqueta pra inserir — ela é trocada pelo dado real do agendamento na hora do envio.
          </p>
        </div>

        {error && <p className="error-msg">{error}</p>}
        <button type="button" onClick={save} disabled={saving} className="btn-primary w-full py-3">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? 'Salvo!' : 'Salvar'}
        </button>
      </Card>
    </div>
  )
}
