/** Brazilian payment-terminal cash entry: digits append from the right (centavos). */

const MAX_CENTS = 99_999_999 // R$ 999.999,99

export function formatCashMask(cents: number): string {
  const safe = Math.max(0, Math.floor(cents) || 0)
  const whole = Math.floor(safe / 100)
  const frac = safe % 100
  return `${String(whole).padStart(2, '0')},${String(frac).padStart(2, '0')}`
}

export function appendCashDigit(cents: number, digit: number): number {
  if (digit < 0 || digit > 9 || !Number.isInteger(digit)) return cents
  const next = (Math.max(0, Math.floor(cents) || 0) * 10 + digit)
  return Math.min(next, MAX_CENTS)
}

export function backspaceCashDigit(cents: number): number {
  return Math.floor(Math.max(0, Math.floor(cents) || 0) / 10)
}

/** Parse pasted/typed digits as a fresh centavos buffer (right-aligned). */
export function digitsToCashCents(digits: string): number {
  const only = digits.replace(/\D/g, '')
  if (!only) return 0
  const trimmed = only.replace(/^0+/, '') || '0'
  const capped = trimmed.slice(-8)
  return Math.min(Number.parseInt(capped, 10) || 0, MAX_CENTS)
}

export function cashCentsToReais(cents: number): number {
  return (Math.max(0, Math.floor(cents) || 0)) / 100
}

/** Troco in reais: cash informed − order total (can be negative). */
export function computeTroco(cashCents: number, orderTotalReais: number): number {
  return cashCentsToReais(cashCents) - orderTotalReais
}

export function formatTrocoLabel(trocoReais: number): string {
  return `Troco: R$ ${trocoReais.toFixed(2).replace('.', ',')}`
}

export function cashCoversTotal(cashCents: number, orderTotalReais: number): boolean {
  // Compare in cents to avoid float noise
  const totalCents = Math.round(orderTotalReais * 100)
  return Math.max(0, Math.floor(cashCents) || 0) >= totalCents
}
