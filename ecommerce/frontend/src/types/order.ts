import { z } from 'zod'
import { DeliveryTypeSchema, OrderStatusSchema, PaymentMethodSchema, PaymentStatusSchema } from './shared'

export const OrderItemSchema = z.object({
  id: z.string().optional(),
  product_id: z.string(),
  product_name: z.string(),
  unit_price: z.number(),
  quantity: z.number(),
})
export type OrderItem = z.infer<typeof OrderItemSchema>

export const OrderSchema = z.object({
  id: z.string(),
  customer_name: z.string(),
  customer_whatsapp: z.string(),
  delivery_type: DeliveryTypeSchema,
  neighborhood: z.string().nullable(),
  address: z.string().nullable(),
  reference_point: z.string().nullable().optional(),
  payment_method: PaymentMethodSchema,
  payment_status: PaymentStatusSchema,
  status: OrderStatusSchema,
  shipping_price: z.number(),
  total: z.number(),
  discount_amount: z.number().optional(),
  shipping_discount: z.number().optional(),
  coupon_code: z.string().nullable().optional(),
  promotion_id: z.string().nullable().optional(),
  motoboy_id: z.string().nullable(),
  motoboy_name: z.string().nullable().optional(),
  motoboy_whatsapp: z.string().nullable().optional(),
  // Origem do pedido — só vem preenchido pra admin/vendedor (admin_list_orders/
  // admin_update_order_status); nunca aparece pro cliente nem pro motoboy,
  // é controle interno de equipe.
  sold_by_role: z.enum(['admin', 'vendedor']).nullable().optional(),
  sold_by_id: z.string().nullable().optional(),
  sold_by_name: z.string().nullable().optional(),
  pix_payment_id: z.string().nullable().optional(),
  pix_qr_base64: z.string().nullable().optional(),
  pix_copia_cola: z.string().nullable().optional(),
  pix_provider: z.enum(['mercado_pago', 'abacate_pay', 'mock']).nullable().optional(),
  card_payment_mode: z.enum(['nfc', 'link', 'transparente']).nullable().optional(),
  card_payment_link_url: z.string().nullable().optional(),
  card_payment_charge_id: z.string().nullable().optional(),
  customer_lat: z.number().nullable().optional(),
  customer_lng: z.number().nullable().optional(),
  motoboy_paid_at: z.string().nullable().optional(),
  delivery_started_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  cancel_reason: z.string().nullable().optional(),
  cancel_by: z.enum(['cliente', 'admin']).nullable().optional(),
  cancel_note: z.string().nullable().optional(),
  canceled_at: z.string().nullable().optional(),
  refund_status: z
    .enum(['none', 'not_applicable', 'pending', 'refunded', 'refund_failed'])
    .nullable()
    .optional(),
  refund_id: z.string().nullable().optional(),
  items: z.array(OrderItemSchema),
  created_at: z.string(),
  updated_at: z.string().optional(),
})
export type Order = z.infer<typeof OrderSchema>
