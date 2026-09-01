import { z } from 'zod'

export const PayrollAlertSchema = z.object({
  employee_role: z.enum(['motoboy', 'vendedor']),
  employee_id: z.string(),
  name: z.string(),
  amount: z.number(),
  due_at: z.string(),
  payment_id: z.string().nullable(),
})
export type PayrollAlert = z.infer<typeof PayrollAlertSchema>

export const PayrollPaymentSchema = z.object({
  id: z.string(),
  employee_role: z.enum(['motoboy', 'vendedor']),
  employee_id: z.string(),
  amount: z.number(),
  payment_method: z.string(),
  confirmed_by_employee: z.boolean(),
  confirmed_at: z.string().nullable(),
  created_at: z.string(),
})
export type PayrollPayment = z.infer<typeof PayrollPaymentSchema>
