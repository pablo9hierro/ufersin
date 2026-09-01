import { z } from 'zod'
import { api } from '../../lib/api'
import { validate } from '../validate'

const LoginResultSchema = z.object({
  token: z.string(),
  name: z.string(),
  // Backend multi-tenant sempre devolve; RPC/local demo podem omitir.
  tenant_slug: z.string().optional(),
})

// Módulo Perfil (staff) — login de admin/motoboy/vendedor. Único ponto do
// app autorizado a chamar `api.auth.*`.
export const authEndpoint = {
  adminLogin: async (email: string, password: string, tenantSlug?: string) =>
    validate(LoginResultSchema, await api.auth.adminLogin(email, password, tenantSlug), 'auth.adminLogin'),
  motoboyLogin: async (phone: string, password: string) => validate(LoginResultSchema, await api.auth.motoboyLogin(phone, password), 'auth.motoboyLogin'),
  vendedorLogin: async (phone: string, password: string) => validate(LoginResultSchema, await api.auth.vendedorLogin(phone, password), 'auth.vendedorLogin'),
  cozinhaLogin: async (phone: string, password: string) => validate(LoginResultSchema, await api.auth.cozinhaLogin(phone, password), 'auth.cozinhaLogin'),
  setAdminPassword: async (newPassword: string) => api.auth.setAdminPassword(newPassword),
}
