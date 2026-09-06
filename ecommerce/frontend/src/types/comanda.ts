import { z } from 'zod'

export const ComandaItemSchema = z.object({
  id: z.string(),
  comanda_id: z.string(),
  product_id: z.string(),
  product_name: z.string(),
  unit_price: z.number(),
  quantity: z.number(),
})
export type ComandaItem = z.infer<typeof ComandaItemSchema>

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
})
export type Comanda = z.infer<typeof ComandaSchema>

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
