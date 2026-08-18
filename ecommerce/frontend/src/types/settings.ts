import { z } from 'zod'
import { DecorElementTypeSchema, PageKeySchema } from './shared'

export const ShippingSettingsSchema = z.object({
  price_per_km: z.number(),
  max_km: z.number().nullable(),
})
export type ShippingSettings = z.infer<typeof ShippingSettingsSchema>

export const BgSettingsSchema = z.object({
  bg_mode: z.enum(['svg1', 'synthwave', 'stars', 'custom']),
  bg_image_url: z.string().nullable(),
  bg_scale: z.number(),
  bg_x: z.number(),
  bg_y: z.number(),
  bg_fit: z.enum(['meet', 'slice']),
})
export type BgSettings = z.infer<typeof BgSettingsSchema>

// Fumaça do botão do carrinho — velocidade, quantidade de baforadas,
// largura do container (onde elas se espalham) e altura (distância que
// sobem), ajustável em /admin/conta.
export const SmokeSettingsSchema = z.object({
  smoke_speed: z.number(),
  smoke_count: z.number(),
  smoke_width: z.number(),
  smoke_height: z.number(),
})
export type SmokeSettings = z.infer<typeof SmokeSettingsSchema>

// Badges de texto da landing (hero) — lista livre + layout lado a lado
// ou empilhado + espaçamento, ajustável em /admin/conta.
export const LandingBadgeSchema = z.object({
  id: z.string(),
  text: z.string(),
  bold: z.boolean(),
})
export type LandingBadge = z.infer<typeof LandingBadgeSchema>

export const BadgesSettingsSchema = z.object({
  badges: z.array(LandingBadgeSchema),
  badges_layout: z.enum(['row', 'column']),
  badges_gap: z.number(),
  badges_offset_y: z.number(),
})
export type BadgesSettings = z.infer<typeof BadgesSettingsSchema>

// Layout por página de cliente (imagem de fundo + elementos decorativos
// de fumaça/fogo), editável em /admin/layout-cliente. x/y são % da área
// de referência (0-100) — a tela toda pras 5 páginas, ou a própria
// caixinha do botão de carrinho pro alvo especial 'cart_icon' — com a
// BASE do elemento ancorada nesse ponto (fumaça/fogo sobem a partir
// dele).
export const PageDecorationElementSchema = z.object({
  id: z.string(),
  type: DecorElementTypeSchema,
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  blur: z.number(),
  opacity: z.number(),
  speed: z.number(),
  count: z.number(),
})
export type PageDecorationElement = z.infer<typeof PageDecorationElementSchema>

export const PageDecorationSchema = z.object({
  page_key: PageKeySchema,
  background_image_url: z.string().nullable(),
  elements: z.array(PageDecorationElementSchema),
})
export type PageDecoration = z.infer<typeof PageDecorationSchema>

export const StoreHourIntervalSchema = z.object({
  opens_at: z.string(), // 'HH:MM', formato 24h (0-24)
  closes_at: z.string(),
})
export type StoreHourInterval = z.infer<typeof StoreHourIntervalSchema>

export const StoreHourDaySchema = z.object({
  day_of_week: z.number(), // 0=domingo .. 6=sábado
  is_open: z.boolean(),
  intervals: z.array(StoreHourIntervalSchema),
})
export type StoreHourDay = z.infer<typeof StoreHourDaySchema>

export const StoreStatusSchema = z.object({
  hours: z.array(StoreHourDaySchema),
  manually_closed: z.boolean(),
  manual_closed_reason: z.string().nullable(),
  onboarding_hours_done: z.boolean().optional(),
})
export type StoreStatus = z.infer<typeof StoreStatusSchema>

// Agendamento marcado pelo cliente (via Assistente IA) — CRUD real vive
// nas rotas públicas (ver ecommerce/backend/src/routes/public.rs); admin
// só lista e cancela.
export const AppointmentSchema = z.object({
  id: z.string(),
  customer_phone: z.string(),
  customer_name: z.string().nullable(),
  scheduled_at: z.string(),
  reason: z.string(),
  status: z.enum(['agendado', 'cancelado', 'concluido']),
})
export type Appointment = z.infer<typeof AppointmentSchema>

export const ShippingEstimateSchema = z.object({
  km: z.number(),
  price: z.number(),
  max_km: z.number().nullable(),
  within_range: z.boolean(),
})
export type ShippingEstimate = z.infer<typeof ShippingEstimateSchema>

// Formato exato varia entre versões da Evolution API — os campos abaixo
// cobrem as variações mais comuns; o componente que consome isso tenta
// vários caminhos possíveis em vez de confiar em um só. .catchall(unknown)
// deixa passar qualquer campo extra sem falhar a validação.
export const EvolutionStatusSchema = z
  .object({
    instance: z.object({ instanceName: z.string().optional(), state: z.string().optional() }).optional(),
    state: z.string().optional(),
  })
  .catchall(z.unknown())
export type EvolutionStatus = z.infer<typeof EvolutionStatusSchema>

export const EvolutionConnectSchema = z
  .object({
    base64: z.string().optional(),
    code: z.string().optional(),
    pairingCode: z.string().optional(),
    qrcode: z.object({ base64: z.string().optional(), code: z.string().optional(), pairingCode: z.string().optional() }).optional(),
  })
  .catchall(z.unknown())
export type EvolutionConnect = z.infer<typeof EvolutionConnectSchema>
