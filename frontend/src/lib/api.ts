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
  const token = authStore.getTokenForPath(path)
  let res: Response
  try {
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    }
    // Só força JSON quando há body string — upload multipart não usa Content-Type aqui.
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
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
export type BillingCycle = 'mensal' | 'semestral'

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
  /** mensal (default) | semestral (6 meses com 5% de desconto). */
  ciclo?: BillingCycle
  /** Cupom opcional — valor cobrado só no servidor. */
  cupom?: string
}
export interface AssinaturaCriada {
  id: string
  checkout_url: string | null
  pix_qr_code: string | null
  pix_qr_base64: string | null
  /** Homologação AbacatePay — permite simular pagamento. */
  sandbox?: boolean
  valor_mensal?: number
  valor_cobrado?: number
}

export interface PlatformPlan {
  code: PlanoCode
  name: string
  price_monthly: number
  tagline: string
  features: string[] | unknown
  highlight: boolean
  active: boolean
  sort_order: number
}

export interface PlatformContentItem {
  key: string
  value: string
}

export interface CouponPreview {
  code: string
  discount_type: 'fixed' | 'percent' | string
  discount_value: number
  duration_kind: string
  duration_days: number | null
  monthly_before: number
  monthly_after: number
}

export interface SuperadminWhoami {
  superadmin: true
  user_id: string
  email: string | null
}

export interface SuperadminOverview {
  lojas_ativas: number
  lojas_total: number
  mrr: number
  custos_mensais: number
  lucro_estimado: number
}

export interface SuperadminStore {
  id: string
  loja_nome: string
  email: string
  whatsapp: string
  slug: string | null
  plan_code: string | null
  valor_mensal: number | null
  status: string
  onboarding_status: string
  coupon_code: string | null
  created_at: string
}

export interface SuperadminCost {
  id: string
  label: string
  amount_monthly: number
  notes: string
  active: boolean
}

export interface SuperadminCoupon {
  id: string
  code: string
  discount_type: string
  discount_value: number
  duration_kind: string
  duration_days: number | null
  max_redemptions: number | null
  redemptions: number
  active: boolean
  notes: string
}

export interface StatusAssinatura {
  /** Runtime may still send EN variants (canceled/cancelled/paused); MeuPlano normalizes. */
  status: string
  onboarding_status: 'aguardando_pagamento' | 'aguardando_onboarding' | 'provisionado'
  sandbox?: boolean
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
  billing_cycle: BillingCycle
  /** Runtime may still send EN variants (canceled/cancelled/paused); MeuPlano normalizes. */
  status: string
  gateway: string | null
  metodo_pagamento: string | null
  slug: string | null
  dominio: string | null
  onboarding_status: 'aguardando_pagamento' | 'aguardando_onboarding' | 'provisionado'
  tenant_id: string | null
  assinante_desde: string
  categoria: string | null
  endereco: string | null
  endereco_numero: string | null
  logo_url: string | null
  cor_principal: string | null
  documento: string | null
  tipo_documento: TipoDocumento | null
  vender_externamente: boolean
  vende_mais_18: boolean
  /** Vitrine: só aceita retirada no local (sem entrega). */
  apenas_retirada: boolean
  /** Pagamento de pedidos de retirada só no ato da retirada na loja. */
  pagamento_na_retirada: boolean
  /** Entrega só com Pix já pago no checkout. */
  entrega_somente_pix: boolean
  /** Preferência: confirmação manual (sem QR Pix online). */
  pagamento_manual: boolean
  whatsapp_habilitado: boolean
  forma_pagamento: FormaPagamento
  plataforma_pagamento: PlataformaPagamento | null
  /** True when payment platform token is registered (never the secret). */
  has_plataforma_credenciais: boolean
  layout_style: 'ufersin' | 'burgerbite' | 'burgerhouse'
  instagram: string | null
  facebook: string | null
  coupon_code: string | null
  proxima_cobranca: string | null
  landing_headline: string | null
  landing_sub: string | null
  landing_badge: string | null
  /** Essential: rectangular hero image on landing (Management+ uses promo banners). */
  landing_hero_image_url: string | null
  cart_fab_style: 'sacola' | 'cart_icon'
  cart_fab_animate: boolean
  /** True se cancelar agora gera estorno automático (≤7 dias). */
  refund_eligible_on_cancel: boolean
}

