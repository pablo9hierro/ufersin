import { api } from '../../lib/api'
import { validate } from '../validate'
import { OrderSchema, VendedorRelatorioSchema, type PaymentMethod, type PdvSaleItemInput } from '../../types'

// Módulo PDV (venda de balcão) — acessível por admin OU vendedor, mesma
// sessão (useAdminAuth com role diferente). Único ponto do app
// autorizado a chamar `api.pdv.*`.
export const pdvEndpoint = {
  createSale: async (payload: {
    items: PdvSaleItemInput[]
    payment_method: PaymentMethod
    customer_name?: string
    customer_whatsapp?: string
    discount_type?: 'percent' | 'fixed'
    discount_value?: number
  }) => validate(OrderSchema, await api.pdv.createSale(payload), 'pdv.createSale'),
  notifySale: async (orderId: string) => api.pdv.notifySale(orderId),
  relatorio: async () => validate(VendedorRelatorioSchema, await api.pdv.relatorio(), 'pdv.relatorio'),
}
