import { productService } from '../services/productService'
import { categoryService } from '../services/categoryService'
import { couponService } from '../services/couponService'
import { useAsync } from './useAsync'

// /catalogo — carrega tudo que a tela precisa numa vez só (mesmo shape do
// Promise.all que existia antes na própria página): produtos, categorias,
// produtos em promoção (categoria "🔥 Promoção") e contagem de vendas
// (usada só pra ordenar por "mais vendido").
export function useCatalog() {
  return useAsync(async () => {
    const [products, categories, promos, salesCounts] = await Promise.all([
      productService.list(),
      categoryService.list(),
      couponService.listPromotionalProducts(),
      productService.salesCounts(),
    ])
    return { products, categories, promos, salesCounts }
  }, [])
}
