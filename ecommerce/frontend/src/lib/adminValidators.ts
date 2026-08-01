/** Admin password change rules (Configurações / AdminSenha). */
export function validatePasswordChange(newPassword: string, confirmPassword: string): string | null {
  if (newPassword !== confirmPassword) return 'A confirmação não confere com a nova senha.'
  if (newPassword.length < 6) return 'A nova senha precisa ter pelo menos 6 caracteres.'
  return null
}

export function validateAdminLoginFields(email: string, password: string): string | null {
  if (!email.trim()) return 'Informe o e-mail.'
  if (!password) return 'Informe a senha.'
  return null
}
