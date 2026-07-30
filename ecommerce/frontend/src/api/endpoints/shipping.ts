import { api } from '../../lib/api'
import { validate } from '../validate'
import { ShippingEstimateSchema, ShippingSettingsSchema } from '../../types'

// Módulo Frete — único ponto do app autorizado a chamar
// `api.shippingSettings.*` / `api.estimateShipping`.
export const shippingEndpoint = {
  getSettings: async () => validate(ShippingSettingsSchema, await api.shippingSettings.get(), 'shippingSettings.get'),
  estimate: async (lat: number, lng: number) => validate(ShippingEstimateSchema, await api.estimateShipping(lat, lng), 'estimateShipping'),
}
