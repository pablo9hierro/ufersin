import type { StoreStatus } from './types'

export const DAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

// Considera só o horário semanal (ignora fechamento manual) — usado pra
// decidir se fechar manualmente agora exige justificativa. Um dia pode ter
// vários intervalos (ex: almoço) — basta UM cobrir o horário atual.
export function isScheduledOpenNow(status: StoreStatus, now: Date = new Date()): boolean {
  const dow = now.getDay()
  const hourRow = status.hours.find((h) => h.day_of_week === dow)
  if (!hourRow?.is_open) return false
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return hourRow.intervals.some((iv) => {
    if (!iv.opens_at || !iv.closes_at) return false
    const [oh, om] = iv.opens_at.split(':').map(Number)
    const [ch, cm] = iv.closes_at.split(':').map(Number)
    return nowMinutes >= oh * 60 + om && nowMinutes < ch * 60 + cm
  })
}

// Estado final "a loja está aberta agora" — horário semanal E NÃO fechada
// manualmente. Landing page usa isso pra decidir grayscale + mensagem.
export function getStoreOpenState(status: StoreStatus, now: Date = new Date()) {
  const scheduledOpen = isScheduledOpenNow(status, now)
  return {
    open: scheduledOpen && !status.manually_closed,
    scheduledOpen,
    manuallyClosed: status.manually_closed,
    reason: status.manually_closed ? status.manual_closed_reason : null,
  }
}
