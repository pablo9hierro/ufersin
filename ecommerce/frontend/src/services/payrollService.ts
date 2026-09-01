import { payrollEndpoint } from '../api/endpoints/payroll'

// Autoatendimento de pagamento fixo (motoboy ou vendedor) — é isto (nunca
// lib/api) que os componentes desses dois papéis devem importar.
export const payrollService = payrollEndpoint
