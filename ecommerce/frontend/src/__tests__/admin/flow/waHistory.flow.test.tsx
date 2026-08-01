import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ApiError } from '../../../lib/apiError'
import {
  classifyWaHistoryError,
  formatWaEventLabel,
  formatWaEventTime,
  type WaHistoryEvent,
} from '../../../lib/whatsappHistory'

/**
 * Lightweight UI contract for WA history — avoids mounting full AdminSenha
 * (tenant hooks / WhatsAppConnection). Asserts the same render rules the page uses.
 */
function WaHistoryPanel({
  events,
  error,
  loading,
}: {
  events: WaHistoryEvent[]
  error: string | null
  loading?: boolean
}) {
  return (
    <div>
      <p>Histórico de conexões</p>
      {loading && <p>Carregando…</p>}
      {error && <p data-testid="wa-history-error">{error}</p>}
      {!loading && !error && events.length === 0 && (
        <p data-testid="wa-history-empty">Nenhuma conexão ainda</p>
      )}
      <ul data-testid="wa-history-list">
        {events.map((ev) => (
          <li key={ev.id} data-testid="wa-history-row">
            <span>{formatWaEventLabel(ev)}</span>
            <time dateTime={ev.created_at}>{formatWaEventTime(ev.created_at) ?? '—'}</time>
          </li>
        ))}
      </ul>
    </div>
  )
}

describe('WA history UI contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('com eventos: mostra label + timestamp formatado (nunca empty)', () => {
    const events: WaHistoryEvent[] = [
      {
        id: '1',
        event_type: 'connected',
        previous_state: null,
        new_state: 'open',
        created_at: '2026-08-01T18:00:00.000Z',
      },
    ]
    render(<WaHistoryPanel events={events} error={null} />)
    expect(screen.queryByTestId('wa-history-empty')).toBeNull()
    expect(screen.getByText('Conectado')).toBeInTheDocument()
    const time = screen.getByRole('time')
    expect(time.getAttribute('dateTime')).toBe(events[0].created_at)
    expect(time.textContent).not.toBe('—')
    expect(time.textContent?.length).toBeGreaterThan(4)
  })

  it('lista vazia legítima → empty state', () => {
    render(<WaHistoryPanel events={[]} error={null} />)
    expect(screen.getByTestId('wa-history-empty')).toHaveTextContent('Nenhuma conexão ainda')
  })

  it('schema/404 → erro claro, NÃO empty state', async () => {
    const classified = classifyWaHistoryError(
      new ApiError(404, 'relation whatsapp_connection_events does not exist')
    )
    render(<WaHistoryPanel events={[]} error={classified.message} />)
    expect(screen.queryByTestId('wa-history-empty')).toBeNull()
    expect(screen.getByTestId('wa-history-error').textContent).toMatch(/Histórico indisponível|migração/i)
    await waitFor(() => {
      expect(classified.kind).toBe('schema_missing')
    })
  })
})