export type ContractKind = 'platform_subscription' | 'checkout_compra_normal' | 'checkout_mais18'
/** E-sign PandaDoc — exclusivo do contrato lojista em /assinar. */
export type PlatformContractKind = 'platform_subscription'

export interface PandadocStatus {
  enabled: boolean
  sandbox: boolean
  platform_template_configured: boolean
  platform_signing_ready: boolean
  checkout_uses_pandadoc: boolean
  message: string
}

export interface ContractCatalogItem {
  kind: ContractKind
  title: string
  description: string | null
  version: number | null
  version_status: string | null
  pandadoc_ready: boolean
}

export interface OnboardingInput {
  nome_loja: string
  categoria?: string
  whatsapp?: string
  endereco: string
  endereco_numero?: string
  logo_url?: string
  cor_principal?: string
  banner_url?: string
  slug: string
  documento: string
  tipo_documento: TipoDocumento
  instagram?: string
  vender_externamente: boolean
  vende_mais_18?: boolean
  apenas_retirada?: boolean
  pagamento_na_retirada?: boolean
  entrega_somente_pix?: boolean
  pagamento_manual?: boolean
  whatsapp_habilitado: boolean
  forma_pagamento: FormaPagamento
  plataforma_pagamento?: PlataformaPagamento
  plataforma_credenciais?: Record<string, string>
  layout_style?: 'ufersin' | 'burgerbite' | 'burgerhouse'
}
export interface OnboardingOutput {
  tenant_id: string
  slug: string
  admin_login_hint: string
}

export interface EditOnboardingInput {
  nome_loja?: string
  categoria?: string
  whatsapp?: string
  endereco?: string
  endereco_numero?: string
  logo_url?: string
  cor_principal?: string
  documento?: string
  tipo_documento?: TipoDocumento
  instagram?: string
  facebook?: string
  vender_externamente?: boolean
  vende_mais_18?: boolean
  apenas_retirada?: boolean
  pagamento_na_retirada?: boolean
  entrega_somente_pix?: boolean
  pagamento_manual?: boolean
  whatsapp_habilitado?: boolean
  forma_pagamento?: FormaPagamento
  plataforma_pagamento?: PlataformaPagamento
  plataforma_credenciais?: Record<string, string>
  layout_style?: 'ufersin' | 'burgerbite' | 'burgerhouse'
  landing_headline?: string
  landing_sub?: string
  landing_badge?: string
  landing_hero_image_url?: string
  cart_fab_style?: 'sacola' | 'cart_icon'
  cart_fab_animate?: boolean
}

export type CancelReasonCode = 'unexpected' | 'found_better' | 'other'

export interface CancelarAssinaturaInput {
  confirm: boolean
  /** Must be exactly `quero cancelar` (case-sensitive). */
  confirm_phrase: string
  reasons: CancelReasonCode[]
  competitor_note?: string
  other_note?: string
  note?: string
}

export interface CancelarAssinaturaResult {
  status: string
  refund_eligible?: boolean
  refund_status?: string
  refund_id?: string | null
}

function normalizePlan(p: PlatformPlan): PlatformPlan {
  const features = Array.isArray(p.features)
    ? p.features.map(String)
    : typeof p.features === 'string'
      ? (() => {
          try {
            const j = JSON.parse(p.features as string)
            return Array.isArray(j) ? j.map(String) : []
          } catch {
            return []
          }
        })()
      : []
  return { ...p, features }
}

