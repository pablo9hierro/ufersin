import { z } from 'zod'
import { PaymentMethodSchema } from './shared'
import { OrderSchema } from './order'

export const PaymentFrequencySchema = z.enum(['diaria', 'semanal', 'quinzenal', 'mensal'])
export type PaymentFrequency = z.infer<typeof PaymentFrequencySchema>

export const MotoboySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  whatsapp: z.string().nullable().optional(),
  active: z.boolean(),
  payment_frequency: PaymentFrequencySchema.nullable().optional(),
  payment_fixed_value: z.number().nullable().optional(),
})
export type Motoboy = z.infer<typeof MotoboySchema>

export const MotoboyDeliverySchema = z.object({
  id: z.string(),
  customer_name: z.string(),
  neighborhood: z.string().nullable(),
  shipping_price: z.number(),
  earned: z.number(),
  paid: z.boolean(),
  duration_minutes: z.number().nullable(),
  updated_at: z.string(),
})
export type MotoboyDelivery = z.infer<typeof MotoboyDeliverySchema>

export const MotoboySettlementSchema = z.object({
  id: z.string(),
  amount: z.number(),
  payment_method: PaymentMethodSchema,
  paid_at: z.string(),
})
export type MotoboySettlement = z.infer<typeof MotoboySettlementSchema>

export const MotoboyFinanceiroSchema = z.object({
  pending_amount: z.number(),
  total_paid: z.number(),
  total_deliveries: z.number(),
  total_shipping: z.number(),
  avg_delivery_minutes: z.number(),
  deliveries: z.array(MotoboyDeliverySchema),
  settlements: z.array(MotoboySettlementSchema),
})
export type MotoboyFinanceiro = z.infer<typeof MotoboyFinanceiroSchema>

export const AdminMotoboyFinanceiroSchema = z.object({
  id: z.string(),
  name: z.string(),
  total_deliveries: z.number(),
  total_shipping: z.number(),
  pending_amount: z.number(),
  total_paid: z.number(),
  avg_delivery_minutes: z.number(),
})
export type AdminMotoboyFinanceiro = z.infer<typeof AdminMotoboyFinanceiroSchema>

export const MotoboyPendingSchema = z.object({
  pending_amount: z.number(),
  pending_deliveries: z.number().nullable(),
})
export type MotoboyPending = z.infer<typeof MotoboyPendingSchema>

export const MotoboyRunSchema = z.object({
  id: z.string(),
  status: z.enum(['ativo', 'concluido']),
  current_index: z.number(),
  order_ids: z.array(z.string()),
  motoboy_lat: z.number().nullable(),
  motoboy_lng: z.number().nullable(),
  motoboy_heading: z.number().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  orders: z.array(OrderSchema),
})
export type MotoboyRun = z.infer<typeof MotoboyRunSchema>

export const DeliveryPositionSchema = z.object({
  is_next_stop: z.boolean(),
  // Só vêm preenchidos quando is_next_stop é true — enquanto o motoboy
  // ainda está terminando outra entrega do lote, a posição dele fica
  // oculta pra esse pedido (mesma lógica do Uber/99: só mostra o
  // entregador quando ele já está a caminho de você).
  lat: z.number().optional(),
  lng: z.number().optional(),
  heading: z.number().nullable().optional(),
  updated_at: z.string().optional(),
})
export type DeliveryPosition = z.infer<typeof DeliveryPositionSchema>
