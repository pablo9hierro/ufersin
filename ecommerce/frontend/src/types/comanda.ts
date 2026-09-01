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
})
export type Comanda = z.infer<typeof ComandaSchema>
