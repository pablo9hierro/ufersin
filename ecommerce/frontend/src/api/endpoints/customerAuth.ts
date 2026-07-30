import { api } from '../../lib/api'
import { validate } from '../validate'
import { CustomerAuthResultSchema, CustomerSchema } from '../../types'

export interface RegisterPayload {
  whatsapp: string
  password: string
  name: string
  email: string
  birthdate: string
}

// Módulo Perfil (conta do cliente) — único ponto do app autorizado a
// chamar a fatia de autenticação de `api.customerAuth.*`.
export const customerAuthEndpoint = {
  register: async (payload: RegisterPayload) => validate(CustomerAuthResultSchema, await api.customerAuth.register(payload), 'customerAuth.register'),
  login: async (whatsapp: string, password: string) => validate(CustomerAuthResultSchema, await api.customerAuth.login(whatsapp, password), 'customerAuth.login'),
  me: async (token: string) => validate(CustomerSchema, await api.customerAuth.me(token), 'customerAuth.me'),
  requestPasswordReset: async (whatsapp: string) => api.customerAuth.requestPasswordReset(whatsapp),
  verifyResetCode: async (whatsapp: string, code: string) => api.customerAuth.verifyResetCode(whatsapp, code),
  resetPassword: async (whatsapp: string, code: string, newPassword: string) => api.customerAuth.resetPassword(whatsapp, code, newPassword),
}
