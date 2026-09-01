// Barrel central de tipos — substitui lib/types.ts. Cada tipo é derivado
// (z.infer) de um schema Zod em vez de uma interface escrita à mão em
// paralelo: o schema É o contrato (ver src/api/endpoints, que valida toda
// resposta contra ele antes de devolver pra service/hook).
export * from './shared'
export * from './product'
export * from './coupon'
export * from './customer'
export * from './promotion'
export * from './order'
export * from './crm'
export * from './motoboy'
export * from './vendedor'
export * from './settings'
export * from './financeiro'
export * from './payroll'
export * from './comanda'

import type { OrderStatus } from './shared'

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendente: 'Pendente',
  montando_pedido: 'Montando pedido',
  pedido_pronto: 'Pedido pronto',
  aguardando_localizacao: 'Aguardando localização',
  em_rota_de_entrega: 'Em rota de entrega',
  entregue: 'Entregue',
  retiradas: 'Aguardando retirada',
  entregas: 'Aguardando entrega',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
}

/** Customer may cancel only before "saiu para entrega" (em_rota / entregas). */
export function customerCanCancelOrder(status: OrderStatus): boolean {
  return !['em_rota_de_entrega', 'entregas', 'entregue', 'concluido', 'cancelado'].includes(status)
}

/** Merchant may cancel any status except concluido / cancelado. */
export function adminCanCancelOrder(status: OrderStatus): boolean {
  return status !== 'concluido' && status !== 'cancelado'
}
