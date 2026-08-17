// Client da demo pública de assistente de IA (landing) — rotas sempre
// públicas (/api/public/demo-assistant/*), nunca levam Authorization: não
// reaproveita lib/api.ts::request() de propósito, pra não acoplar por
// engano a token de sessão de assinante/superadmin.
import { API_BASE } from './api'

export type DemoKind = 'ecommerce' | 'eletronicos'

export type DemoConfig = {
  kind: DemoKind
  default_system_prompt: string
  sample_questions: string[]
}

export type DemoChatMessage = { role: 'user' | 'assistant'; content: string }

async function demoFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) },
    })
  } catch {
    throw new Error('Não foi possível conectar ao servidor da demo. Verifique sua internet.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Erro ${res.status}`)
  }
  return res.json()
}

export function fetchDemoConfig(kind: DemoKind): Promise<DemoConfig> {
  return demoFetch(`/api/public/demo-assistant/${kind}/config`)
}

export function sendDemoMessage(input: {
  kind: DemoKind
  sessionId: string
  message: string
  history: DemoChatMessage[]
  promptOverride?: string | null
}): Promise<{ reply: string; tool_calls_used: number }> {
  return demoFetch(`/api/public/demo-assistant/${input.kind}/message`, {
    method: 'POST',
    body: JSON.stringify({
      session_id: input.sessionId,
      message: input.message,
      history: input.history,
      prompt_override: input.promptOverride || undefined,
    }),
  })
}

// Isolamento por aba/sessão, nunca entre visitantes diferentes — mesmo
// padrão de ecommerce/frontend/src/lib/demoMode.ts: sessionStorage, nunca
// localStorage (que vazaria entre abas/visitas do mesmo navegador).
const SESSION_ID_KEY = 'resolutoo_demo_assistant_session_id'

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = sessionStorage.getItem(SESSION_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_ID_KEY, id)
  }
  return id
}

function promptKey(kind: DemoKind): string {
  return `resolutoo_demo_assistant_prompt_${kind}`
}

export function getPromptOverride(kind: DemoKind): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(promptKey(kind))
}

export function setPromptOverride(kind: DemoKind, value: string): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(promptKey(kind), value)
}

/** Botão "voltar às configurações padrão" — só limpa a sessão local, nunca chama o servidor. */
export function resetPromptOverride(kind: DemoKind): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(promptKey(kind))
}
