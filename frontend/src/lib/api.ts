import { authStore } from './authStore'

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = authStore.getToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua internet ou tente novamente em instantes.')
  }
  // Nota: um 401 aqui não implica sessão Supabase inválida (pode ser só
  // "conta ainda não fez bootstrap") — quem decide deslogar é o Supabase
  // (expiração/refresh falho), não esta camada.
  if (!res.ok) {
    let message = `Erro ${res.status}`
    try {
      const body = await res.json()
      message = body.error || message
    } catch {
      // sem corpo JSON
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type PlanoCode = 'essential' | 'management' | 'premium'
export type MetodoPagamento = 'pix' | 'cartao' | 'cartao_parcelado'

export interface BootstrapInput {
  loja_nome: string
  responsavel_nome: string
  whatsapp: string
  /** Senha em texto puro — vira Argon2 no backend só pro handoff do admin do tenant. */
  senha: string
}
export interface BootstrapOutput {
  id: string
  ja_existia: boolean
}

export interface AssinarPlanoInput {
  plano: PlanoCode
  metodo: MetodoPagamento
}
export interface AssinaturaCriada {
  id: string
  checkout_url: string | null
  pix_qr_code: string | null
  pix_qr_base64: string | null
}

export interface StatusAssinatura {
  status: 'sem_assinatura' | 'pendente' | 'ativo' | 'pausado' | 'cancelado'
  onboarding_status: 'aguardando_pagamento' | 'aguardando_onboarding' | 'provisionado'
}

export type FormaPagamento = 'manual' | 'plataforma'
export type PlataformaPagamento = 'mercado_pago' | 'abacate_pay'
export type TipoDocumento = 'cnpj' | 'cpf'

export interface MeResponse {
  id: string
  loja_nome: string
  responsavel_nome: string
  whatsapp: string
  email: string
  /** `null` = conta criada, ainda sem plano escolhido — mostrar CTA pra /planos. */
  plano: PlanoCode | null
  valor_mensal: number | null
  status: 'sem_assinatura' | 'pendente' | 'ativo' | 'pausado' | 'cancelado'
  gateway: string | null
  metodo_pagamento: string | null
  slug: string | null
  dominio: string | null
  onboarding_status: 'aguardando_pagamento' | 'aguardando_onboarding' | 'provisionado'
  tenant_id: string | null
  assinante_desde: string
  categoria: string | null
  endereco: string | null
  logo_url: string | null
  cor_principal: string | null
  documento: string | null
  tipo_documento: TipoDocumento | null
  vender_externamente: boolean
  whatsapp_habilitado: boolean
  forma_pagamento: FormaPagamento
  plataforma_pagamento: PlataformaPagamento | null
  proxima_cobranca: string | null
}

export interface OnboardingInput {
  nome_loja: string
  categoria: string
  whatsapp: string
  endereco: string
  logo_url?: string
  cor_principal: string
  banner_url?: string
  slug: string
  documento: string
  tipo_documento: TipoDocumento
  vender_externamente: boolean
  whatsapp_habilitado: boolean
  forma_pagamento: FormaPagamento
  plataforma_pagamento?: PlataformaPagamento
  plataforma_credenciais?: Record<string, string>
}
export interface OnboardingOutput {
  tenant_id: string
  slug: string
  admin_login_hint: string
}

export interface EditOnboardingInput {
  categoria?: string
  whatsapp?: string
  endereco?: string
  logo_url?: string
  cor_principal?: string
  documento?: string
  tipo_documento?: TipoDocumento
  vender_externamente?: boolean
  whatsapp_habilitado?: boolean
  forma_pagamento?: FormaPagamento
  plataforma_pagamento?: PlataformaPagamento
  plataforma_credenciais?: Record<string, string>
}

export const api = {
  bootstrap: (input: BootstrapInput) => request<BootstrapOutput>('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(input) }),

  assinarPlano: (input: AssinarPlanoInput) => request<AssinaturaCriada>('/api/assinaturas', { method: 'POST', body: JSON.stringify(input) }),
  statusAssinatura: (id: string) => request<StatusAssinatura>(`/api/assinaturas/${id}/status`),

  me: () => request<MeResponse>('/api/me'),
  mudarPlano: (novo_plano: PlanoCode) =>
    request<{ plano: PlanoCode }>('/api/me/plano', { method: 'POST', body: JSON.stringify({ novo_plano }) }),
  cancelar: () => request<{ status: string }>('/api/me/cancelar', { method: 'POST' }),

  onboarding: (input: OnboardingInput) => request<OnboardingOutput>('/api/onboarding', { method: 'POST', body: JSON.stringify(input) }),
  editarOnboarding: (input: EditOnboardingInput) =>
    request<{ updated: boolean }>('/api/onboarding', { method: 'PUT', body: JSON.stringify(input) }),
}
