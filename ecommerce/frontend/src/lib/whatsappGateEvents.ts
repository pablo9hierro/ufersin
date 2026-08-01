/** Cross-component signal so AdminLayout can re-lock the etapa 2 gate
 *  immediately when WhatsApp disconnects (manual logout or auto drop),
 *  without waiting for the next status poll. */

export const WA_GATE_EVENT = 'resolutoo:whatsapp-gate'

export type WaGateDetail = { connected: boolean }

export function emitWhatsAppGateChange(connected: boolean) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<WaGateDetail>(WA_GATE_EVENT, { detail: { connected } }))
}

export function subscribeWhatsAppGateChange(handler: (connected: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<WaGateDetail>).detail
    handler(!!detail?.connected)
  }
  window.addEventListener(WA_GATE_EVENT, listener)
  return () => window.removeEventListener(WA_GATE_EVENT, listener)
}
