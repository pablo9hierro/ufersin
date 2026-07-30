import { couponsEndpoint } from '../api/endpoints/coupons'

// Módulo Cupons — cupom digitado no checkout + cupons de fidelidade do
// cliente logado (/cliente/cupons).
export const couponService = {
  validate: couponsEndpoint.validate,
  listForCustomer: couponsEndpoint.listForCustomer,
  listPromotionalProducts: couponsEndpoint.listPromotionalProducts,
  listMine: couponsEndpoint.listMine,
  hasClaimable: couponsEndpoint.hasClaimable,
  peekClaimable: couponsEndpoint.peekClaimable,
  claim: couponsEndpoint.claim,
}
