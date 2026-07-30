import { z } from 'zod'
import { api } from '../../lib/api'
import { validate } from '../validate'
import { BadgesLayoutSchema, BgFitSchema, BgModeSchema, CarouselStyleSchema, LandingBadgeSchema } from '../../types'

// Shape público de siteSettings — combina hero/bg/fumaça/badges/carrossel
// num payload só (ver lib/supabasePublicApi.ts siteSettings.get).
const SiteSettingsSchema = z.object({
  hero_image_url: z.string().nullable(),
  carousel_style: CarouselStyleSchema,
  bg_mode: BgModeSchema,
  bg_image_url: z.string().nullable(),
  bg_scale: z.number(),
  bg_x: z.number(),
  bg_y: z.number(),
  bg_fit: BgFitSchema,
  smoke_speed: z.number(),
  smoke_count: z.number(),
  smoke_width: z.number(),
  smoke_height: z.number(),
  badges: z.array(LandingBadgeSchema),
  badges_layout: BadgesLayoutSchema,
  badges_gap: z.number(),
  badges_offset_y: z.number(),
})
export type SiteSettings = z.infer<typeof SiteSettingsSchema>

// Módulo Configurações (público) — único ponto do app autorizado a chamar
// `api.siteSettings.*`.
export const siteSettingsEndpoint = {
  get: async () => validate(SiteSettingsSchema, await api.siteSettings.get(), 'siteSettings.get'),
}
