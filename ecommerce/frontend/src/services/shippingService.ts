import { shippingEndpoint } from '../api/endpoints/shipping'

export const shippingService = {
  getSettings: shippingEndpoint.getSettings,
  estimate: shippingEndpoint.estimate,
}
