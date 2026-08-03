import { describe, expect, it } from 'vitest'
import {
  appendCashDigit,
  backspaceCashDigit,
  cashCoversTotal,
  computeTroco,
  digitsToCashCents,
  formatCashMask,
  formatTrocoLabel,
} from '../../../lib/cashMask'

describe('cashMask terminal entry', () => {
  it('starts at 00,00 and appends from the right', () => {
    expect(formatCashMask(0)).toBe('00,00')
    let c = 0
    c = appendCashDigit(c, 5)
    expect(formatCashMask(c)).toBe('00,05')
    c = appendCashDigit(c, 0)
    expect(formatCashMask(c)).toBe('00,50')
    c = appendCashDigit(c, 0)
    expect(formatCashMask(c)).toBe('05,00')
    c = appendCashDigit(c, 0)
    expect(formatCashMask(c)).toBe('50,00')
  })

  it('backspace shifts right', () => {
    expect(backspaceCashDigit(5000)).toBe(500)
    expect(formatCashMask(backspaceCashDigit(5))).toBe('00,00')
  })

  it('digitsToCashCents from paste/mobile', () => {
    expect(digitsToCashCents('500')).toBe(500)
    expect(formatCashMask(digitsToCashCents('500'))).toBe('05,00')
    expect(digitsToCashCents('')).toBe(0)
  })

  it('troco = cash − total (can be negative)', () => {
    expect(computeTroco(5000, 45)).toBeCloseTo(5, 5)
    expect(computeTroco(2000, 45)).toBeCloseTo(-25, 5)
    expect(formatTrocoLabel(5)).toBe('Troco: R$ 5,00')
    expect(formatTrocoLabel(-25)).toBe('Troco: R$ -25,00')
  })

  it('cashCoversTotal compares in cents', () => {
    expect(cashCoversTotal(4500, 45)).toBe(true)
    expect(cashCoversTotal(4499, 45)).toBe(false)
  })
})
