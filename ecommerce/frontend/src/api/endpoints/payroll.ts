import { api } from '../../lib/api'
import { validateList } from '../validate'
import { PayrollPaymentSchema } from '../../types'

// Autoatendimento (motoboy ou vendedor logado) — pagamentos fixos que o
// admin já reportou e ainda aguardam minha confirmação.
export const payrollEndpoint = {
  myPending: async () => validateList(PayrollPaymentSchema, await api.payroll.myPending(), 'payroll.myPending'),
  confirm: async (id: string) => api.payroll.confirm(id),
}
