import { z } from 'zod'
import { DiscountTypeSchema } from './shared'

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type Category = z.infer<typeof CategorySchema>

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  quantity: z.number(),
  image_url: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable().optional(),
  active: z.boolean().optional(),
  barcode: z.string().nullable().optional(),
  // Custo de aquisição (pra estoque valorizado a custo + markup) e
  // ponto de reposição (quantidade em estoque que, ao ser atingida,
  // entra na lista "precisa repor" de /admin/produtos) -- ambos
  // opcionais, nunca aparecem/contam pro cliente final.
  cost_price: z.number().nullable().optional(),
  low_stock_threshold: z.number().nullable().optional(),
})
export type Product = z.infer<typeof ProductSchema>

export const ProductDiscountSchema = z.object({
  product_id: z.string(),
  discount_type: DiscountTypeSchema,
  discount_value: z.number(),
  // Só existe no client — marca que esse produto entrou na lista via
  // seleção de categoria inteira (pra agrupar visualmente como "Categoria:
  // X" com um desconto só). O backend ignora esse campo, sempre grava
  // linha por produto.
  category_id: z.string().optional(),
})
export type ProductDiscount = z.infer<typeof ProductDiscountSchema>
