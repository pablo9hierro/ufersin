import { useEffect, useRef, useState } from 'react'
import { Loader2, Save, Upload, Trash2, Bot } from 'lucide-react'
import { ASSISTANT_IA_API_URL } from '../lib/assistantIaBeta'

type AssistantConfig = {
  tenant_id: string
  enabled: boolean
  prompt_interpreter: string
  prompt_validator: string
  start_keywords: string[]
  end_keywords: string[]
  window_timeout_minutes: number
  message_batch_window_seconds: number
  min_response_chars: number
  max_response_chars: number
  anthropic_api_key: string | null
  ai_provider: 'anthropic' | 'openrouter'
  ai_model: string | null
}

type RagDocument = {
  id: string
  filename: string
  status: 'processando' | 'pronto' | 'erro'
  error_message: string | null
  created_at: string
}

/** Aba "Assistente IA" em /meu-plano — só visível pro tenant no beta (ver assistantIaBeta.ts). */
export default function AssistantIaTab({ tenantSlug }: { tenantSlug: string }) {
  const [config, setConfig] = useState<AssistantConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const base = `${ASSISTANT_IA_API_URL}/api/tenants/${tenantSlug}`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${base}/config`).then((r) => r.json()),
      fetch(`${base}/rag/documents`).then((r) => r.json()),
    ])
      .then(([cfg, docs]) => {
        if (cancelled) return
        setConfig(cfg)
        setDocuments(Array.isArray(docs) ? docs : [])
      })
      .catch(() => !cancelled && setError('Não foi possível carregar a configuração do assistente.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${base}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Não foi possível salvar. Tenta de novo em instantes.')
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${base}/rag/documents`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error()
      const docs = await fetch(`${base}/rag/documents`).then((r) => r.json())
      setDocuments(Array.isArray(docs) ? docs : [])
    } catch {
      setError('Falha ao processar o arquivo. Tenta outro formato ou de novo.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteDoc = async (id: string) => {
    setDocuments((docs) => docs.filter((d) => d.id !== id))
    await fetch(`${base}/rag/documents/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  if (loading) {
    return (
      <div className="uf-glass rounded-2xl p-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-uf-silver-dim" />
      </div>
    )
  }
  if (!config) {
    return <p className="text-sm text-uf-silver-dim uf-glass rounded-2xl p-5">Não foi possível carregar.</p>
  }

  return (
    <div className="space-y-6">
      <div className="uf-glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-uf-accent" />
          <h2 className="font-bold text-sm uppercase tracking-wide text-uf-silver-dim">Assistente IA (beta)</h2>
        </div>
        <p className="text-xs text-uf-silver-dim">
          Responde clientes automaticamente no WhatsApp da loja, usando 3 camadas de IA (interpretação, validação e
          contexto) + a base de conhecimento abaixo. Desativado por padrão até você configurar e testar.
        </p>

        <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="w-4 h-4 mt-0.5"
          />
          <span className="text-xs text-uf-silver-dim">
            <span className="block text-uf-silver font-semibold mb-0.5">Ativar Assistente IA</span>
            Quando desativado, mensagens continuam chegando e ficam salvas — só a resposta automática fica suspensa.
          </span>
        </label>

        <div>
          <label className="label">Prompt da 1ª camada (interpretação de intenção)</label>
          <textarea
            className="input-field min-h-24"
            value={config.prompt_interpreter}
            onChange={(e) => setConfig({ ...config, prompt_interpreter: e.target.value })}
            placeholder="Ex: você é o assistente da loja X, vende Y, o tom é..."
          />
        </div>
        <div>
          <label className="label">Prompt da 2ª camada (atendimento, ferramentas e resposta final)</label>
          <textarea
            className="input-field min-h-20"
            value={config.prompt_validator}
            onChange={(e) => setConfig({ ...config, prompt_validator: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Gatilhos de início (separados por vírgula)</label>
            <input
              className="input-field"
              value={config.start_keywords.join(', ')}
              onChange={(e) => setConfig({ ...config, start_keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </div>
          <div>
            <label className="label">Gatilhos de encerramento</label>
            <input
              className="input-field"
              value={config.end_keywords.join(', ')}
              onChange={(e) => setConfig({ ...config, end_keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </div>
        </div>
        <div>
          <label className="label">Encerrar janela após quantos minutos sem mensagem</label>
          <input
            type="number"
            min={1}
            className="input-field max-w-40"
            value={config.window_timeout_minutes}
            onChange={(e) => setConfig({ ...config, window_timeout_minutes: Number(e.target.value) || 30 })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Motor de IA</label>
            <select
              className="input-field"
              value={config.ai_provider}
              onChange={(e) => setConfig({ ...config, ai_provider: e.target.value as 'anthropic' | 'openrouter' })}
            >
              <option value="anthropic">Anthropic (Claude direto)</option>
              <option value="openrouter">OpenRouter (vários modelos)</option>
            </select>
          </div>
          {config.ai_provider === 'openrouter' && (
            <div>
              <label className="label">Modelo (OpenRouter)</label>
              <input
                className="input-field"
                placeholder="Ex: anthropic/claude-3.5-sonnet"
                value={config.ai_model ?? ''}
                onChange={(e) => setConfig({ ...config, ai_model: e.target.value })}
              />
            </div>
          )}
        </div>
        <div>
          <label className="label">
            Chave da API do motor de IA {config.ai_provider === 'anthropic' ? '(opcional)' : ''}
          </label>
          <input
            type="password"
            className="input-field"
            placeholder={
              config.ai_provider === 'anthropic'
                ? 'Deixe vazio pra usar a chave padrão da plataforma'
                : 'Chave da sua conta OpenRouter (openrouter.ai/keys)'
            }
            value={config.anthropic_api_key ?? ''}
            onChange={(e) => setConfig({ ...config, anthropic_api_key: e.target.value })}
          />
          <p className="text-[10px] text-uf-silver-dim mt-1">
            {config.ai_provider === 'anthropic'
              ? 'Troque aqui se o crédito da chave padrão da plataforma acabar — sua própria chave da Anthropic (console.anthropic.com) passa a ser usada só nessa loja.'
              : 'Obrigatória pra usar OpenRouter — gere em openrouter.ai/keys.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Esperar quantos segundos pra agrupar mensagens em sequência</label>
            <input
              type="number"
              min={1}
              max={60}
              className="input-field"
              value={config.message_batch_window_seconds}
              onChange={(e) => setConfig({ ...config, message_batch_window_seconds: Number(e.target.value) || 8 })}
            />
            <p className="text-[10px] text-uf-silver-dim mt-1">
              Se o cliente mandar várias mensagens seguidas, a IA espera esse tempo antes de responder, junta tudo numa
              interpretação só.
            </p>
          </div>
          <div>
            <label className="label">Tamanho mínimo da resposta (caracteres)</label>
            <input
              type="number"
              min={20}
              className="input-field"
              value={config.min_response_chars}
              onChange={(e) => setConfig({ ...config, min_response_chars: Number(e.target.value) || 150 })}
            />
          </div>
          <div>
            <label className="label">Tamanho máximo da resposta (caracteres)</label>
            <input
              type="number"
              min={20}
              className="input-field"
              value={config.max_response_chars}
              onChange={(e) => setConfig({ ...config, max_response_chars: Number(e.target.value) || 300 })}
            />
          </div>
        </div>

        {error && <p className="error-msg">{error}</p>}
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary w-full py-3">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? 'Salvo!' : 'Salvar configuração'}
        </button>
      </div>

      <div className="uf-glass rounded-2xl p-6 space-y-4">
        <h2 className="font-bold text-sm uppercase tracking-wide text-uf-silver-dim">Base de conhecimento (RAG)</h2>
        <p className="text-xs text-uf-silver-dim">
          Envie PDFs, TXT, DOCX ou conversas exportadas — o assistente consulta esse material antes de responder.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.docx,.csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-secondary w-full py-3"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Enviar arquivo
        </button>

        {documents.length === 0 ? (
          <p className="text-xs text-uf-silver-dim text-center py-4">Nenhum arquivo enviado ainda.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between uf-glass rounded-xl px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-uf-silver">{doc.filename}</p>
                  <p className="text-xs text-uf-silver-dim">
                    {doc.status === 'processando' ? 'Processando…' : doc.status === 'erro' ? `Erro: ${doc.error_message}` : 'Pronto'}
                  </p>
                </div>
                <button type="button" onClick={() => handleDeleteDoc(doc.id)} className="text-uf-silver-dim hover:text-red-400 shrink-0 ml-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
