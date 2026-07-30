import { z } from 'zod'
import { OrderStatusSchema } from './shared'
import { OrderSchema } from './order'
import { AdminMotoboyFinanceiroSchema } from './motoboy'

export const StatusCountSchema = z.object({
  status: OrderStatusSchema,
  count: z.number(),
})
export type StatusCount = z.infer<typeof StatusCountSchema>

export const TopProductSchema = z.object({
  product_id: z.string(),
  product_name: z.string(),
  quantity_sold: z.number(),
  revenue: z.number(),
})
export type TopProduct = z.infer<typeof TopProductSchema>

export const FinanceiroTimeseriesPointSchema = z.object({
  date: z.string(),
  quantity_sold: z.number(),
  revenue: z.number(),
  orders_count: z.number(),
  coupon_orders: z.number(),
  coupon_discount: z.number(),
  promotion_orders: z.number(),
  promotion_discount: z.number(),
})
export type FinanceiroTimeseriesPoint = z.infer<typeof FinanceiroTimeseriesPointSchema>

export const FinanceiroSummarySchema = z.object({
  total_revenue: z.number(),
  // Soma de discount_amount + shipping_discount de pedidos pagos — quanto
  // foi "abrir mão da grana" em campanha/cupom. total_revenue já é líquido.
  total_discount_given: z.number(),
  total_orders: z.number(),
  orders_by_status: z.array(StatusCountSchema),
  top_products: z.array(TopProductSchema),
  recent_orders: z.array(OrderSchema),
  motoboys: z.array(AdminMotoboyFinanceiroSchema),
  avg_delivery_minutes: z.number(),
})
export type FinanceiroSummary = z.infer<typeof FinanceiroSummarySchema>
