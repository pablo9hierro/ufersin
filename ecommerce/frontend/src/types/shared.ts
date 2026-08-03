import { z } from 'zod'

// Enums/valores fechados compartilhados por vários domínios — schema Zod
// é a fonte única, o tipo TS é sempre derivado (z.infer), nunca declarado
// em paralelo.

export const OrderStatusSchema = z.enum([
  'pendente',
  'montando_pedido',
  'pedido_pronto',
  'aguardando_localizacao',
  'em_rota_de_entrega',
  'entregue',
  'retiradas',
  'entregas',
  'concluido',
  'cancelado',
])
export type OrderStatus = z.infer<typeof OrderStatusSchema>

export const DeliveryTypeSchema = z.enum(['entrega', 'retirada', 'balcao'])
export type DeliveryType = z.infer<typeof DeliveryTypeSchema>

export const PaymentMethodSchema = z.enum(['pix', 'cartao', 'dinheiro'])
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>

export const PaymentStatusSchema = z.enum(['pendente', 'pago', 'reembolsado'])
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>

export const DiscountTypeSchema = z.enum(['percent', 'fixed'])
export type DiscountType = z.infer<typeof DiscountTypeSchema>

export const CouponKindSchema = z.enum(['desconto', 'frete', 'aniversario', 'produto'])
export type CouponKind = z.infer<typeof CouponKindSchema>

export const PromotionTypeSchema = z.enum(['selfie_service', 'kit'])
export type PromotionType = z.infer<typeof PromotionTypeSchema>

export const CampanhaOrientationSchema = z.enum(['segmento', 'evento'])
export type CampanhaOrientation = z.infer<typeof CampanhaOrientationSchema>

export const BgModeSchema = z.enum(['svg1', 'synthwave', 'stars', 'custom'])
export type BgMode = z.infer<typeof BgModeSchema>

export const BgFitSchema = z.enum(['meet', 'slice'])
export type BgFit = z.infer<typeof BgFitSchema>

export const BadgesLayoutSchema = z.enum(['row', 'column'])
export type BadgesLayout = z.infer<typeof BadgesLayoutSchema>

export const CarouselStyleSchema = z.enum(['atual', 'cards'])
export type CarouselStyle = z.infer<typeof CarouselStyleSchema>

export const PageKeySchema = z.enum(['catalogo', 'landing', 'favoritos', 'cupons', 'historico', 'cart_icon'])
export type PageKey = z.infer<typeof PageKeySchema>

export const DecorElementTypeSchema = z.enum(['smoke', 'fire'])
export type DecorElementType = z.infer<typeof DecorElementTypeSchema>

// Critério salvo do filtro avançado do CRM — mesmo shape do FilterState do
// front (AdminCrm.tsx), guardado como jsonb opaco (o servidor nunca
// interpreta o conteúdo, só persiste).
export const CrmFilterCriteriaSchema = z.record(z.string(), z.unknown())
export type CrmFilterCriteria = z.infer<typeof CrmFilterCriteriaSchema>
