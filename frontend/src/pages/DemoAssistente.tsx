import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, RotateCcw, Send, Settings2, ShoppingBag, Smartphone } from 'lucide-react'
import {
  fetchDemoConfig,
  getOrCreateSessionId,
  getPromptOverride,
  resetPromptOverride,
  sendDemoMessage,
  setPromptOverride,
  type DemoChatMessage,
  type DemoConfig,
  type DemoKind,
} from '../lib/demoAssistant'

const KIND_META: Record<DemoKind, { label: string; icon: typeof ShoppingBag }> = {
  ecommerce: { label: 'Assistente de IA — Ecommerce', icon: ShoppingBag },
  eletronicos: { label: 'Assistente de IA — Eletrônicos', icon: Smartphone },
}

/**
 * Chat de demonstração, mesma SPA (rota client-side, nunca nova aba) — IA
 * real, fonte de dados mockada fixa. Prompt customizável é 100%
 * client-side (sessionStorage): nunca chega a afetar outro visitante nem o
 * prompt de produção. Ver lib/demoAssistant.ts.
 */
export default function DemoAssistente() {
  const { kind: kindParam } = useParams<{ kind: string }>()
  const kind: DemoKind | null = kindParam === 'ecommerce' || kindParam === 'eletronicos' ? kindParam : null

  const [config, setConfig] = useState<DemoConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [messages, setMessages] = useState<DemoChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!kind) return
    getOrCreateSessionId()
    fetchDemoConfig(kind)
      .then((cfg) => {
        setConfig(cfg)
        setPromptDraft(getPromptOverride(kind) ?? cfg.default_system_prompt)
      })
      .catch((e) => setConfigError(e instanceof Error ? e.message : 'Erro ao carregar a demonstração.'))
  }, [kind])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  if (!kind) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <p className="text-lg font-bold mb-2">Demonstração não encontrada.</p>
          <Link to="/" className="btn-primary px-5 py-2.5 text-sm inline-flex mt-2">Voltar ao início</Link>
        </div>
      </main>
    )
  }

  const meta = KIND_META[kind]

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSendError(null)
    setInput('')
    const nextMessages: DemoChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setSending(true)
    try {
      const res = await sendDemoMessage({
        kind,
        sessionId: getOrCreateSessionId(),
        message: text,
        history: messages,
        promptOverride: getPromptOverride(kind),
      })
      setMessages([...nextMessages, { role: 'assistant', content: res.reply }])
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Não foi possível enviar a mensagem.')
    } finally {
      setSending(false)
    }
  }

  const handleSavePrompt = () => {
    if (!kind) return
    setPromptOverride(kind, promptDraft.trim())
    setShowPromptEditor(false)
  }

  const handleResetPrompt = () => {
    if (!kind || !config) return
    resetPromptOverride(kind)
    setPromptDraft(config.default_system_prompt)
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-10 relative flex flex-col">
      <div className="uf-mesh" />
      <div className="uf-container flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-6">
          <Link to="/#assistentes-ia" className="inline-flex items-center gap-2 text-sm text-uf-silver-dim hover:text-uf-silver">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Link>
          <button
            type="button"
            onClick={() => setShowPromptEditor((v) => !v)}
            className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Personalizar prompt
          </button>
        </div>

        <div className="text-center mb-6">
          <span className="uf-eyebrow mb-3">
            <meta.icon className="w-3.5 h-3.5" />
            Demonstração
          </span>
          <h1 className="text-2xl sm:text-3xl font-black mt-3">{meta.label}</h1>
          <p className="text-sm text-uf-silver-dim mt-2 max-w-lg mx-auto">
            Dados fictícios de demonstração — a IA é real, mas nada aqui afeta uma loja de verdade.
          </p>
        </div>

        {showPromptEditor && (
          <div className="uf-glass rounded-2xl p-4 mb-4 space-y-3">
            <p className="text-xs text-uf-silver-dim">
              Muda só a sua sessão nesta aba — ninguém mais é afetado, e some ao fechar a aba.
            </p>
            <textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              rows={5}
              maxLength={4000}
              className="w-full px-3 py-2.5 rounded-xl bg-uf-black border border-white/10 text-sm text-uf-silver outline-none focus:border-white/30"
            />
            <div className="flex gap-2">
              <button type="button" onClick={handleSavePrompt} className="btn-primary px-4 py-2 text-xs">
                Salvar pra esta sessão
              </button>
              <button
                type="button"
                onClick={handleResetPrompt}
                className="btn-secondary px-4 py-2 text-xs inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Voltar configurações padrão
              </button>
            </div>
          </div>
        )}

        {configError && <p className="text-sm text-red-400 text-center">{configError}</p>}

        {config && (
          <div className="uf-glass rounded-2xl flex flex-col flex-1 min-h-[420px] overflow-hidden">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-sm text-uf-silver-dim py-8">
                  <p className="mb-3">Pergunte algo, ou tente:</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {config.sample_questions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setInput(q)}
                        className="uf-glass-hover rounded-full px-3 py-1.5 text-xs"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === 'user' ? 'uf-bg text-white' : 'bg-white/5 text-uf-silver'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white/5 rounded-2xl px-4 py-2.5 text-sm text-uf-silver-dim inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> digitando…
                  </div>
                </div>
              )}
            </div>

            {sendError && <p className="text-xs text-red-400 px-4 pb-1">{sendError}</p>}

            <div className="border-t border-white/10 p-3 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Escreva sua mensagem…"
                className="flex-1 px-4 py-2.5 rounded-xl bg-uf-black border border-white/10 text-sm text-uf-silver outline-none focus:border-white/30"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="btn-primary px-4 py-2.5 disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
