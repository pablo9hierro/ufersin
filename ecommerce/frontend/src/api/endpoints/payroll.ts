import { z } from 'zod'
import { api } from '../../lib/api'
import { validate, validateList } from '../validate'
import { PayrollAlertPreviewSchema, PayrollPaymentSchema } from '../../types'

const EmployeeNotificationSchema = z.object({
  id: z.string(),
  message: z.string(),
  created_at: z.string(),
})

// Autoatendimento (motoboy ou vendedor logado) — pagamentos fixos que o
// admin já reportou e ainda aguardam minha confirmação.
export const payrollEndpoint = {
  myPending: async () => validateList(PayrollPaymentSchema, await api.payroll.myPending(), 'payroll.myPending'),
  confirm: async (id: string) => api.payroll.confirm(id),
  // Parte 2 -- "próximo pagamento" antes de qualquer report do admin (null
  // quando o modelo é comissão ou não há fixo configurado).
  myNext: async () => {
    const data = await api.payroll.myNext()
    return data ? validate(PayrollAlertPreviewSchema, data, 'payroll.myNext') : null
  },
  // Avisos de convite (boas-vindas, log de cadastro) -- isolado do fluxo de
  // OTP de cliente, mesmo espírito de myPending acima.
  myNotifications: async () =>
    validateList(EmployeeNotificationSchema, await api.staffEmployeeNotifications(), 'payroll.myNotifications'),
}
