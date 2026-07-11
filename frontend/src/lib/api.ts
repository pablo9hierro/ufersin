export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua internet ou tente novamente em instantes.')
  }
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
  return res.json() as Promise<T>
}

export interface NovaAssinaturaInput {
  loja_nome: string
  responsavel_nome: string
  whatsapp: string
  email: string
}

export interface AssinaturaCriada {
  id: string
  checkout_url: string
}

export interface StatusAssinatura {
  status: 'pendente' | 'ativo' | 'pausado' | 'cancelado'
}

export const api = {
  criarAssinatura: (input: NovaAssinaturaInput) =>
    request<AssinaturaCriada>('/api/assinaturas', { method: 'POST', body: JSON.stringify(input) }),
  statusAssinatura: (id: string) => request<StatusAssinatura>(`/api/assinaturas/${id}/status`),
}
