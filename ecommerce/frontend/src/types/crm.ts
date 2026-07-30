import { z } from 'zod'
import { CampanhaOrientationSchema, CrmFilterCriteriaSchema } from './shared'
import { CouponSchema } from './coupon'

export const CrmSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  filter_criteria: CrmFilterCriteriaSchema,
  created_at: z.string(),
})
export type CrmSegment = z.infer<typeof CrmSegmentSchema>

// Cupom "extra" — a campanha pode entregar mais de um cupom junto com o
// principal (coupon_id), cada um com seu próprio código/desconto/prazo,
// mas todos ligados/desligados e concedidos juntos.
export const CrmCampanhaExtraCouponSchema = z.object({
  id: z.string(),
  coupon: CouponSchema,
  message_template: z.string(),
  // Critério "por evento" pra encerrar SÓ este cupom extra (decoupled do
  // segmento, mesmo mecanismo do gatilho) — null = sem encerramento
  // automático.
  end_criteria: CrmFilterCriteriaSchema.nullable(),
  // Agendamento de disparo — null = notifica na hora que concede (de
  // sempre). Preenchido = espera N dias (a partir da concessão) e só
  // dispara na hora configurada (0-23, horário de Brasília).
  schedule_delay_days: z.number().nullable(),
  schedule_hour: z.number().nullable(),
})
export type CrmCampanhaExtraCoupon = z.infer<typeof CrmCampanhaExtraCouponSchema>

export const CrmCampanhaCouponSchema = z.object({
  id: z.string(),
  segment_id: z.string(),
  // NULL até o primeiro cupom ser criado — campanha nasce só com
  // cadastro (nome/descrição/duração), gatilho e cupom(s) são passos
  // separados depois.
  coupon_id: z.string().nullable(),
  orientation: CampanhaOrientationSchema,
  name: z.string(),
  description: z.string().nullable(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  trigger_criteria: CrmFilterCriteriaSchema.nullable(),
  // Texto livre, só interno — anotação do admin sobre o gatilho.
  trigger_description: z.string().nullable().optional(),
  // Critério "por evento" pra encerrar a campanha INTEIRA (principal +
  // extras) — mesmo mecanismo do gatilho, decoupled do segmento.
  end_criteria: CrmFilterCriteriaSchema.nullable(),
  // Texto livre, só interno — anotação do admin sobre o gatilho de encerramento.
  end_description: z.string().nullable().optional(),
  message_template: z.string(),
  uses_per_customer: z.number(),
  active: z.boolean(),
  fired_at: z.string().nullable(),
  created_at: z.string(),
  extra_coupons: z.array(CrmCampanhaExtraCouponSchema),
  // Agendamento de disparo do cupom PRINCIPAL — mesma regra do extra
  // (ver CrmCampanhaExtraCoupon.schedule_delay_days).
  schedule_delay_days: z.number().nullable(),
  schedule_hour: z.number().nullable(),
  // "Retrato" do filter_criteria do segmento no momento em que o
  // trigger_criteria foi calibrado pela última vez (criação ou edição) —
  // compara com o filter_criteria ATUAL do segmento pra saber exatamente
  // quais campos mudaram desde então (campanha 'evento' desatualizada).
  last_synced_segment_criteria: CrmFilterCriteriaSchema.nullable(),
})
export type CrmCampanhaCoupon = z.infer<typeof CrmCampanhaCouponSchema>

export const CrmPurchaseEventSchema = z.object({
  product_id: z.string(),
  created_at: z.string(),
  quantity: z.number(),
})
export type CrmPurchaseEvent = z.infer<typeof CrmPurchaseEventSchema>

export const CrmOrderEventSchema = z.object({
  total: z.number(),
  created_at: z.string(),
})
export type CrmOrderEvent = z.infer<typeof CrmOrderEventSchema>

export const CrmCustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  whatsapp: z.string(),
  birthdate: z.string().nullable(),
  total_spent: z.number(),
  order_count: z.number(),
  total_items: z.number(),
  first_order_at: z.string().nullable(),
  last_order_at: z.string().nullable(),
  neighborhoods: z.array(z.string()),
  purchases: z.array(CrmPurchaseEventSchema),
  orders: z.array(CrmOrderEventSchema),
  // Calculada no servidor (as coordenadas da loja nunca saem do banco) —
  // distância até o endereço de entrega mais recente do cliente.
  distance_km: z.number().nullable(),
})
export type CrmCustomer = z.infer<typeof CrmCustomerSchema>
