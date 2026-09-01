import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { ComandaSchema, OrderSchema, ProductSchema, VendedorRelatorioSchema, type PaymentMethod, type PdvSaleItemInput } from '../../types'

// Módulo PDV (venda de balcão) — acessível por admin OU vendedor, mesma
// sessão (useAdminAuth com role diferente). Único ponto do app
// autorizado a chamar `api.pdv.*`.
export const pdvEndpoint = {
  listProducts: async () => validateList(ProductSchema, await api.pdv.listProducts(), 'pdv.listProducts'),
  // Sem zod aqui de propósito: mesmo shape leve (PublicService) já usado
  // sem validação na vitrine pública (serviceService.ts), fonte é o mesmo endpoint.
  listServices: async () => api.pdv.listServices(),
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
  comandas: {
    list: async () => validateList(ComandaSchema, await api.pdv.comandas.list(), 'pdv.comandas.list'),
    create: async (label: string) => validate(ComandaSchema, await api.pdv.comandas.create(label), 'pdv.comandas.create'),
    get: async (id: string) => validate(ComandaSchema, await api.pdv.comandas.get(id), 'pdv.comandas.get'),
    addItem: async (id: string, productId: string, quantity: number) =>
      validate(ComandaSchema, await api.pdv.comandas.addItem(id, productId, quantity), 'pdv.comandas.addItem'),
    removeItem: async (id: string, itemId: string) =>
      validate(ComandaSchema, await api.pdv.comandas.removeItem(id, itemId), 'pdv.comandas.removeItem'),
    pay: async (
      id: string,
      payload: { payment_method: PaymentMethod; card_payment_mode?: 'nfc' | 'link' | 'transparente'; card_type?: string; card_installments?: number },
    ) => validate(OrderSchema, await api.pdv.comandas.pay(id, payload), 'pdv.comandas.pay'),
  },
}
