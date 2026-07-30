import { z } from 'zod'
import { CouponKindSchema, DiscountTypeSchema } from './shared'
import { ProductDiscountSchema } from './product'

export const CouponSchema = z.object({
  id: z.string(),
  code: z.string(),
  kind: CouponKindSchema,
  // Texto livre, só interno (nunca vai pro cliente) — anotação do admin
  // sobre o cupom.
  description: z.string().nullable().optional(),
  // kind='frete': discount_type/value É a taxa de frete (legado, cupom
  // avulso). kind='desconto': desconto flat sobre o subtotal. kind='produto':
  // discount_type/value ficam null, o desconto mora em product_discounts.
  discount_type: DiscountTypeSchema.nullable(),
  discount_value: z.number().nullable(),
  // Desconto de frete ADICIONAL, independente do kind — antes só cupom
  // exclusivo (CRM) combinava frete com desconto/produto; agora cupom
  // avulso também usa isso pro checkbox "Também dar desconto no frete".
  shipping_discount_type: DiscountTypeSchema.nullable(),
  shipping_discount_value: z.number().nullable(),
  product_discounts: z.array(ProductDiscountSchema).optional(),
  allow_promotion_checkout: z.boolean(),
  // Só relevante pra cupom alvo (com concessões) — se pode ser combinado
  // com um cupom avulso digitado manualmente no checkout.
  combinable_with_public: z.boolean().optional(),
  active: z.boolean(),
  // Vale pra QUALQUER cupom avulso (não só aniversário) — antes do
  // cadastro, não é aceito no checkout.
  starts_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  max_uses: z.number().nullable(),
  used_count: z.number(),
  created_at: z.string(),
  // > 0 quando o cupom nasceu de um filtro no CRM (cupom alvo,
  // intransferível) — 0 é cupom avulso, qualquer um pode digitar o código.
  grant_count: z.number().optional(),
  // Mensagem de WhatsApp — só usada quando algum dos campos de
  // aniversário abaixo está preenchido (cupom vira "alvo", concedido
  // automaticamente em vez de digitado manualmente).
  message_template: z.string().nullable().optional(),
  // Concede automaticamente N dias antes do aniversário de CADA cliente.
  bday_customer_days_before: z.number().nullable().optional(),
  // Concede automaticamente pra TODOS os clientes, N dias antes de uma
  // data fixa da loja (formato 'MM-DD').
  bday_store_date: z.string().nullable().optional(),
  bday_store_days_before: z.number().nullable().optional(),
})
export type Coupon = z.infer<typeof CouponSchema>

export const CouponGrantSchema = z.object({
  id: z.string(),
  customer_whatsapp: z.string(),
  customer_name: z.string().nullable(),
  granted_uses: z.number(),
  used_count: z.number(),
  created_at: z.string(),
})
export type CouponGrant = z.infer<typeof CouponGrantSchema>

export const CustomerCouponEntrySchema = z.object({
  grant_id: z.string(),
  coupon_id: z.string(),
  code: z.string(),
  kind: CouponKindSchema,
  discount_type: DiscountTypeSchema.nullable(),
  discount_value: z.number().nullable(),
  shipping_discount_type: DiscountTypeSchema.nullable(),
  shipping_discount_value: z.number().nullable(),
  granted_uses: z.number(),
  used_count: z.number(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
})
export type CustomerCouponEntry = z.infer<typeof CustomerCouponEntrySchema>

export const CustomerCouponHistoryEntrySchema = z.object({
  order_id: z.string(),
  coupon_code: z.string(),
  created_at: z.string(),
  total: z.number(),
  discount_amount: z.number().nullable(),
  shipping_discount: z.number().nullable(),
})
export type CustomerCouponHistoryEntry = z.infer<typeof CustomerCouponHistoryEntrySchema>

export const CustomerCouponsSchema = z.object({
  active: z.array(CustomerCouponEntrySchema),
  inactive: z.array(CustomerCouponEntrySchema),
  history: z.array(CustomerCouponHistoryEntrySchema),
})
export type CustomerCoupons = z.infer<typeof CustomerCouponsSchema>

// Retorno de customer_claim_coupon — só existe DEPOIS de confirmar o
// resgate em /cliente/cupons, nada disso é visível antes.
// (description NÃO entra aqui: é nota interna do admin, nunca vai pro cliente.)
// Preview de cupom (retorno de validate_coupon/list_customer_coupons) —
// só o subconjunto de campos que o checkout precisa pra aplicar o
// desconto, sem os campos internos de gestão do cupom completo.
export const CouponPreviewSchema = CouponSchema.pick({
  code: true,
  kind: true,
  discount_type: true,
  discount_value: true,
  shipping_discount_type: true,
  shipping_discount_value: true,
  product_discounts: true,
  allow_promotion_checkout: true,
  combinable_with_public: true,
})
export type CouponPreview = z.infer<typeof CouponPreviewSchema>

// Produto em promoção (cupom avulso kind='produto', sem concessão) —
// categoria "Promoção" do catálogo. Desconto já se aplica sozinho assim
// que o produto entra no carrinho, sem digitar código.
export const PromotionalProductSchema = z.object({
  product_id: z.string(),
  coupon_code: z.string(),
  discount_type: DiscountTypeSchema,
  discount_value: z.number(),
})
export type PromotionalProduct = z.infer<typeof PromotionalProductSchema>

export const ClaimedCouponSchema = z.object({
  grant_id: z.string(),
  coupon_id: z.string(),
  code: z.string(),
  kind: CouponKindSchema,
  discount_type: DiscountTypeSchema.nullable(),
  discount_value: z.number().nullable(),
  shipping_discount_type: DiscountTypeSchema.nullable(),
  shipping_discount_value: z.number().nullable(),
  granted_uses: z.number(),
  used_count: z.number(),
  expires_at: z.string().nullable(),
})
export type ClaimedCoupon = z.infer<typeof ClaimedCouponSchema>
