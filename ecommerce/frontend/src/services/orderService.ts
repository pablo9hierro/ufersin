import { ordersEndpoint, type CreateOrderPayload } from '../api/endpoints/orders'

export type { CreateOrderPayload }

// Módulo Pedidos — checkout, consulta pública, rastreio de entrega, Pix e
// histórico do cliente logado.
export const orderService = {
  create: ordersEndpoint.create,
  get: ordersEndpoint.get,
  track: ordersEndpoint.track,
  trackDeliveryPosition: ordersEndpoint.trackDeliveryPosition,
  createPixPayment: (id: string, force = false) => ordersEndpoint.createPixPayment(id, force),
  refreshPayment: ordersEndpoint.refreshPayment,
  simulatePixPaid: ordersEndpoint.simulatePixPaid,
  cancel: ordersEndpoint.cancel,
  notifyCreated: ordersEndpoint.notifyCreated,
  listMine: ordersEndpoint.listMine,
}
