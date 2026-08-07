import { orderService } from './orderService'
import { api } from '../lib/api'

// Cartão via Mercado Pago — NFC (confirmação manual, só PDV), link de
// pagamento (Checkout Pro) e cartão tokenizado (Checkout Transparente).
export const cardPaymentService = {
  getPublicKey: async () => (await api.mpPublicKey.get()).public_key,
  createLink: orderService.createCardLink,
  charge: orderService.createCardPayment,
}
