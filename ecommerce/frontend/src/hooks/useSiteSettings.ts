import { siteSettingsService } from '../services/siteSettingsService'
import { useAsync } from './useAsync'

export function useSiteSettings() {
  return useAsync(() => siteSettingsService.get(), [])
}
