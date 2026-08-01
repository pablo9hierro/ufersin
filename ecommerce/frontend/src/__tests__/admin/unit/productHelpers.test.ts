import { describe, expect, it } from 'vitest'
import {
  buildProductPayload,
  isLowStock,
  isOutOfStock,
  isValidProductPayload,
} from '../../../lib/productHelpers'

describe('product stock helpers', () => {
  it('isOutOfStock', () => {
    expect(isOutOfStock({ quantity: 0 })).toBe(true)
    expect(isOutOfStock({ quantity: -1 })).toBe(true)
    expect(isOutOfStock({ quantity: 1 })).toBe(false)
  })

  it('isLowStock só com threshold e estoque > 0', () => {
    expect(isLowStock({ quantity: 2, low_stock_threshold: 3 })).toBe(true)
    expect(isLowStock({ quantity: 0, low_stock_threshold: 3 })).toBe(false)
    expect(isLowStock({ quantity: 5, low_stock_threshold: null })).toBe(false)
  })
})

describe('product payload / validators', () => {
  const base = {
    name: 'Novo',
    description: 'desc',
    price: '19.9',
    quantity: '3',
    image_url: '',
    category_id: 'c1',
    barcode: '999',
    cost_price: '10',
    low_stock_threshold: '2',
  }

  it('buildProductPayload normaliza vazios pra null', () => {
    const p = buildProductPayload({ ...base, description: '', image_url: '', barcode: '', cost_price: '  ', low_stock_threshold: '' })
    expect(p.description).toBeNull()
    expect(p.image_url).toBeNull()
    expect(p.barcode).toBeNull()
    expect(p.cost_price).toBeNull()
    expect(p.low_stock_threshold).toBeNull()
    expect(p.price).toBe(19.9)
    expect(p.quantity).toBe(3)
  })

  it('isValidProductPayload rejeita nome/preço inválidos', () => {
    expect(isValidProductPayload(buildProductPayload({ ...base, name: '  ' }))).toMatch(/name/)
    expect(isValidProductPayload(buildProductPayload({ ...base, price: '-1' }))).toMatch(/price/)
    expect(isValidProductPayload(buildProductPayload(base))).toBeNull()
  })
})
