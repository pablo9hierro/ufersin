import { productService } from '../services/productService'
import { useAsync } from './useAsync'

// /catalogo — lista de produtos, opcionalmente filtrada por categoria.
export function useProducts(categoryId?: string) {
  return useAsync(() => productService.list(categoryId), [categoryId])
}

// /produto/:id
export function useProduct(id: string | undefined) {
  return useAsync(() => productService.get(id!), [id], { enabled: !!id })
}
