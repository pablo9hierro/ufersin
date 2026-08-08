import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { OrderSchema, ProductSchema, VendedorRelatorioSchema, type PaymentMethod, type PdvSaleItemInput } from '../../types'

// Módulo PDV (venda de balcão) — acessível por admin OU vendedor, mesma
// sessão (useAdminAuth com role diferente). Único ponto do app
// autorizado a chamar `api.pdv.*`.
export const pdvEndpoint = {
  listProducts: async () => validateList(ProductSchema, await api.pdv.listProducts(), 'pdv.listProducts'),
  createSale: async (payload: {
    items: PdvSaleItemInput[]
    payment_method: PaymentMethod
    customer_name?: string
    customer_whatsapp?: string
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
    /** Só pra payment_method='cartao': omitido/'nfc' = nasce pago (de sempre); 'link'/'transparente' = nasce pendente. */
    card_payment_mode?: 'nfc' | 'link' | 'transparente'
  }) => validate(OrderSchema, await api.pdv.createSale(payload), 'pdv.createSale'),
  notifySale: async (orderId: string) => api.pdv.notifySale(orderId),
  notifyPixCharge: async (orderId: string) => api.pdv.notifyPixCharge(orderId),
  notifyCardCharge: async (orderId: string, whatsapp: string, linkUrl?: string, checkoutUrl?: string) =>
    api.pdv.notifyCardCharge(orderId, whatsapp, linkUrl, checkoutUrl),
  relatorio: async () => validate(VendedorRelatorioSchema, await api.pdv.relatorio(), 'pdv.relatorio'),
}
