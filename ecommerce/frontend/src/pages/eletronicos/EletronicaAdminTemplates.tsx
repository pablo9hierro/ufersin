import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { eletronicosAdmin } from '../../lib/eletronicosAdminApi'

type Template = {
  id: string
  template_key: string
  section: string
  label: string
  description: string | null
  content: string
  required_variables: string[]
  editable: boolean
  enabled: boolean
}

export default function EletronicaAdminTemplates() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    try {
      const rows = await eletronicosAdmin.templates.list()
      setTemplates(rows)
      setDrafts(Object.fromEntries(rows.map((t) => [t.template_key, t.content])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave(t: Template) {
    setSaving(t.template_key)
    setError(null)
    try {
      await eletronicosAdmin.templates.updateContent(t.template_key, drafts[t.template_key] ?? t.content)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao salvar')
    } finally {
      setSaving(null)
    }
  }

  async function handleToggle(t: Template) {
    try {
      await eletronicosAdmin.templates.toggle(t.template_key, !t.enabled)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao atualizar')
    }
  }

  if (!templates) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    )
  }

  const sections = Array.from(new Set(templates.map((t) => t.section)))

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-5">Mensagens automáticas (WhatsApp)</h1>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {sections.map((section) => (
        <div key={section} className="mb-6">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">{section}</p>
          <div className="space-y-3">
            {templates
              .filter((t) => t.section === section)
              .map((t) => (
                <div key={t.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold">{t.label}</p>
                      {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle(t)}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        t.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {t.enabled ? 'Ativo' : 'Desativado'}
                    </button>
                  </div>
                  {t.editable ? (
                    <>
                      <textarea
                        value={drafts[t.template_key] ?? t.content}
                        onChange={(e) => setDrafts((d) => ({ ...d, [t.template_key]: e.target.value }))}
                        rows={4}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500 resize-none"
                      />
                      {t.required_variables.length > 0 && (
                        <p className="text-[11px] text-slate-600 mt-1">
                          obrigatórias: {t.required_variables.map((v) => `/${v}`).join(', ')}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={saving === t.template_key}
                        onClick={() => handleSave(t)}
                        className="mt-2 rounded-lg bg-emerald-500 disabled:bg-slate-800 text-slate-950 text-xs font-semibold px-4 py-1.5"
                      >
                        Salvar
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500 italic">{t.content} (gerado pelo sistema, não editável)</p>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
