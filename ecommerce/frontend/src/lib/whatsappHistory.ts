export type WaHistoryEvent = {
  id: string
  event_type: string
  previous_state: string | null
  new_state: string | null
  created_at: string
}

export function formatWaEventLabel(e: Pick<WaHistoryEvent, 'event_type'>): string {
  if (e.event_type === 'connected') return 'Conectado'
  if (e.event_type === 'disconnected') return 'Desconectado'
  if (e.event_type === 'qr') return 'QR gerado'
  return e.event_type
}

/** Locale timestamp for history rows — empty/invalid → null (UI shows em dash). */
export function formatWaEventTime(createdAt: string, locale = 'pt-BR'): string | null {
  if (!createdAt?.trim()) return null
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(locale)
}

/**
 * Classify connection-events API failures for the Conta UI.
 * - `empty`: truly no rows (or intentional empty)
 * - `schema_missing`: table/route/migration gap — must NOT look like "nunca conectou"
 * - `auth`: session expired
 * - `error`: other
 */
export function classifyWaHistoryError(err: unknown): {
  kind: 'schema_missing' | 'auth' | 'error'
  message: string
} {
  const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : undefined
  const msg =
    typeof err === 'object' && err && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : String(err ?? '')

  if (status === 401 || /unauthorized|expired token|invalid or expired/i.test(msg)) {
    return { kind: 'auth', message: 'Sessão expirada — faça login de novo.' }
  }
  if (
    status === 404 ||
    status === 502 ||
    status === 503 ||
    /does not exist|relation|whatsapp_connection_events|erro\s*404\b/i.test(msg)
  ) {
    return {
      kind: 'schema_missing',
      message:
        'Histórico indisponível no servidor (migração/tabela ou rota). Status pode aparecer Conectado mesmo assim — avise o suporte Resolutoo.',
    }
  }
  return { kind: 'error', message: 'Não foi possível carregar o histórico.' }
}
