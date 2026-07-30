import { promotionsEndpoint } from '../api/endpoints/promotions'

export const promotionService = {
  listActive: promotionsEndpoint.listActive,
  get: promotionsEndpoint.get,
}
