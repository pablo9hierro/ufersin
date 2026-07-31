import { z } from 'zod'
import { api } from '../../lib/api'
import { validate } from '../validate'

const LoginResultSchema = z.object({ token: z.string(), name: z.string() })

// Módulo Perfil (staff) — login de admin/motoboy/vendedor. Único ponto do
// app autorizado a chamar `api.auth.*`.
export const authEndpoint = {
  adminLogin: async (email: string, password: string, tenantSlug?: string) =>
    validate(LoginResultSchema, await api.auth.adminLogin(email, password, tenantSlug), 'auth.adminLogin'),
  motoboyLogin: async (email: string, password: string) => validate(LoginResultSchema, await api.auth.motoboyLogin(email, password), 'auth.motoboyLogin'),
  vendedorLogin: async (email: string, password: string) => validate(LoginResultSchema, await api.auth.vendedorLogin(email, password), 'auth.vendedorLogin'),
  setAdminPassword: async (newPassword: string) => api.auth.setAdminPassword(newPassword),
}
