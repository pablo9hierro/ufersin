// Mensagens de erro do Supabase Auth vêm em inglês — traduz as mais comuns
// pra manter a UX do resto do app (tudo em pt-BR). Mensagens sem tradução
// conhecida passam direto (melhor mostrar o erro real em inglês do que
// esconder o que aconteceu).
const MESSAGES: Record<string, string> = {
  'User already registered': 'Já existe uma conta com esse e-mail — faça login.',
  'Invalid login credentials': 'E-mail ou senha inválidos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.',
  'Password should be at least 6 characters': 'A senha precisa ter pelo menos 8 caracteres.',
  'Signup requires a valid password': 'Informe uma senha válida.',
  'For security purposes, you can only request this after some seconds.': 'Aguarde alguns segundos antes de tentar de novo.',
  'Failed to fetch': 'Não foi possível conectar ao servidor de autenticação. Tente de novo em instantes.',
  'NetworkError when attempting to fetch resource.': 'Falha de rede ao autenticar. Verifique sua conexão.',
}

export function translateAuthError(message: string) {
  if (MESSAGES[message]) return MESSAGES[message]
  const lower = message.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return MESSAGES['Failed to fetch']
  }
  return message
}
