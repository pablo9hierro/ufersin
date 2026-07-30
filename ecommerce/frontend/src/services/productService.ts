import { productsEndpoint } from '../api/endpoints/products'

// Módulo Produtos — é isto (nunca lib/api) que páginas/componentes devem
// importar.
export const productService = {
  list: productsEndpoint.list,
  get: productsEndpoint.get,
  salesCounts: productsEndpoint.salesCounts,
}
