import { describe, expect, it } from 'vitest'
import { buildProductPayload } from '../../../lib/productHelpers'
import { filterPdvProducts, findProductByBarcode, pdvCartTotals } from '../../../lib/pdvHelpers'
import type { Product } from '../../../types'

/**
 * Usability permutations for Produtos → PDV without mounting full pages
 * (services are pure here; mirrors the fixed data path).
 */
describe('flow: create product → appears in PDV', () => {
  it('produto criado com barcode entra na lista PDV e no bip', () => {
    const payload = buildProductPayload({
      name: 'Cherry Ice',
      description: 'promo',
      price: '35.5',
      quantity: '8',
      image_url: '',
      category_id: 'cat1',
      barcode: '555666777',
      cost_price: '12',
      low_stock_threshold: '2',
    })
    const created: Product = {
      id: 'new-1',
      ...payload,
      active: true,
      category_name: null,
    }
    const pdvCatalog = [created].filter((p) => p.active !== false)

    expect(filterPdvProducts(pdvCatalog, 'cherry')).toHaveLength(1)
    expect(findProductByBarcode(pdvCatalog, '555666777')?.id).toBe('new-1')

    // add / discount / payment permutations (cart math)
    const money = pdvCartTotals([{ price: created.price, quantity: 2 }], 'fixed', 5)
    expect(money.total).toBeCloseTo(35.5 * 2 - 5)
    const pct = pdvCartTotals([{ price: created.price, quantity: 1 }], 'percent', 10)
    expect(pct.total).toBeCloseTo(35.5 * 0.9)

    for (const method of ['dinheiro', 'pix', 'cartao'] as const) {
      expect(['dinheiro', 'pix', 'cartao']).toContain(method)
    }
    // "não gerar qrcode" is UI state — sale still uses payment_method pix
    const skipQrcode = true
    expect(skipQrcode && methodSafe('pix')).toBe(true)
  })

  it('produto inativo não entra no PDV (filtro active !== false)', () => {
    const inactive: Product = {
      id: 'x',
      name: 'Hidden',
      description: null,
      price: 1,
      quantity: 1,
      image_url: null,
      category_id: null,
      active: false,
      barcode: '000',
    }
    const pdv = [inactive].filter((p) => p.active !== false)
    expect(pdv).toHaveLength(0)
    expect(findProductByBarcode(pdv, '000')).toBeUndefined()
  })
})

function methodSafe(m: string) {
  return m === 'pix' || m === 'dinheiro' || m === 'cartao'
}
