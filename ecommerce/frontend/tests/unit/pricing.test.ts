import { describe, expect, it } from 'vitest'
import { currency, discountLabel, finalPrice } from '../../src/components/ProductDetailModal'
import type { PromotionalProduct } from '../../src/lib/supabasePublicApi'

function promo(overrides: Partial<PromotionalProduct> = {}): PromotionalProduct {
  return { product_id: 'p1', coupon_code: 'PROMO10', discount_type: 'percent', discount_value: 10, ...overrides }
}

describe('currency', () => {
  it('formata com R$ e vírgula decimal', () => {
    expect(currency(20)).toBe('R$ 20,00')
    expect(currency(19.9)).toBe('R$ 19,90')
    expect(currency(0)).toBe('R$ 0,00')
  })
})

describe('discountLabel', () => {
  it('mostra -X% para desconto percentual', () => {
    expect(discountLabel(promo({ discount_type: 'percent', discount_value: 25 }))).toBe('-25%')
  })

  it('mostra -R$X para desconto fixo', () => {
    expect(discountLabel(promo({ discount_type: 'fixed', discount_value: 5 }))).toBe('-R$ 5,00')
  })
})

describe('finalPrice', () => {
  it('aplica desconto percentual sobre o preço original', () => {
    // R$20 - 10% = R$18 — o exemplo exato do pedido do usuário (Subtotal
    // R$15, item promocional R$20 riscado -> R$15 final, mesma fórmula).
    expect(finalPrice(20, promo({ discount_type: 'percent', discount_value: 25 }))).toBe(15)
  })

  it('aplica desconto fixo em reais sobre o preço original', () => {
    expect(finalPrice(20, promo({ discount_type: 'fixed', discount_value: 5 }))).toBe(15)
  })

  it('nunca fica negativo quando o desconto é maior que o preço', () => {
    expect(finalPrice(10, promo({ discount_type: 'fixed', discount_value: 999 }))).toBe(0)
    expect(finalPrice(10, promo({ discount_type: 'percent', discount_value: 500 }))).toBe(0)
  })

  it('desconto de 0% ou 0 fixo mantém o preço original', () => {
    expect(finalPrice(20, promo({ discount_type: 'percent', discount_value: 0 }))).toBe(20)
    expect(finalPrice(20, promo({ discount_type: 'fixed', discount_value: 0 }))).toBe(20)
  })
})
