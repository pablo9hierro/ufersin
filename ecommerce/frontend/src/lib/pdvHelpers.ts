import type { Product } from '../types'

/** Min chars for name search in PDV (barcode bip is exact, separate path). */
export const PDV_NAME_SEARCH_MIN = 2

export function filterPdvProducts(products: Product[], query: string, limit = 12): Product[] {
  const q = query.trim().toLowerCase()
  if (q.length < PDV_NAME_SEARCH_MIN) return []
  return products
    .filter((p) => {
      const nameHit = p.name.toLowerCase().includes(q)
      const barcodeHit = (p.barcode ?? '').toLowerCase().includes(q)
      return nameHit || barcodeHit
    })
    .slice(0, limit)
}

export function findProductByBarcode(products: Product[], code: string): Product | undefined {
  const needle = code.trim()
  if (!needle) return undefined
  return products.find((p) => (p.barcode ?? '').trim() === needle)
}

export function pdvDiscountAmount(
  subtotal: number,
  discountType: 'percent' | 'fixed',
  discountValue: number
): number {
  const raw = discountType === 'percent' ? (subtotal * discountValue) / 100 : discountValue
  return Math.min(Math.max(raw, 0), Math.max(subtotal, 0))
}

export function pdvCartTotals(
  lines: { price: number; quantity: number }[],
  discountType: 'percent' | 'fixed',
  discountValue: number
) {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0)
  const discount = pdvDiscountAmount(subtotal, discountType, discountValue)
  return { subtotal, discount, total: subtotal - discount }
}