export const api = {
  bootstrap: (input: BootstrapInput) => request<BootstrapOutput>('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(input) }),

  assinarPlano: (input: AssinarPlanoInput) => request<AssinaturaCriada>('/api/assinaturas', { method: 'POST', body: JSON.stringify(input) }),
  statusAssinatura: (id: string) => request<StatusAssinatura>(`/api/assinaturas/${id}/status`),
  simularPagamento: () =>
    request<StatusAssinatura>('/api/assinaturas/simular-pagamento', { method: 'POST', body: '{}' }),
  cancelarPendente: () =>
    request<{ status: string }>('/api/assinaturas/cancelar-pendente', { method: 'POST', body: '{}' }),

  listPublicPlans: async () => {
    const rows = await request<PlatformPlan[]>('/api/public/plans')
    return rows.map(normalizePlan)
  },
  listPublicContent: () => request<PlatformContentItem[]>('/api/public/content'),
  previewCoupon: (code: string, plano: PlanoCode) =>
    request<CouponPreview>('/api/public/coupons/preview', {
      method: 'POST',
      body: JSON.stringify({ code, plano }),
    }),

  /** Gate do /dashboard — 403 se autenticado mas não é dono da plataforma. */
  superadminWhoami: () => request<SuperadminWhoami>('/api/superadmin/whoami'),
  superadminOverview: () => request<SuperadminOverview>('/api/superadmin/overview'),
  superadminStores: () => request<SuperadminStore[]>('/api/superadmin/stores'),
  superadminApplyStoreCoupon: (id: string, code: string) =>
    request<{ ok: boolean; code: string; valor_mensal: number }>(`/api/superadmin/stores/${id}/coupon`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  superadminPlans: async () => {
    const rows = await request<PlatformPlan[]>('/api/superadmin/plans')
    return rows.map(normalizePlan)
  },
  superadminCreatePlan: (body: {
    code: PlanoCode
    name: string
    price_monthly: number
    tagline?: string
    features?: string[]
    highlight?: boolean
    sort_order?: number
  }) => request<PlatformPlan>('/api/superadmin/plans', { method: 'POST', body: JSON.stringify(body) }),
  superadminUpdatePlan: (
    code: string,
    body: Partial<{ name: string; price_monthly: number; tagline: string; features: string[]; highlight: boolean; active: boolean }>,
  ) => request<PlatformPlan>(`/api/superadmin/plans/${code}`, { method: 'PUT', body: JSON.stringify(body) }),
  superadminUpsertContent: (key: string, value: string) =>
    request<{ ok: boolean }>('/api/superadmin/content', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  superadminCosts: () => request<SuperadminCost[]>('/api/superadmin/costs'),
  superadminCreateCost: (body: { label: string; amount_monthly: number; notes?: string }) =>
    request<SuperadminCost>('/api/superadmin/costs', { method: 'POST', body: JSON.stringify(body) }),
  superadminCoupons: () => request<SuperadminCoupon[]>('/api/superadmin/coupons'),
  superadminCreateCoupon: (body: {
    code: string
    discount_type: 'fixed' | 'percent'
    discount_value: number
    duration_kind: 'timed' | 'lifetime_current_plan'
    duration_days?: number | null
    max_redemptions?: number | null
    notes?: string
  }) => request<{ id: string; code: string }>('/api/superadmin/coupons', { method: 'POST', body: JSON.stringify(body) }),

  me: () => request<MeResponse>('/api/me'),
  uploadLogo: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<{ url: string }>('/api/me/upload-logo', { method: 'POST', body: fd })
  },
  mudarPlano: (novo_plano: PlanoCode) =>
    request<{ plano: PlanoCode }>('/api/me/plano', { method: 'POST', body: JSON.stringify({ novo_plano }) }),
  cancelar: (input: CancelarAssinaturaInput) =>
    request<CancelarAssinaturaResult>('/api/me/cancelar', { method: 'POST', body: JSON.stringify(input) }),

  onboarding: (input: OnboardingInput) => request<OnboardingOutput>('/api/onboarding', { method: 'POST', body: JSON.stringify(input) }),
  editarOnboarding: (input: EditOnboardingInput) =>
    request<{ updated: boolean }>('/api/onboarding', { method: 'PUT', body: JSON.stringify(input) }),

  getPandadocStatus: () => request<PandadocStatus>('/api/public/contratos/pandadoc/status'),
  contratosCatalog: () => request<ContractCatalogItem[]>('/api/public/contratos/catalog'),
  contratosAccept: (kind: ContractKind, channel = 'checkbox') =>
    request<{ id: string; kind: string; accepted: boolean }>('/api/contratos/accept', {
      method: 'POST',
      body: JSON.stringify({ kind, channel }),
    }),
  contratosMe: () =>
    request<
      Array<{
        id: string
        kind: string
        status: string
        pandadoc_share_link: string | null
        signed_at: string | null
      }>
    >('/api/contratos/me'),
  /** Só `platform_subscription` — checkout kinds usam checkbox no e-commerce. */
  contratosPandadocSession: (signer_email: string, signer_name?: string) =>
    request<{
      ready: boolean
      mode: string
      message: string
      session_id: string | null
      share_link: string | null
    }>('/api/contratos/pandadoc/session', {
      method: 'POST',
      body: JSON.stringify({ kind: 'platform_subscription' satisfies PlatformContractKind, signer_email, signer_name }),
    }),
}
