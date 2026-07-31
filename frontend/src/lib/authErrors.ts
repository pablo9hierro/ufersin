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
  'For security purposes, you can only request this after some seconds.':
    'Por segurança, aguarde alguns segundos antes de tentar de novo.',
  'Failed to fetch': 'Não foi possível conectar ao servidor de autenticação. Tente de novo em instantes.',
  'NetworkError when attempting to fetch resource.': 'Falha de rede ao autenticar. Verifique sua conexão.',
  'email rate limit exceeded':
    'Muitos e-mails enviados em pouco tempo. Aguarde cerca de uma hora e tente novamente.',
  'over_email_send_rate_limit':
    'Muitos e-mails enviados em pouco tempo. Aguarde cerca de uma hora e tente novamente.',
  'over_request_rate_limit':
    'Muitas tentativas em pouco tempo. Por segurança, aguarde cerca de uma hora e tente novamente.',
  'Too many requests':
    'Muitas tentativas em pouco tempo. Por segurança, aguarde cerca de uma hora e tente novamente.',
}

const RATE_LIMIT_MSG =
  'Muitas tentativas em pouco tempo. Por segurança, aguarde cerca de uma hora e tente novamente.'

export function translateAuthError(message: string) {
  if (MESSAGES[message]) return MESSAGES[message]
  const lower = message.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return MESSAGES['Failed to fetch']
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('too many') ||
    lower.includes('over_request_rate_limit') ||
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('429')
  ) {
    return RATE_LIMIT_MSG
  }
  return message
}

export function isRateLimitError(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('rate limit') ||
    lower.includes('too many') ||
    lower.includes('over_request_rate_limit') ||
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('429')
  )
}
