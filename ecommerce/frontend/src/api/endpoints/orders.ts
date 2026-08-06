import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { DeliveryPositionSchema, OrderSchema, type DeliveryType, type PaymentMethod } from '../../types'

export interface CreateOrderPayload {
  customer_name: string
  customer_whatsapp: string
  /** Obrigatório só quando a loja tem `vende_mais_18`; senão opcional. */
  customer_birthdate?: string
  delivery_type: Extract<DeliveryType, 'entrega' | 'retirada'>
  neighborhood?: string
  address?: string
  reference_point?: string
  customer_lat?: number
  customer_lng?: number
  payment_method: PaymentMethod
  items: { product_id: string; quantity: number }[]
  coupon_code?: string
  promotion_id?: string
}

// Módulo Pedidos — único ponto do app autorizado a chamar `api.orders.*`,
// `api.trackDeliveryPosition` e a fatia de pedidos de `api.customerAuth.*`.
export const ordersEndpoint = {
  create: async (payload: CreateOrderPayload) => validate(OrderSchema, await api.orders.create(payload), 'orders.create'),
  get: async (id: string) => validate(OrderSchema, await api.orders.get(id), 'orders.get'),
  // Consulta pública por whatsapp (/consultar).
  track: async (whatsapp: string) => validateList(OrderSchema, await api.orders.track(whatsapp), 'orders.track'),
  trackDeliveryPosition: async (orderId: string) => {
    const data = await api.trackDeliveryPosition(orderId)
    return data ? validate(DeliveryPositionSchema, data, 'trackDeliveryPosition') : null
  },
  // Pix no ecommerce-api (Railway). `force` regenera QR (PDV).
  createPixPayment: async (id: string, force = false, customerEmail?: string) =>
    validate(
      OrderSchema,
      await api.orders.createPixPayment(id, force, customerEmail),
      'orders.createPixPayment',
    ),
  refreshPayment: async (id: string) => validate(OrderSchema, await api.orders.refreshPayment(id), 'orders.refreshPayment'),
  simulatePixPaid: async (id: string) => validate(OrderSchema, await api.orders.simulatePixPaid(id), 'orders.simulatePixPaid'),
  cancel: async (id: string, whatsapp: string) =>
    validate(OrderSchema, await api.orders.cancel(id, whatsapp), 'orders.cancel'),
  notifyCreated: async (orderId: string) => api.orders.notifyCreated(orderId),

  // /cliente/historico — pedidos do cliente logado.
  listMine: async (token: string) => validateList(OrderSchema, await api.customerAuth.listOrders(token), 'customerAuth.listOrders'),
}
