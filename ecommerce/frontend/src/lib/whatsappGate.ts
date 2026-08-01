/**
 * Stable WhatsApp gate helpers.
 *
 * Lock/unlock must only follow definitive Evolution states.
 * Transient readings (`connecting`, unknown, network errors) must NOT toggle the gate.
 */

export type WaVerdict = 'open' | 'closed' | 'pending'

/** Consecutive identical definitive readings required before toggling (debounce). */
export const WA_GATE_CONFIRM_STREAK = 2

/** Poll while unlocked — slower than before to avoid fight with Evolution reconnect. */
export const WA_GATE_POLL_MS = 12_000

export function extractWaState(status: unknown): string {
  const s = status as { instance?: { state?: string }; state?: string } | null
  const raw = s?.instance?.state ?? s?.state
  return typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : 'desconhecido'
}

/**
 * Map Evolution (and our API) states to a gate verdict.
 * - open → connected
 * - close / closed / logout / refused / instance missing → disconnected
 * - connecting / qr / pairing / unknown → pending (ignore)
 */
export function classifyWaState(raw: string | null | undefined): WaVerdict {
  const s = (raw ?? '').trim().toLowerCase()
  if (s === 'open') return 'open'
  if (
    s === 'close' ||
    s === 'closed' ||
    s === 'logout' ||
    s === 'logged_out' ||
    s === 'refused' ||
    s === 'destroyed'
  ) {
    return 'closed'
  }
  return 'pending'
}

export function classifyWaStatusPayload(status: unknown): WaVerdict {
  return classifyWaState(extractWaState(status))
}

/** Tracks consecutive identical definitive readings before applying a toggle. */
export class WaGateDebouncer {
  private pending: WaVerdict | null = null
  private streak = 0
  private readonly need: number

  constructor(need = WA_GATE_CONFIRM_STREAK) {
    this.need = Math.max(1, need)
  }

  reset() {
    this.pending = null
    this.streak = 0
  }

  /**
   * Feed a verdict. Returns the confirmed verdict when the streak is met,
   * otherwise null (keep current gate state).
   * `pending` clears the streak and never confirms.
   */
  observe(verdict: WaVerdict): WaVerdict | null {
    if (verdict === 'pending') {
      this.reset()
      return null
    }
    if (this.pending === verdict) {
      this.streak += 1
    } else {
      this.pending = verdict
      this.streak = 1
    }
    if (this.streak >= this.need) {
      this.reset()
      return verdict
    }
    return null
  }

  /** Immediate confirm (manual logout) — bypass streak. */
  force(verdict: Exclude<WaVerdict, 'pending'>): Exclude<WaVerdict, 'pending'> {
    this.reset()
    return verdict
  }
}
