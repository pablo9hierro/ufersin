import { authEndpoint } from '../api/endpoints/auth'
import { customerAuthEndpoint, type RegisterPayload } from '../api/endpoints/customerAuth'

export type { RegisterPayload }

// Módulo Perfil — sessão do cliente (whatsapp+senha) e login de
// admin/motoboy/vendedor (staff).
export const authService = {
  customer: {
    register: customerAuthEndpoint.register,
    login: customerAuthEndpoint.login,
    me: customerAuthEndpoint.me,
    requestPasswordReset: customerAuthEndpoint.requestPasswordReset,
    verifyResetCode: customerAuthEndpoint.verifyResetCode,
    resetPassword: customerAuthEndpoint.resetPassword,
  },
  staff: {
    adminLogin: authEndpoint.adminLogin,
    motoboyLogin: authEndpoint.motoboyLogin,
    vendedorLogin: authEndpoint.vendedorLogin,
    cozinhaLogin: authEndpoint.cozinhaLogin,
    setAdminPassword: authEndpoint.setAdminPassword,
  },
}
