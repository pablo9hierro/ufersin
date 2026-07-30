import { z } from 'zod'
import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { MotoboyFinanceiroSchema, MotoboyRunSchema, OrderSchema } from '../../types'

const OrderCountsSchema = z.record(z.string(), z.number())

// Módulo do dashboard do motoboy — único ponto do app autorizado a
// chamar `api.motoboy.*`.
export const motoboyEndpoint = {
  orders: {
    list: async (status: string) => validateList(OrderSchema, await api.motoboy.orders.list(status), 'motoboy.orders.list'),
    counts: async () => validate(OrderCountsSchema, await api.motoboy.orders.counts(), 'motoboy.orders.counts'),
  },
  runs: {
    active: async () => {
      const data = await api.motoboy.runs.active()
      return data ? validate(MotoboyRunSchema, data, 'motoboy.runs.active') : null
    },
    start: async (orderIds: string[]) => validate(MotoboyRunSchema, await api.motoboy.runs.start(orderIds), 'motoboy.runs.start'),
    updatePosition: async (lat: number, lng: number, heading?: number | null) => api.motoboy.runs.updatePosition(lat, lng, heading),
    completeCurrent: async (paymentConfirmed?: boolean) => validate(MotoboyRunSchema, await api.motoboy.runs.completeCurrent(paymentConfirmed), 'motoboy.runs.completeCurrent'),
  },
  financeiro: {
    get: async () => validate(MotoboyFinanceiroSchema, await api.motoboy.financeiro.get(), 'motoboy.financeiro.get'),
  },
  whatsapp: {
    status: async () => api.motoboy.whatsapp.status(),
    connect: async () => api.motoboy.whatsapp.connect(),
    logout: async () => api.motoboy.whatsapp.logout(),
    notifyEnRoute: async (orderId: string) => api.motoboy.whatsapp.notifyEnRoute(orderId),
  },
}
