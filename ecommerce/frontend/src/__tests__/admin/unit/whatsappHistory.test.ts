import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../lib/apiError'
import {
  classifyWaHistoryError,
  formatWaEventLabel,
  formatWaEventTime,
} from '../../../lib/whatsappHistory'

describe('WA history formatters', () => {
  it('labels', () => {
    expect(formatWaEventLabel({ event_type: 'connected' })).toBe('Conectado')
    expect(formatWaEventLabel({ event_type: 'disconnected' })).toBe('Desconectado')
    expect(formatWaEventLabel({ event_type: 'qr' })).toBe('QR gerado')
  })

  it('timestamps — ISO válido vira string local; inválido → null', () => {
    const iso = '2026-08-01T15:30:00.000Z'
    const formatted = formatWaEventTime(iso, 'pt-BR')
    expect(formatted).toBeTruthy()
    expect(formatted).toMatch(/2026|01|08|15|30|12/) // locale-dependent digits
    expect(formatWaEventTime('')).toBeNull()
    expect(formatWaEventTime('not-a-date')).toBeNull()
  })
})

describe('classifyWaHistoryError', () => {
  it('404 / relation missing → schema_missing (não empty state)', () => {
    const c = classifyWaHistoryError(new ApiError(404, 'relation whatsapp_connection_events does not exist'))
    expect(c.kind).toBe('schema_missing')
    expect(c.message).toMatch(/Histórico indisponível|migração/i)
  })

  it('401 → auth', () => {
    expect(classifyWaHistoryError(new ApiError(401, 'unauthorized')).kind).toBe('auth')
  })

  it('other → error genérico', () => {
    expect(classifyWaHistoryError(new ApiError(500, 'boom')).kind).toBe('error')
  })
})
