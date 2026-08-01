import type { Product } from '../types'

export function isOutOfStock(p: Pick<Product, 'quantity'>): boolean {
  return p.quantity <= 0
}

export function isLowStock(p: Pick<Product, 'quantity' | 'low_stock_threshold'>): boolean {
  return !isOutOfStock(p) && p.low_stock_threshold != null && p.quantity <= p.low_stock_threshold
}

/** Payload shape sent by AdminProdutos save — keeps create/update consistent. */
export function buildProductPayload(form: {
  name: string
  description: string
  price: string
  quantity: string
  image_url: string
  category_id: string
  barcode: string
  cost_price: string
  low_stock_threshold: string
}) {
  return {
    name: form.name,
    description: form.description || null,
    price: Number(form.price),
    quantity: Number(form.quantity),
    image_url: form.image_url || null,
    category_id: form.category_id || null,
    barcode: form.barcode || null,
    cost_price: form.cost_price.trim() === '' ? null : Number(form.cost_price),
    low_stock_threshold: form.low_stock_threshold.trim() === '' ? null : Number(form.low_stock_threshold),
  }
}

export function isValidProductPayload(payload: ReturnType<typeof buildProductPayload>): string | null {
  if (!payload.name.trim()) return 'name is required'
  if (!Number.isFinite(payload.price) || payload.price < 0) return 'invalid price'
  if (!Number.isFinite(payload.quantity) || payload.quantity < 0) return 'invalid quantity'
  if (payload.cost_price != null && (!Number.isFinite(payload.cost_price) || payload.cost_price < 0)) {
    return 'invalid cost_price'
  }
  return null
}
