import { siteSettingsEndpoint } from '../api/endpoints/siteSettings'
export type { SiteSettings } from '../api/endpoints/siteSettings'

export const siteSettingsService = {
  get: siteSettingsEndpoint.get,
}
