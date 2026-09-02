import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { ClaimedCouponSchema, CouponPreviewSchema, CustomerCouponsSchema, PromotionalProductSchema } from '../../types'
import { cachedByTenant } from '../../lib/apiCache'

// Módulo Cupons — único ponto do app autorizado a chamar `api.coupons.*` e
// a fatia de cupom de `api.customerAuth.*`. Cobre tanto o cupom digitado
// no checkout (público) quanto os cupons de fidelidade do cliente logado
// (/cliente/cupons).
export const couponsEndpoint = {
  // Checkout — cupom digitado manualmente.
  validate: async (code: string, promotionId?: string, customerBirthdate?: string, customerWhatsapp?: string) =>
    validate(CouponPreviewSchema, await api.coupons.validate(code, promotionId, customerBirthdate, customerWhatsapp), 'coupons.validate'),
  // Checkout — auto-detecta cupom alvo assim que o whatsapp digitado bate
  // com uma concessão, sem precisar digitar código.
  listForCustomer: async (customerWhatsapp: string) =>
    validateList(CouponPreviewSchema, await api.coupons.listForCustomer(customerWhatsapp), 'coupons.listForCustomer'),
  // Categoria "Promoção" do catálogo — desconto de produto já aplicado
  // sozinho, sem cupom digitado.
  listPromotionalProducts: async () =>
    cachedByTenant('coupons.listPromotionalProducts', async () =>
      validateList(PromotionalProductSchema, await api.coupons.listPromotionalProducts(), 'coupons.listPromotionalProducts'),
    ),

  // /cliente/cupons — cupons de fidelidade do cliente logado.
  listMine: async (token: string) => validate(CustomerCouponsSchema, await api.customerAuth.listCoupons(token), 'customerAuth.listCoupons'),
  hasClaimable: async (token: string) => api.customerAuth.hasClaimableCoupon(token),
  peekClaimable: async (token: string) => validate(ClaimedCouponSchema, await api.customerAuth.peekClaimableCoupon(token), 'customerAuth.peekClaimableCoupon'),
  claim: async (token: string) => validate(ClaimedCouponSchema, await api.customerAuth.claimCoupon(token), 'customerAuth.claimCoupon'),
}
