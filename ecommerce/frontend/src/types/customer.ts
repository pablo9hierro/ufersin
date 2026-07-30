import { z } from 'zod'

// Conta de cliente (login por whatsapp+senha de 4 dígitos) — desacoplada
// do rascunho de checkout em store/customer.ts (esse é só o formulário,
// não exige login pra existir).
export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  whatsapp: z.string(),
  email: z.string().nullable(),
  birthdate: z.string().nullable(),
})
export type Customer = z.infer<typeof CustomerSchema>

export const CustomerAuthResultSchema = z.object({
  token: z.string(),
  customer: CustomerSchema,
})
export type CustomerAuthResult = z.infer<typeof CustomerAuthResultSchema>
