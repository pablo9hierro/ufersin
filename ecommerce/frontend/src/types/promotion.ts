import { z } from 'zod'
import { DiscountTypeSchema, PromotionTypeSchema } from './shared'
import { ProductDiscountSchema } from './product'

// "Promoção" — o antigo "campanha": banner/carrossel da landing, kit ou
// selfie-service, leva pro checkout de /banner. Renomeado pra abrir
// espaço pro novo conceito de "campanha" (ver CrmCampanhaCoupon).
export const PromotionSchema = z.object({
  id: z.string(),
  title: z.string(),
  // Segunda linha do rodapé do card na landing (era fixo "Promoções");
  // null/vazio cai no padrão "Promoções" no componente que renderiza.
  subtitle: z.string().nullable(),
  image_url: z.string(),
  product_ids: z.array(z.string()),
  promotion_type: PromotionTypeSchema,
  // kit: desconto sobre o valor total somado (discount_type/value).
  // selfie_service: desconto por produto (product_discounts) — cliente
  // monta o próprio carrinho em /banner com só os itens que quiser.
  discount_type: DiscountTypeSchema.nullable(),
  discount_value: z.number().nullable(),
  shipping_discount_type: DiscountTypeSchema.nullable(),
  shipping_discount_value: z.number().nullable(),
  product_discounts: z.array(ProductDiscountSchema).optional(),
  // Regras "categoria inteira" (produto novo/recategorizado na categoria
  // entra em promoção sozinho, via trigger no backend) — usado só pra
  // reconstruir a tag category_id de product_discounts ao reabrir a
  // promoção pra editar.
  category_discounts: z
    .array(z.object({ category_id: z.string(), discount_type: DiscountTypeSchema, discount_value: z.number() }))
    .optional(),
  active: z.boolean().optional(),
  starts_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string().optional(),
})
export type Promotion = z.infer<typeof PromotionSchema>
