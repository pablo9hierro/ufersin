/** Normaliza o status de entrega terceirizada (Uber Direct) pro admin. */
export const ADMIN_DELIVERY_STATUS_LABEL: Record<string, string> = {
  quote_requested: 'Cotando…',
  created: 'Criada',
  courier_assigned: 'Entregador designado',
  en_route_to_pickup: 'A caminho da loja',
  picked_up: 'Coletada',
  en_route_to_dropoff: 'A caminho do cliente',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
  failed: 'Falhou',
}

/** Mesma normalização, texto voltado pro cliente em /consultar. */
export const CUSTOMER_DELIVERY_STATUS_LABEL: Record<string, string> = {
  quote_requested: 'Preparando a entrega…',
  created: 'Entrega criada',
  courier_assigned: 'Entregador a caminho da loja',
  en_route_to_pickup: 'Entregador a caminho da loja',
  picked_up: 'Entregador coletou seu pedido',
  en_route_to_dropoff: 'A caminho de você',
  delivered: 'Entregue',
  cancelled: 'Entrega cancelada',
  failed: 'Entrega não pôde ser despachada',
}

export function labelDeliveryStatus(map: Record<string, string>, status: string): string {
  return map[status] ?? status
}
