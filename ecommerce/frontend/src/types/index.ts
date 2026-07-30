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

import type { OrderStatus } from './shared'

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendente: 'Pendente',
  montando_pedido: 'Montando pedido',
  pedido_pronto: 'Pedido pronto',
  aguardando_localizacao: 'Aguardando localização',
  em_rota_de_entrega: 'Em rota de entrega',
  entregue: 'Entregue',
  retiradas: 'Aguardando retirada',
  concluido: 'Concluído',
}
