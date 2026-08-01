import { describe, expect, it } from 'vitest'
import {
  filterPdvProducts,
  findProductByBarcode,
  PDV_NAME_SEARCH_MIN,
  pdvCartTotals,
  pdvDiscountAmount,
} from '../../../lib/pdvHelpers'
import type { Product } from '../../../types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Pod Mango',
    description: null,
    price: 20,
    quantity: 5,
    image_url: null,
    category_id: null,
    active: true,
    barcode: '123456789012',
    ...overrides,
  }
}

describe('PDV search', () => {
  const catalog = [
    product({ id: 'a', name: 'Pod Mango', barcode: '111' }),
    product({ id: 'b', name: 'Ice Mint', barcode: '222' }),
    product({ id: 'c', name: 'Alpha', barcode: 'MANGO99', active: true }),
  ]

  it(`exige pelo menos ${PDV_NAME_SEARCH_MIN} caracteres no nome`, () => {
    expect(filterPdvProducts(catalog, 'p')).toEqual([])
    expect(filterPdvProducts(catalog, 'po')).toHaveLength(1)
  })

  it('busca por nome (case-insensitive)', () => {
    expect(filterPdvProducts(catalog, 'mint').map((p) => p.id)).toEqual(['b'])
  })

  it('busca também por barcode parcial na caixa de nome', () => {
    expect(filterPdvProducts(catalog, 'mango99').map((p) => p.id)).toEqual(['c'])
  })

  it('bip exige match exato de barcode', () => {
    expect(findProductByBarcode(catalog, '111')?.id).toBe('a')
    expect(findProductByBarcode(catalog, '11')).toBeUndefined()
    expect(findProductByBarcode(catalog, ' 222 ')?.id).toBe('b')
  })
})

describe('PDV cart math', () => {
  it('subtotal sem desconto', () => {
    const t = pdvCartTotals(
      [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 1 },
      ],
      'percent',
      0
    )
    expect(t).toEqual({ subtotal: 25, discount: 0, total: 25 })
  })

  it('desconto % e R$ respeitam teto do subtotal', () => {
    expect(pdvDiscountAmount(100, 'percent', 10)).toBe(10)
    expect(pdvDiscountAmount(100, 'fixed', 30)).toBe(30)
    expect(pdvDiscountAmount(20, 'fixed', 999)).toBe(20)
    expect(pdvDiscountAmount(20, 'percent', 200)).toBe(20)
    expect(pdvDiscountAmount(20, 'percent', -5)).toBe(0)
  })

  it('total = subtotal - desconto', () => {
    const t = pdvCartTotals([{ price: 40, quantity: 2 }], 'percent', 25)
    expect(t.subtotal).toBe(80)
    expect(t.discount).toBe(20)
    expect(t.total).toBe(60)
  })
})
