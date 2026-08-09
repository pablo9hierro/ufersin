import { useEffect, useState } from 'react'
import { Loader2, MessageCircle, Send } from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { ASSISTANT_IA_API_URL } from '../../lib/assistantIaBeta'

type Conversation = {
  id: string
  phone: string
  customer_name: string | null
  status: 'aberta' | 'pausada' | 'fechada'
  assistant_enabled: boolean
  human_override: boolean
  last_message_at: string
}

type Message = {
  id: string
  direction: 'inbound' | 'outbound'
  sender_type: 'cliente' | 'assistente' | 'humano'
  content: string
  created_at: string
}

function formatPhone(phone: string) {
  const digits = phone.replace(/^55/, '')
  if (digits.length < 10) return phone
  return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`
}

/** Inbox do Assistente IA (beta) — visível só pra loja no allowlist (ver assistantIaBeta.ts). */
export default function AdminChat() {
  const tenantConfig = useTenantConfig()
  const tenantSlug = tenantConfig?.slug
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [togglingAssistant, setTogglingAssistant] = useState(false)

  const base = tenantSlug ? `${ASSISTANT_IA_API_URL}/api/tenants/${tenantSlug}` : null

  const loadConversations = () => {
    if (!base) return
    fetch(`${base}/conversations`)
      .then((r) => r.json())
      .then((data) => setConversations(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingList(false))
  }

  useEffect(() => {
    loadConversations()
    const interval = setInterval(loadConversations, 3000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug])

  useEffect(() => {
    if (!selected || !base) return
    const loadMessages = (showSpinner: boolean) => {
      if (showSpinner) setLoadingMessages(true)
      fetch(`${base}/conversations/${selected.id}/messages`)
        .then((r) => r.json())
        .then((data) => setMessages(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => showSpinner && setLoadingMessages(false))
    }
    loadMessages(true)
    const interval = setInterval(() => loadMessages(false), 3000)
    return () => clearInterval(interval)
  }, [selected, base])

  const toggleAssistant = async (enabled: boolean) => {
    if (!selected || !base) return
    setTogglingAssistant(true)
    try {
      const res = await fetch(`${base}/conversations/${selected.id}/assistant-enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const updated = await res.json()
      setSelected((s) => (s ? { ...s, assistant_enabled: updated.assistant_enabled, human_override: updated.human_override } : s))
      setConversations((cs) => cs.map((c) => (c.id === selected.id ? { ...c, ...updated } : c)))
    } finally {
      setTogglingAssistant(false)
    }
  }

  if (!tenantSlug) return null

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-screen -m-4 md:-m-6">
      <div className="w-full md:w-80 shrink-0 border-r border-white/5 bg-son-black overflow-y-auto">
        <div className="p-4 border-b border-white/5 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-son-pink" />
          <h1 className="font-bold text-sm">Chat — Assistente IA (beta)</h1>
        </div>
        {loadingList ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-xs text-son-silver-dim text-center py-8 px-4">
            Nenhuma conversa ainda. Assim que um cliente mandar mensagem no WhatsApp da loja, ela aparece aqui.
          </p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                selected?.id === c.id ? 'bg-white/5' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{c.customer_name || formatPhone(c.phone)}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                    c.status === 'aberta'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : c.status === 'pausada'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-white/10 text-son-silver-dim'
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <p className="text-xs text-son-silver-dim mt-0.5">
                {c.human_override ? 'Atendimento humano' : c.assistant_enabled ? 'IA respondendo' : 'IA pausada'}
              </p>
            </button>
          ))
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-son-silver-dim text-sm">
            Selecione uma conversa
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">{selected.customer_name || formatPhone(selected.phone)}</p>
                <p className="text-xs text-son-silver-dim">{formatPhone(selected.phone)}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-son-silver-dim cursor-pointer">
                <input
                  type="checkbox"
                  checked={!selected.assistant_enabled}
                  disabled={togglingAssistant}
                  onChange={(e) => toggleAssistant(!e.target.checked)}
                  className="w-4 h-4"
                />
                Interromper Assistente IA
              </label>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMessages ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.direction === 'inbound'
                          ? 'bg-son-surface text-son-silver'
                          : m.sender_type === 'humano'
                            ? 'bg-blue-500/80 text-white'
                            : 'sunset-bg text-white'
                      }`}
                    >
                      {m.sender_type !== 'cliente' && (
                        <p className="text-[10px] opacity-70 mb-0.5">{m.sender_type === 'assistente' ? 'Assistente IA' : 'Você'}</p>
                      )}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-white/5 flex items-center gap-2 text-xs text-son-silver-dim">
              <Send className="w-3.5 h-3.5" />
              Resposta manual direto por aqui ainda não está disponível nesta beta — use o WhatsApp da loja enquanto o assistente estiver interrompido.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
