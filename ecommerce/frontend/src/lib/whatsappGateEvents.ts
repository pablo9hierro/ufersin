/** Cross-component signal for definitive WhatsApp connect/disconnect.
 *
 * Emit ONLY for definitive states (manual logout, Evolution `open` / `close`).
 * Never emit on `connecting`, unknown, or network errors — that flickered the gate.
 *
 * AdminLayout is the single source of truth for locked UI; events are hints
 * (disconnect → immediate lock; connect → confirm with a live status read).
 */

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
