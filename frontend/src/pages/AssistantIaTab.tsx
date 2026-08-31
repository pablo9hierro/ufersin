import { useEffect, useState } from 'react'
import { Loader2, Save, Bot } from 'lucide-react'
import { api } from '../lib/api'

type AssistantConfig = {
  tenant_id: string
  enabled: boolean
  prompt_interpreter: string
  start_keywords: string[]
  end_keywords: string[]
  window_timeout_minutes: number
  message_batch_window_seconds: number
  min_response_chars: number
  max_response_chars: number
}

/** Aba "Assistente IA" em /meu-plano — só visível pro tenant no beta (ver assistantIaBeta.ts). */
export default function AssistantIaTab({ tenantSlug }: { tenantSlug: string }) {
  const [config, setConfig] = useState<AssistantConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .assistantIaConfig()
      .then((cfg) => {
        if (cancelled) return
        // O proxy repassa o corpo do assistant-ia mesmo quando ele responde
        // erro (ex: acesso negado, serviço fora do ar) -- sem essa checagem,
        // um objeto tipo {error: "..."} vira "config" e quebra o formulário
        // (start_keywords/end_keywords indefinidos).
        const isValidConfig =
          cfg && typeof cfg === 'object' &&
          Array.isArray((cfg as Partial<AssistantConfig>).start_keywords) &&
          Array.isArray((cfg as Partial<AssistantConfig>).end_keywords)
        if (!isValidConfig) {
          setError('Não foi possível carregar a configuração do assistente agora. Tente novamente em instantes.')
          return
        }
        setConfig(cfg as AssistantConfig)
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
      await api.assistantIaSaveConfig(config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Não foi possível salvar. Tenta de novo em instantes.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="uf-glass rounded-2xl p-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-uf-silver-dim" />
      </div>
    )
  }
  if (!config) {
    return <p className="text-sm text-uf-silver-dim uf-glass rounded-2xl p-5">{error ?? 'Não foi possível carregar.'}</p>
  }

  return (
    <div className="space-y-6">
      <div className="uf-glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-uf-accent" />
          <h2 className="font-bold text-sm uppercase tracking-wide text-uf-silver-dim">Assistente IA (beta)</h2>
        </div>
        <p className="text-xs text-uf-silver-dim">
          Responde clientes automaticamente no WhatsApp da loja, usando 2 camadas de IA (interpretação + atendimento
          com ferramentas) e os exemplos de atendimento abaixo pra aprender seu tom de voz. Desativado por padrão até
          você configurar e testar.
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
          <label className="label">Sobre a loja (informações, nunca comportamento)</label>
          <textarea
            className="input-field min-h-24"
            value={config.prompt_interpreter}
            onChange={(e) => setConfig({ ...config, prompt_interpreter: e.target.value })}
            placeholder="Ex: Somos a Loja X, vendemos Y. Entregamos em Z. Funcionamos das 9h às 18h."
          />
          <p className="text-[10px] text-uf-silver-dim mt-1">
            Só informações sobre a loja (o que vende, entrega, horário etc.) — o fluxo de atendimento, checkout e
            regras de segurança são fixos da plataforma e não mudam por aqui.
          </p>
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

    </div>
  )
}
