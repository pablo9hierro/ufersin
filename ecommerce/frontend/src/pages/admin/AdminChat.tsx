import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Plus, Send, Trash2 } from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { api } from '../../lib/api'

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

// Prefixo "5500" nunca corresponde a um DDD brasileiro real (DDD 00 não
// existe) — garante que uma conversa de teste simulada nunca colida com/
// personifique a conversa de um cliente de verdade, mesmo por acidente.
function generateSyntheticPhone(): string {
  const digits = Math.floor(100000000 + Math.random() * 900000000)
  return `5500${digits}`
}

function friendlySimulateError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
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
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatName, setNewChatName] = useState('')
  const [newChatMessage, setNewChatMessage] = useState('')
  const [sendingNewChat, setSendingNewChat] = useState(false)
  const [messageDraft, setMessageDraft] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Ref (não state) de propósito: lido dentro do polling de `loadConversations`,
  // que é registrado uma única vez no useEffect abaixo (deps []) — um state
  // aqui ficaria "congelado" no valor de quando o efeito rodou.
  const pendingPhoneRef = useRef<string | null>(null)

  const loadConversations = () => {
    if (!tenantSlug) return
    api.admin.assistantIa
      .conversations()
      .then((data) => {
        const list = Array.isArray(data) ? (data as Conversation[]) : []
        setConversations(list)
        if (pendingPhoneRef.current) {
          const match = list.find((c) => c.phone === pendingPhoneRef.current)
          if (match) {
            pendingPhoneRef.current = null
            setSendingNewChat(false)
            setSelected(match)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingList(false))
  }

  useEffect(() => {
    loadConversations()
    const interval = setInterval(loadConversations, 1500)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug])

  const selectedId = selected?.id ?? null

  const loadMessages = (showSpinner: boolean) => {
    if (!selectedId) return
    if (showSpinner) setLoadingMessages(true)
    api.admin.assistantIa
      .conversationMessages(selectedId)
      .then((data) => setMessages(Array.isArray(data) ? (data as Message[]) : []))
      .catch(() => {})
      .finally(() => showSpinner && setLoadingMessages(false))
  }

  // Depende só do id (não do objeto `selected` inteiro) — cada poll de
  // `loadConversations` cria objetos novos pra mesma conversa, e reagir à
  // referência reiniciaria o polling de mensagens sem necessidade a cada
  // 1.5s.
  useEffect(() => {
    if (!selectedId) return
    loadMessages(true)
    const interval = setInterval(() => loadMessages(false), 1500)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const toggleAssistant = async (enabled: boolean) => {
    if (!selected) return
    setTogglingAssistant(true)
    try {
      const updated = (await api.admin.assistantIa.setConversationEnabled(selected.id, enabled)) as {
        assistant_enabled: boolean
        human_override: boolean
      }
      setSelected((s) => (s ? { ...s, assistant_enabled: updated.assistant_enabled, human_override: updated.human_override } : s))
      setConversations((cs) => cs.map((c) => (c.id === selected.id ? { ...c, ...updated } : c)))
    } finally {
      setTogglingAssistant(false)
    }
  }

  const deleteConversation = async (c: Conversation) => {
    if (!window.confirm(`Apagar todo o histórico da conversa com ${c.customer_name || formatPhone(c.phone)}? Essa ação não pode ser desfeita.`)) return
    await api.admin.assistantIa.deleteConversation(c.id)
    setConversations((cs) => cs.filter((x) => x.id !== c.id))
    setSelected((s) => (s?.id === c.id ? null : s))
  }

  const openNewChat = () => {
    setNewChatOpen(true)
    setNewChatName('')
    setNewChatMessage('')
    setSendError(null)
  }

  const cancelNewChat = () => {
    setNewChatOpen(false)
    setNewChatName('')
    setNewChatMessage('')
  }

  // Injeta a mensagem no MESMO pipeline que uma mensagem real de WhatsApp
  // aciona (ver ecommerce/backend/src/routes/webhooks.rs::send_to_assistant_ia)
  // — só a origem muda (painel em vez do WhatsApp de verdade). O `phone`
  // sintético (nunca um DDD real) é como o assistant-ia identifica essa
  // conversa de teste como distinta de qualquer cliente real.
  const submitNewChat = async () => {
    const text = newChatMessage.trim()
    if (!text) return
    setSendingNewChat(true)
    setSendError(null)
    const phone = generateSyntheticPhone()
    try {
      await api.admin.assistantIa.simulateMessage(phone, text, newChatName.trim() || undefined)
      pendingPhoneRef.current = phone
      setNewChatOpen(false)
      setNewChatName('')
      setNewChatMessage('')
      // Não espera o próximo tick do polling (até 1.5s) — busca já, e o
      // polling normal cobre o resto caso a conversa ainda não exista no
      // instante exato desta chamada.
      loadConversations()
      // sendingNewChat só desliga quando loadConversations encontrar a
      // conversa de verdade (pendingPhoneRef) — evita mostrar "pronto" antes
      // dela realmente existir.
    } catch (err) {
      setSendError(friendlySimulateError(err, 'Não foi possível enviar a mensagem de teste.'))
      setSendingNewChat(false)
    }
  }

  const sendMessage = async () => {
    const text = messageDraft.trim()
    if (!text || !selected) return
    setSendingMessage(true)
    setSendError(null)
    try {
      await api.admin.assistantIa.simulateMessage(selected.phone, text, selected.customer_name || undefined)
      setMessageDraft('')
      // Mostra a própria mensagem na hora, sem esperar o próximo tick do
      // polling (até 1.5s) — a resposta da IA continua chegando via
      // polling normal assim que o assistant-ia terminar de processar.
      loadMessages(false)
    } catch (err) {
      setSendError(friendlySimulateError(err, 'Não foi possível enviar a mensagem.'))
    } finally {
      setSendingMessage(false)
    }
  }

  if (!tenantSlug) return null

  // Chat é componente genérico compartilhado por todos os verticais --
  // reveste com a identidade vrtech (preto/vermelho) quando o tenant é
  // eletrônica em vez do tema padrão da Resolutoo (verde/dourado), sem
  // afetar as demais lojas.
  const isEletronica = tenantConfig?.vertical === 'eletronicos'
  const t = {
    panelBg: isEletronica ? 'bg-[#0a0a0b]' : 'bg-son-black',
    accent: isEletronica ? 'text-[#e0211a]' : 'text-son-pink',
    accentHover: isEletronica ? 'hover:text-[#ff4d42]' : 'hover:text-son-pink/80',
    dim: isEletronica ? 'text-[#d4d4d8]/50' : 'text-son-silver-dim',
    bubbleIn: isEletronica ? 'bg-[#232327] text-[#d4d4d8]' : 'bg-son-surface text-son-silver',
    bubbleOut: isEletronica ? 'bg-[#e0211a] text-white' : 'sunset-bg text-white',
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-screen -m-4 md:-m-6">
      <div className={`w-full md:w-80 shrink-0 border-r border-white/5 ${t.panelBg} overflow-y-auto`}>
        <div className="p-4 border-b border-white/5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircle className={`w-4 h-4 ${t.accent}`} />
            <h1 className="font-bold text-sm">Chat — Assistente IA (beta)</h1>
          </div>
          <button
            type="button"
            onClick={openNewChat}
            title="Simular uma conversa de cliente novo, testando a IA sem precisar de outro WhatsApp"
            className={`flex items-center gap-1 text-xs ${t.accent} ${t.accentHover} transition-colors shrink-0`}
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Chat
          </button>
        </div>
        {newChatOpen && (
          <div className="p-4 border-b border-white/5 space-y-2 bg-white/5">
            <input
              type="text"
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              placeholder="Nome do cliente de teste (opcional)"
              className="input-field w-full text-sm"
            />
            <textarea
              value={newChatMessage}
              onChange={(e) => setNewChatMessage(e.target.value)}
              placeholder="Primeira mensagem, como se fosse o cliente escrevendo..."
              rows={2}
              className="input-field w-full text-sm resize-none"
            />
            {sendError && <p className="error-msg">{sendError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitNewChat}
                disabled={sendingNewChat || !newChatMessage.trim()}
                className="btn-primary flex-1 text-xs py-1.5"
              >
                {sendingNewChat ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Enviar'}
              </button>
              <button type="button" onClick={cancelNewChat} disabled={sendingNewChat} className="btn-secondary flex-1 text-xs py-1.5">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {loadingList ? (
          <div className="flex justify-center py-8">
            <Loader2 className={`w-5 h-5 animate-spin ${t.dim}`} />
          </div>
        ) : conversations.length === 0 ? (
          <p className={`text-xs ${t.dim} text-center py-8 px-4`}>
            Nenhuma conversa ainda. Assim que um cliente mandar mensagem no WhatsApp da loja, ela aparece aqui.
          </p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(c)}
              onKeyDown={(e) => e.key === 'Enter' && setSelected(c)}
              className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group relative ${
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
                        : `bg-white/10 ${t.dim}`
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <p className={`text-xs ${t.dim} mt-0.5 pr-6`}>
                {c.human_override ? 'Atendimento humano' : c.assistant_enabled ? 'IA respondendo' : 'IA pausada'}
              </p>
              <button
                type="button"
                title="Apagar histórico dessa conversa"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteConversation(c)
                }}
                className={`absolute right-3 bottom-2.5 ${t.dim} ${t.accentHover} opacity-0 group-hover:opacity-100 transition-opacity`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className={`flex-1 flex items-center justify-center ${t.dim} text-sm`}>
            Selecione uma conversa
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">{selected.customer_name || formatPhone(selected.phone)}</p>
                <p className={`text-xs ${t.dim}`}>{formatPhone(selected.phone)}</p>
              </div>
              <label className={`flex items-center gap-2 text-xs ${t.dim} cursor-pointer`}>
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
                  <Loader2 className={`w-5 h-5 animate-spin ${t.dim}`} />
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.direction === 'inbound'
                          ? t.bubbleIn
                          : m.sender_type === 'humano'
                            ? 'bg-blue-500/80 text-white'
                            : t.bubbleOut
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
            <div className="p-3 border-t border-white/5 space-y-2">
              {sendError && <p className="error-msg">{sendError}</p>}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !sendingMessage && sendMessage()}
                  placeholder="Mandar mensagem como se fosse este cliente..."
                  disabled={sendingMessage}
                  className="input-field flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={sendingMessage || !messageDraft.trim()}
                  className="btn-secondary shrink-0 px-3 py-2"
                  title="Enviar"
                >
                  {sendingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
