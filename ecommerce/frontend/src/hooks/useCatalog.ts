import { productService } from '../services/productService'
import { categoryService } from '../services/categoryService'
import { couponService } from '../services/couponService'
import { useAsync } from './useAsync'

// /catalogo — carrega tudo que a tela precisa numa vez só (mesmo shape do
// Promise.all que existia antes na própria página): produtos, categorias,
// produtos em promoção (categoria "Promo") e contagem de vendas
// (usada só pra ordenar por "mais vendido").
//
// Promos/salesCounts podem falhar pra tenant Railway (RPC Supabase 406) —
// nao podem derrubar o catalogo quando products.list ja retornou (uiux2/4).
export function useCatalog() {
  return useAsync(async () => {
    const [products, categories, promos, salesCounts] = await Promise.all([
      productService.list(),
      categoryService.list(),
      couponService.listPromotionalProducts().catch(() => []),
      productService.salesCounts().catch(() => []),
    ])
    return { products, categories, promos, salesCounts }
  }, [])
}
