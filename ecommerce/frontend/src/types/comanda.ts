import { z } from 'zod'

export const ComandaItemSchema = z.object({
  id: z.string(),
  comanda_id: z.string(),
  product_id: z.string(),
  product_name: z.string(),
  unit_price: z.number(),
  quantity: z.number(),
  // Impressão térmica -> cozinha (Etapa 4): preenchido quando o item já foi
  // mandado no cupom da cozinha (`print-kitchen-ticket`).
  sent_to_kitchen_at: z.string().nullable(),
})
export type ComandaItem = z.infer<typeof ComandaItemSchema>

export const KitchenTicketStatusSchema = z.enum(['nenhum', 'pendente', 'pronto'])
export type KitchenTicketStatus = z.infer<typeof KitchenTicketStatusSchema>

export const ComandaSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['aberta', 'fechada']),
  created_at: z.string(),
  items: z.array(ComandaItemSchema),
  total: z.number(),
  // Optimistic locking -- reenviar em toda escrita seguinte
  // (add/remove/replace/pay item) como `expected_version`; se o backend
  // recusar por versão desatualizada, recarregar a comanda antes de tentar
  // de novo (outra pessoa mexeu nela nesse meio tempo).
  version: z.number(),
  kitchen_ticket_status: KitchenTicketStatusSchema,
})
export type Comanda = z.infer<typeof ComandaSchema>

export const KitchenTicketItemSchema = z.object({
  product_name: z.string(),
  quantity: z.number(),
})

export const KitchenTicketSchema = z.object({
  comanda_id: z.string(),
  comanda_label: z.string(),
  employee_name: z.string(),
  items: z.array(KitchenTicketItemSchema),
})
export type KitchenTicket = z.infer<typeof KitchenTicketSchema>

/** Mesa de restaurante (Parte 3, `tenantConfig.usa_mesas`). Abrir a comanda
 * de uma mesa gera um código automático -- comanda avulsa (sem mesa)
 * continua com nome livre, sem relação com isto. */
export const RestaurantTableSchema = z.object({
  id: z.string(),
  numero: z.string(),
  status: z.enum(['livre', 'ocupada']),
  comanda_id: z.string().nullable(),
})
export type RestaurantTable = z.infer<typeof RestaurantTableSchema>

export const ComandaHistoryEntrySchema = z.object({
  id: z.string(),
  employee_role: z.string(),
  employee_id: z.string(),
  action: z.string(),
  item_id: z.string().nullable(),
  old_value: z.unknown().nullable(),
  new_value: z.unknown().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
})
export type ComandaHistoryEntry = z.infer<typeof ComandaHistoryEntrySchema>
