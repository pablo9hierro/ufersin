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
  // "manual" | "erp_formulation" — produto ERP tem quantity/cost_price
  // SEMPRE calculados a partir da formulação (ver AdminProdutosFormulacao),
  // nunca editáveis à mão. Opcional só pra não quebrar schemas antigos que
  // ainda não passaram por esse campo (backend sempre manda, na prática).
  origin_type: z.enum(['manual', 'erp_formulation']).optional(),
})
export type Product = z.infer<typeof ProductSchema>

// ---------- ERP Formulação (insumos / ficha técnica) ----------

export const IngredientSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'un']),
  quantity: z.number(),
  cost_price: z.number(),
})
export type Ingredient = z.infer<typeof IngredientSchema>

export type IngredientPayload = {
  name: string
  unit: Ingredient['unit']
  quantity: number
  cost_price: number
}

export type FormulationLinePayload = {
  ingredient_id: string
  quantity: number
  unit: Ingredient['unit']
}

/** Corpo de criar/editar um produto ERP — mesmos campos comerciais de
 * `Product` (menos `quantity`, sempre recalculado) + a lista de insumos. */
export type FormulatedProductPayload = {
  name: string
  description?: string | null
  price: number
  quantity: number // ignorado pelo backend p/ produto ERP, mas o campo é exigido
  image_url?: string | null
  category_id?: string | null
  active?: boolean
  cost_price?: number | null
  low_stock_threshold?: number | null
  barcode?: string | null
  formulation: FormulationLinePayload[]
}

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
