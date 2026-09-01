import { z } from 'zod'
import { PaymentMethodSchema } from './shared'
import { PaymentFrequencySchema } from './motoboy'

export const VendedorSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable().optional(),
  active: z.boolean(),
  commission_active: z.boolean(),
  commission_percent: z.number().nullable(),
  payment_frequency: PaymentFrequencySchema.nullable().optional(),
  payment_fixed_value: z.number().nullable().optional(),
})
export type Vendedor = z.infer<typeof VendedorSchema>

export const CozinhaUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable().optional(),
  active: z.boolean(),
})
export type CozinhaUser = z.infer<typeof CozinhaUserSchema>

export const PdvSaleItemInputSchema = z.object({
  product_id: z.string().optional(),
  service_id: z.string().optional(),
  quantity: z.number(),
})
export type PdvSaleItemInput = z.infer<typeof PdvSaleItemInputSchema>

export const PdvSaleSchema = z.object({
  id: z.string(),
  total: z.number(),
  payment_method: PaymentMethodSchema,
  customer_name: z.string(),
  created_at: z.string(),
  sold_by_role: z.enum(['admin', 'vendedor']),
  sold_by_id: z.string().nullable().optional(),
  sold_by_name: z.string().nullable().optional(),
  items: z.array(z.object({ product_name: z.string(), quantity: z.number(), unit_price: z.number() })),
})
export type PdvSale = z.infer<typeof PdvSaleSchema>

export const VendedorRelatorioSchema = z.object({
  total_sales: z.number(),
  total_count: z.number(),
  sales: z.array(PdvSaleSchema),
})
export type VendedorRelatorio = z.infer<typeof VendedorRelatorioSchema>
