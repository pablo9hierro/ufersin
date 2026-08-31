import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  Palette,
  Save,
  Share2,
  Sparkles,
  Store,
  Upload,
  X,
} from 'lucide-react'
import {
  api,
  ApiError,
  type BillingCycle,
  type CancelReasonCode,
  type MeResponse,
} from '../lib/api'
import { authStore, useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { fetchPlans, formatBRL, getPlanMap, planDisplayName, priceForCycle } from '../lib/plans'
import { storeAdminLoginUrl, storePublicUrl } from '../lib/ecommerceUrl'
import { needsOnboardingLock } from '../lib/postPayRedirect'
import AddressField from '../components/AddressField'
import PlanCardsGrid, { BillingCycleToggle } from '../components/PlanCardsGrid'
import StorefrontCmsPreview, { type CartFabStyle } from '../components/StorefrontCmsPreview'
import { isStorefrontStyle, type StorefrontStyle } from '../lib/storefrontStyles'
import { supabase } from '../lib/supabaseClient'
import { isAssistantIaBetaTenant } from '../lib/assistantIaBeta'
import AssistantIaTab from './AssistantIaTab'

const CORES = ['#0f5132', '#4d7cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']

/** Safe UI hint for Mercado Pago Access Token (prefix + last 6). Never the full secret. */
function maskMpAccessToken(token: string): string {
  const t = token.trim()
  if (!t) return ''
  const last = t.slice(-Math.min(6, t.length))
  if (t.startsWith('APP_USR-')) return `APP_USR-••••••••${last}`
  if (t.startsWith('TEST-')) return `TEST-••••••••${last}`
  if (t.length > 12) return `${t.slice(0, 8)}••••••••${last}`
  return `••••••••${last}`
}

type Tab = 'plano' | 'layout' | 'financeiro' | 'redes' | 'assistente-ia'

const TAB_PATH: Record<Tab, string> = {
  plano: '/meu-plano',
  layout: '/meu-plano/layout',
  financeiro: '/meu-plano/financeiro',
  redes: '/meu-plano/redes',
  'assistente-ia': '/meu-plano/assistente-ia',
}

function tabFromParam(param: string | undefined): Tab {
  if (param === 'layout' || param === 'financeiro' || param === 'redes' || param === 'assistente-ia') return param
  return 'plano'
}

function contentMap(items: { key: string; value: string }[]) {
  return Object.fromEntries(items.map((i) => [i.key, i.value]))
}

/** Canonical statuses for Meu Plano branching (API may send PT/EN / casing variants). */
type SubStatus = 'sem_assinatura' | 'pendente' | 'ativo' | 'pausado' | 'cancelado' | 'desconhecido'

/**
 * Normalize subscriber status from `/api/me` (and gateways).
 * Handles: cancelado | canceled | cancelled, pausado | paused, ativo | active, etc.
 */
function normalizeSubscriptionStatus(raw: string | null | undefined): SubStatus {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s || s === 'null' || s === 'none' || s === 'sem_assinatura' || s === 'sem-assinatura') {
    return 'sem_assinatura'
  }
  if (s === 'ativo' || s === 'active' || s === 'authorized') return 'ativo'
  if (s === 'pausado' || s === 'paused') return 'pausado'
  if (s === 'cancelado' || s === 'canceled' || s === 'cancelled') return 'cancelado'
  if (s === 'pendente' || s === 'pending') return 'pendente'
  return 'desconhecido'
}

function subscriptionStatusLabel(status: SubStatus, raw: string | null | undefined): string {
  switch (status) {
    case 'sem_assinatura':
      return 'sem assinatura'
    case 'pendente':
      return 'pendente'
    case 'ativo':
      return 'ativo'
    case 'pausado':
      return 'pausado'
    case 'cancelado':
      return 'cancelado'
    default:
      return (raw ?? '').trim() || '—'
  }
}

export default function MeuPlano() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = tabFromParam(tabParam)

  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingHero, setUploadingHero] = useState(false)
  const [busyPlano, setBusyPlano] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [content, setContent] = useState<Record<string, string>>({})
  const [plansLoaded, setPlansLoaded] = useState(false)

  const [nomeLoja, setNomeLoja] = useState('')
  const [endereco, setEndereco] = useState('')
  const [enderecoNumero, setEnderecoNumero] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [corPrincipal, setCorPrincipal] = useState(CORES[0])
  const [layoutStyle, setLayoutStyle] = useState<StorefrontStyle>('ufersin')
  const [landingHeadline, setLandingHeadline] = useState('')
  const [landingSub, setLandingSub] = useState('')
  const [landingBadge, setLandingBadge] = useState('')
  const [landingHighlights, setLandingHighlights] = useState<{ title: string; desc: string }[]>([])
  const [landingTexts, setLandingTexts] = useState<Record<string, string>>({})
  const [landingHeroImageUrl, setLandingHeroImageUrl] = useState('')
  const [cartFabStyle, setCartFabStyle] = useState<CartFabStyle>('sacola')
  const [cartFabAnimate, setCartFabAnimate] = useState(false)
  const [previewReloadKey, setPreviewReloadKey] = useState(0)
  const [whatsapp, setWhatsapp] = useState('')
  const [instagram, setInstagram] = useState('')
  const [facebook, setFacebook] = useState('')
  const [vendeMais18, setVendeMais18] = useState(false)
  const [apenasRetirada, setApenasRetirada] = useState(false)
  const [ofereceServicos, setOfereceServicos] = useState(false)
  const [precisaTelaCozinha, setPrecisaTelaCozinha] = useState(false)
  const [coletaGratis, setColetaGratis] = useState(false)
  const [entregaReparadoGratis, setEntregaReparadoGratis] = useState(false)
  const [pagamentoNaRetirada, setPagamentoNaRetirada] = useState(false)
  // Regra fixa do plano essential — entrega só sai com pagamento prévio
  // (Pix/cartão), dinheiro só na retirada/PDV. Sem toggle: sempre true.
  const entregaSomentePix = true
  const [pagamentoManual, setPagamentoManual] = useState(false)
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [hasCredenciais, setHasCredenciais] = useState(false)
  const [credencialMask, setCredencialMask] = useState<string | null>(null)
  const [connectingMp, setConnectingMp] = useState(false)
  const [disconnectingMp, setDisconnectingMp] = useState(false)

  const [cancelStep, setCancelStep] = useState<'reasons' | 'confirm' | null>(null)
  const [cancelReasons, setCancelReasons] = useState<CancelReasonCode[]>([])
  const [competitorNote, setCompetitorNote] = useState('')
  const [otherNote, setOtherNote] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [cancelPhrase, setCancelPhrase] = useState('')
  const [cancelResultMsg, setCancelResultMsg] = useState<string | null>(null)
  const [cicloPicker, setCicloPicker] = useState<BillingCycle>('mensal')
  const [cancellingPending, setCancellingPending] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    ;(async () => {
      if (isKnownPlatformAdminEmail(session?.user?.email)) {
        if (!cancelled) navigate('/dashboard', { replace: true })
        return
      }
      try {
        await api.superadminWhoami()
        if (!cancelled) navigate('/dashboard', { replace: true })
        return
      } catch {
        /* lojista */
      }

      try {
        // Só `me` é essencial pra esta tela — CMS/planos são complementares
        // (usados só pro seletor de troca de plano). Buscar em paralelo mas
        // sem Promise.all: uma falha em conteúdo/planos (ex.: API Railway
        // ainda sem migração nova) não pode derrubar o hub inteiro atrás de
        // "database error" quando o /api/me em si funcionou.
        const [m, ctResult, plansResult] = await Promise.all([
          api.me(),
          api.listPublicContent().catch(() => null),
          fetchPlans().catch(() => null),
        ])
        if (cancelled) return
        // Hard lock: incomplete onboarding → /onboarding only (no hub half-state).
        if (needsOnboardingLock(m)) {
          navigate('/onboarding', { replace: true })
          return
        }
        setMe(m)
        if (ctResult) setContent(contentMap(ctResult))
        if (plansResult) setPlansLoaded(true)
        setNomeLoja(m.loja_nome ?? '')
        setEndereco(m.endereco ?? '')
        setEnderecoNumero(m.endereco_numero ?? '')
        setLogoUrl(m.logo_url ?? '')
        setCorPrincipal(m.cor_principal || CORES[0])
        setLayoutStyle(isStorefrontStyle(m.layout_style) ? m.layout_style : 'ufersin')
        setLandingHeadline(m.landing_headline ?? '')
        setLandingSub(m.landing_sub ?? '')
        setLandingBadge(m.landing_badge ?? '')
        setLandingHighlights(m.landing_highlights ?? [])
        setLandingTexts(m.landing_texts ?? {})
        setLandingHeroImageUrl(m.landing_hero_image_url ?? '')
        setCartFabStyle(m.cart_fab_style === 'cart_icon' ? 'cart_icon' : 'sacola')
        setCartFabAnimate(!!m.cart_fab_animate)
        setWhatsapp(m.whatsapp ?? '')
        setInstagram((m.instagram ?? '').replace(/^@/, ''))
        setFacebook(m.facebook ?? '')
        setVendeMais18(!!m.vende_mais_18)
        setApenasRetirada(!!m.apenas_retirada)
        setOfereceServicos(!!m.oferece_servicos)
        setPrecisaTelaCozinha(!!m.precisa_tela_cozinha)
        setColetaGratis(!!m.coleta_gratis)
        setEntregaReparadoGratis(!!m.entrega_reparado_gratis)
        setPagamentoNaRetirada(!!m.pagamento_na_retirada)
        setPagamentoManual(!!m.pagamento_manual)
        setVenderExternamente(m.vender_externamente !== false)
        // Prefer explicit flag; fall back to forma_pagamento until API redeploy ships the field.
        setHasCredenciais(!!m.has_plataforma_credenciais || m.forma_pagamento === 'plataforma')
        setCredencialMask(
          typeof m.plataforma_credenciais_mask === 'string' && m.plataforma_credenciais_mask.trim()
            ? m.plataforma_credenciais_mask.trim()
            : null,
        )
        // Preferências de venda: reconcile via RPC pública se a API Railway
        // ainda não expõe flags novas no /api/me.
        if (m.slug) {
          try {
            const { data: pub } = await supabase.schema('resolutoo').rpc('get_public_tenant_config', {
              p_slug: m.slug,
            })
            if (pub && typeof pub === 'object') {
              const row = pub as {
                apenas_retirada?: boolean
                coleta_gratis?: boolean
                entrega_reparado_gratis?: boolean
                pagamento_na_retirada?: boolean
                entrega_somente_pix?: boolean
                pagamento_manual?: boolean
                vende_mais_18?: boolean
                vender_externamente?: boolean
              }
              if (typeof row.apenas_retirada === 'boolean') setApenasRetirada(row.apenas_retirada)
              if (typeof row.coleta_gratis === 'boolean') setColetaGratis(row.coleta_gratis)
              if (typeof row.entrega_reparado_gratis === 'boolean') setEntregaReparadoGratis(row.entrega_reparado_gratis)
              if (typeof row.pagamento_na_retirada === 'boolean') setPagamentoNaRetirada(row.pagamento_na_retirada)
              if (typeof row.pagamento_manual === 'boolean') setPagamentoManual(row.pagamento_manual)
              if (typeof row.vende_mais_18 === 'boolean') setVendeMais18(row.vende_mais_18)
              if (typeof row.vender_externamente === 'boolean') setVenderExternamente(row.vender_externamente)
            }
          } catch {
            /* ignore — keep /api/me values */
          }
        }
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          navigate('/completar-conta', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'Não foi possível carregar seus dados.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, navigate, session?.user?.email])

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  // Precisa vir ANTES do check de `loading`: o efeito acima faz `return`
  // sem nunca chamar `setLoading(false)` quando `!isAuthenticated` (não há
  // nada pra buscar) -- checar `loading` primeiro deixava a tela presa num
  // spinner pra sempre em vez de redirecionar pro /login (ex.: revisitar
  // /meu-plano depois de deslogar).
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (loading) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!me) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <p className="text-uf-silver-dim">{error || 'Não foi possível carregar seu plano.'}</p>
      </main>
    )
  }

  const planMap = getPlanMap()
  const subStatus = normalizeSubscriptionStatus(me.status)
  const statusLabel = subscriptionStatusLabel(subStatus, me.status)
  /** Only truly active subscriptions get plan details + cancel + layout/financeiro/redes edits. */
  const hasActiveSub = me.plano != null && subStatus === 'ativo'
  /**
   * Cancelled / paused / pending / never signed / no plan → show landing-style
   * plan cards (never the active cancel UI or a dead-end pending message).
   */
  const needsPlanPicker =
    !me.plano ||
    subStatus === 'sem_assinatura' ||
    subStatus === 'cancelado' ||
    subStatus === 'pausado' ||
    subStatus === 'pendente' ||
    subStatus === 'desconhecido'
  const tabLocked = content['meu_plano.tab_locked'] ?? 'Você ainda não assinou um plano para gerenciar.'
  /**
   * Vitrine / Painel only when a tenant slug exists (store provisioned).
   * Incomplete onboarding is redirected away; belt-and-suspenders CTA if half-state.
   */
  const storeSlug =
    me.slug?.trim() ||
    me.dominio?.match(/[?&]tenant=([^&]+)/i)?.[1]?.trim() ||
    null
  // Achado real: exigir `me.tenant_id` aqui escondia TODA a seção de
  // Preferências de venda (incluindo o apenas_retirada que já existia)
  // numa loja real, ativa e 100% funcional -- Vitrine/Painel (linhas
  // abaixo) já dependem só de `storeSlug`, e continuavam habilitados
  // normalmente com `tenant_id` nulo. Alinhado ao mesmo critério: `storeSlug`
  // sozinho já prova que a loja foi provisionada.
  const storeReady = Boolean(storeSlug)
  const needsStoreOnboarding =
    !storeSlug &&
    (me.onboarding_status === 'aguardando_onboarding' ||
      (normalizeSubscriptionStatus(me.status) === 'ativo' && !me.tenant_id))
  // Painel do ramo eletrônicos agora é nativo (mesmo motor Rust + JWT de
  // admin do ecommerce, só um shell/tema diferente) -- storeAdminLoginUrl
  // já funciona igual pros dois ramos, sem ponte de sessão nenhuma.
  const panelUrl = storeSlug ? storeAdminLoginUrl(storeSlug, me.email) : null
  const publicUrl = storeSlug ? storePublicUrl(storeSlug) : null

  const handleLogout = async () => {
    try {
      await authStore.signOut('lojista')
    } finally {
      // Sinaliza pra Landing não jogar de volta pro painel mesmo se uma
      // sessão "ressuscitada" aparecer no primeiro instante após o reload.
      sessionStorage.setItem('resolutoo_just_logged_out', '1')
      // Reload completo (não navigate client-side) — no navegador mobile,
      // a troca de rota "por dentro" podia deixar a página anterior
      // renderizada por trás do cache de navegação, dando a impressão de
      // que o "Sair" não fez nada e voltava pro /meu-plano.
      window.location.href = '/'
    }
  }

  const resetCancelForm = () => {
    setCancelStep(null)
    setCancelReasons([])
    setCompetitorNote('')
    setOtherNote('')
    setCancelNote('')
    setCancelPhrase('')
  }

  const openCancelReasons = () => {
    resetCancelForm()
    setCancelStep('reasons')
    setError(null)
  }

  const goToCancelConfirm = () => {
    if (cancelReasons.length === 0) {
      setError('Selecione pelo menos um motivo do cancelamento.')
      return
    }
    if (cancelReasons.includes('other') && !otherNote.trim()) {
      setError('Descreva o motivo em "Outro".')
      return
    }
    setError(null)
    setCancelPhrase('')
    setCancelStep('confirm')
  }

  const handleCancelar = async () => {
    if (cancelPhrase !== 'quero cancelar') {
      setError('Digite exatamente "quero cancelar" para confirmar.')
      return
    }
    if (cancelReasons.length === 0) {
      setError('Selecione pelo menos um motivo do cancelamento.')
      return
    }
    if (cancelReasons.includes('other') && !otherNote.trim()) {
      setError('Descreva o motivo em "Outro".')
      return
    }
    setBusyPlano(true)
    setError(null)
    setCancelResultMsg(null)
    try {
      const res = await api.cancelar({
        confirm: true,
        confirm_phrase: cancelPhrase,
        reasons: cancelReasons,
        competitor_note: cancelReasons.includes('found_better') ? competitorNote.trim() || undefined : undefined,
        other_note: cancelReasons.includes('other') ? otherNote.trim() || undefined : undefined,
        note: cancelNote.trim() || undefined,
      })
      setMe((prev) => (prev ? { ...prev, status: 'cancelado' } : prev))
      resetCancelForm()
      if (res.refund_status === 'refunded') {
        setCancelResultMsg('Assinatura cancelada. Estorno automático enviado ao pagador via Mercado Pago.')
      } else if (res.refund_eligible && res.refund_status === 'refund_failed') {
        setCancelResultMsg('Assinatura cancelada, mas o estorno automático falhou — fale com o suporte.')
      } else if (res.refund_eligible) {
        setCancelResultMsg('Assinatura cancelada. Não havia cobrança localizável para estornar automaticamente.')
      } else {
        setCancelResultMsg('Assinatura cancelada. Fora da janela de 7 dias — sem estorno automático.')
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar.')
    } finally {
      setBusyPlano(false)
    }
  }

  const toggleCancelReason = (code: CancelReasonCode) => {
    setCancelReasons((prev) => (prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]))
  }

  const handleCancelarPendente = async () => {
    setBusyPlano(true)
    setCancellingPending(true)
    setError(null)
    try {
      const res = await api.cancelarPendente()
      setMe((prev) =>
        prev
          ? {
              ...prev,
              status: res.status || 'sem_assinatura',
              // Keep provisionado when store already exists — BE preserves it.
              onboarding_status:
                prev.onboarding_status === 'provisionado' || prev.tenant_id
                  ? 'provisionado'
                  : 'aguardando_pagamento',
            }
          : prev,
      )
      setCancelResultMsg('Tentativa de pagamento cancelada. Escolha um plano pra tentar de novo.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar a tentativa.')
    } finally {
      setBusyPlano(false)
      setCancellingPending(false)
    }
  }

  const resubscribeHint =
    subStatus === 'pendente'
      ? 'Pagamento ainda não confirmado. Escolha um plano pra pagar de novo, ou cancele a tentativa pendente.'
      : subStatus === 'cancelado'
        ? 'Assinatura cancelada. Seus dados estão preservados — painel e vitrine ficam offline até você assinar novamente.'
        : subStatus === 'pausado'
          ? 'Assinatura pausada (inadimplência). Painel e vitrine ficam offline até a cobrança ser regularizada — você também pode assinar novamente.'
          : content['meu_plano.no_plan'] ?? 'Escolha um plano pra começar.'

  const planCtaLabel =
    subStatus === 'pendente'
      ? (name: string) => `Pagar ${name} de novo`
      : subStatus === 'cancelado' || subStatus === 'pausado'
        ? (name: string) => `Assinar ${name} novamente`
        : (name: string) => `Assinar ${name}`

  const planCards = (
    <div className="space-y-5" data-testid="planos-assinar-banner">
      <div className="flex justify-center">
        <BillingCycleToggle ciclo={cicloPicker} onChange={setCicloPicker} />
      </div>
      {plansLoaded && (
        <PlanCardsGrid
          ciclo={cicloPicker}
          animateOnMount
          cta={{
            kind: 'link',
            to: (code, c) => `/assinar?plano=${code}&ciclo=${c}`,
            label: planCtaLabel,
          }}
        />
      )}
      {subStatus === 'pendente' && (
        <div className="flex flex-wrap gap-2 justify-center pt-1">
          <button
            type="button"
            onClick={handleCancelarPendente}
            disabled={busyPlano || cancellingPending}
            className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20"
            data-testid="cancelar-pendente"
          >
            {cancellingPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Cancelar tentativa pendente
          </button>
        </div>
      )}
    </div>
  )

  const saveOnboarding = async (fields: Parameters<typeof api.editarOnboarding>[0]) => {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      await api.editarOnboarding(fields)
      if (fields.layout_style) {
        const { error: layoutErr } = await supabase.schema('resolutoo').rpc('set_my_layout_style', {
          p_style: fields.layout_style,
        })
        if (layoutErr) console.warn('set_my_layout_style:', layoutErr.message)
      }
      if (
        fields.apenas_retirada != null ||
        fields.pagamento_na_retirada != null ||
        fields.entrega_somente_pix != null ||
        fields.pagamento_manual != null ||
        fields.vende_mais_18 != null ||
        fields.vender_externamente != null ||
        fields.coleta_gratis != null ||
        fields.entrega_reparado_gratis != null
      ) {
        const { error: prefsErr } = await supabase.schema('resolutoo').rpc('set_my_sale_prefs', {
          p_apenas_retirada: fields.apenas_retirada ?? null,
          p_vende_mais_18: fields.vende_mais_18 ?? null,
          p_vender_externamente: fields.vender_externamente ?? null,
          p_pagamento_na_retirada: fields.pagamento_na_retirada ?? null,
          p_entrega_somente_pix: fields.entrega_somente_pix ?? null,
          p_pagamento_manual: fields.pagamento_manual ?? null,
          p_coleta_gratis: fields.coleta_gratis ?? null,
          p_entrega_reparado_gratis: fields.entrega_reparado_gratis ?? null,
        })
        if (prefsErr) console.warn('set_my_sale_prefs:', prefsErr.message)
      }
      setMe((prev) => (prev ? { ...prev, ...mapFieldsToMe(prev, fields) } : prev))
      setSaved(true)
      setPreviewReloadKey((k) => k + 1)
      if (
        fields.plataforma_credenciais &&
        typeof fields.plataforma_credenciais.token === 'string' &&
        fields.plataforma_credenciais.token.trim()
      ) {
        setHasCredenciais(true)
        setCredencialMask(maskMpAccessToken(fields.plataforma_credenciais.token))
      }
      window.setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploadingLogo(true)
    try {
      const { url } = await api.uploadLogo(file)
      setLogoUrl(url)
      setMe((prev) => (prev ? { ...prev, logo_url: url } : prev))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar a logo.')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleHeroUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploadingHero(true)
    try {
      const { url } = await api.uploadLogo(file)
      setLandingHeroImageUrl(url)
      await api.editarOnboarding({ landing_hero_image_url: url })
      setMe((prev) => (prev ? { ...prev, landing_hero_image_url: url } : prev))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar a imagem do hero.')
    } finally {
      setUploadingHero(false)
    }
  }

  const handleClearHero = async () => {
    setError(null)
    setUploadingHero(true)
    try {
      await api.editarOnboarding({ landing_hero_image_url: '' })
      setLandingHeroImageUrl('')
      setMe((prev) => (prev ? { ...prev, landing_hero_image_url: null } : prev))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível remover a imagem.')
    } finally {
      setUploadingHero(false)
    }
  }

  const handleSaveLayout = (e: React.FormEvent) => {
    e.preventDefault()
    if (!nomeLoja.trim()) {
      setError('Informe o nome da empresa.')
      return
    }
    saveOnboarding({
      nome_loja: nomeLoja.trim(),
      endereco: endereco.trim() || undefined,
      endereco_numero: enderecoNumero.trim() || undefined,
      logo_url: logoUrl.trim() || undefined,
      cor_principal: corPrincipal,
      layout_style: layoutStyle,
      landing_headline: landingHeadline.trim() || undefined,
      landing_sub: landingSub.trim() || undefined,
      landing_badge: landingBadge.trim() || undefined,
      landing_highlights: landingHighlights.length ? landingHighlights : undefined,
      landing_texts: Object.keys(landingTexts).length ? landingTexts : undefined,
      landing_hero_image_url: landingHeroImageUrl.trim() || '',
      cart_fab_style: cartFabStyle,
      cart_fab_animate: cartFabAnimate,
      vende_mais_18: vendeMais18,
    })
  }

  /** Salva só um dos textos de CMS (selo/título/subtítulo/destaques/avulso)
   * clicado no preview -- reaproveita o mesmo PUT de layout (é um recurso
   * só, sem PATCH por campo), mas usa o valor do patch em vez do state (que
   * ainda não re-renderizou) pra não salvar um texto antigo por engano. */
  const saveLayoutField = (patch: {
    landingHeadline?: string
    landingSub?: string
    landingBadge?: string
    landingHighlights?: { title: string; desc: string }[]
    landingTexts?: Record<string, string>
  }) => {
    const headline = patch.landingHeadline ?? landingHeadline
    const sub = patch.landingSub ?? landingSub
    const badge = patch.landingBadge ?? landingBadge
    const highlights = patch.landingHighlights ?? landingHighlights
    const texts = patch.landingTexts ?? landingTexts
    if (patch.landingHeadline != null) setLandingHeadline(patch.landingHeadline)
    if (patch.landingSub != null) setLandingSub(patch.landingSub)
    if (patch.landingBadge != null) setLandingBadge(patch.landingBadge)
    if (patch.landingHighlights != null) setLandingHighlights(patch.landingHighlights)
    if (patch.landingTexts != null) setLandingTexts(patch.landingTexts)
    saveOnboarding({
      nome_loja: nomeLoja.trim(),
      endereco: endereco.trim() || undefined,
      endereco_numero: enderecoNumero.trim() || undefined,
      logo_url: logoUrl.trim() || undefined,
      cor_principal: corPrincipal,
      layout_style: layoutStyle,
      // Campo tocado neste patch manda o valor literal (mesmo vazio -- é
      // exatamente o caso de "Restaurar padrão" quando o default é ""), pra
      // não virar `undefined` e ser silenciosamente ignorado pelo backend
      // (COALESCE mantém o valor antigo se o campo não vier no PUT).
      landing_headline: patch.landingHeadline != null ? headline.trim() : headline.trim() || undefined,
      landing_sub: patch.landingSub != null ? sub.trim() : sub.trim() || undefined,
      landing_badge: patch.landingBadge != null ? badge.trim() : badge.trim() || undefined,
      landing_highlights: patch.landingHighlights != null ? highlights : highlights.length ? highlights : undefined,
      landing_texts: patch.landingTexts != null ? texts : Object.keys(texts).length ? texts : undefined,
      landing_hero_image_url: landingHeroImageUrl.trim() || '',
      cart_fab_style: cartFabStyle,
      cart_fab_animate: cartFabAnimate,
      vende_mais_18: vendeMais18,
    })
  }

  const handleConnectMp = async () => {
    setError(null)
    setConnectingMp(true)
    try {
      const { authorize_url } = await api.mercadoPagoOAuthStart()
      window.location.href = authorize_url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conectar o Mercado Pago.')
      setConnectingMp(false)
    }
  }

  const handleDisconnectMp = async () => {
    setError(null)
    setDisconnectingMp(true)
    try {
      await api.mercadoPagoOAuthDisconnect()
      setHasCredenciais(false)
      setCredencialMask(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível desconectar o Mercado Pago.')
    } finally {
      setDisconnectingMp(false)
    }
  }

  const handleSaveRedes = (e: React.FormEvent) => {
    e.preventDefault()
    if (!whatsapp.trim()) {
      setError('WhatsApp é obrigatório.')
      return
    }
    saveOnboarding({
      whatsapp: whatsapp.trim(),
      whatsapp_habilitado: true,
      instagram: instagram.trim().replace(/^@/, '') || undefined,
      facebook: facebook.trim() || undefined,
    })
  }

  const handleSavePreferenciasVenda = (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeSlug) {
      setError('Conclua o cadastro da loja (Access Token do Mercado Pago incluso) antes de salvar preferências.')
      return
    }
    saveOnboarding({
      // Eletrônica não tem o checkbox +18/venda-externa (não se aplicam);
      // manda os valores fixos corretos em vez do que ficou em memória.
      vende_mais_18: me.vertical === 'eletronicos' ? false : vendeMais18,
      vender_externamente: me.vertical === 'eletronicos' ? true : venderExternamente,
      apenas_retirada: apenasRetirada,
      // Eletrônica sempre oferece serviço (sem checkbox, não pode ser diferente).
      oferece_servicos: me.vertical === 'eletronicos' ? true : ofereceServicos,
      // Eletrônica não tem conceito de cozinha (não é F&B).
      precisa_tela_cozinha: me.vertical === 'eletronicos' ? false : precisaTelaCozinha,
      pagamento_na_retirada: pagamentoNaRetirada,
      entrega_somente_pix: entregaSomentePix,
      pagamento_manual: pagamentoManual,
      // Loja sem deslocamento não tem cortesia de deslocamento (o backend
      // também normaliza, isto só mantém a UI e o payload coerentes).
      coleta_gratis: !apenasRetirada && coletaGratis,
      entrega_reparado_gratis: !apenasRetirada && entregaReparadoGratis,
    })
  }

  const TABS: { id: Tab; label: string; path: string }[] = [
    { id: 'plano', label: 'Meu plano atual', path: TAB_PATH.plano },
    { id: 'layout', label: 'Layout', path: TAB_PATH.layout },
    { id: 'financeiro', label: 'Financeiro', path: TAB_PATH.financeiro },
    { id: 'redes', label: 'Redes sociais', path: TAB_PATH.redes },
    ...(isAssistantIaBetaTenant(me.slug, me.vertical) ? [{ id: 'assistente-ia' as const, label: 'Assistente IA', path: TAB_PATH['assistente-ia'] }] : []),
  ]

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver relative">
      <div className="uf-mesh" />
      <header className="border-b border-white/5 px-5 py-4 relative z-10">
        <div className="uf-container flex items-center justify-between">
          <Link to="/" className="text-lg font-black uf-text">
            Resolutoo
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/trocar-senha" className="btn-ghost text-sm hidden sm:inline-flex">
              Trocar senha
            </Link>
            <button onClick={handleLogout} className="btn-ghost text-sm">
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className={`uf-container px-5 py-8 relative z-10 mx-auto ${needsPlanPicker ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black mb-1">{me.loja_nome}</h1>
          <p className="text-sm text-uf-silver-dim mb-6">Hub do lojista — plano, layout e integrações.</p>

          {(panelUrl || publicUrl) && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6"
              data-testid="loja-atalhos-hub"
            >
              {publicUrl && (
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary text-sm px-4 py-3 inline-flex items-center justify-center gap-2"
                  data-testid="abrir-vitrine"
                >
                  <Store className="w-4 h-4" />
                  Vitrine
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {panelUrl && (
                <a
                  href={panelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-sm px-4 py-3 inline-flex items-center justify-center gap-2"
                  data-testid="abrir-painel-loja"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Painel da loja
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}

          {needsStoreOnboarding && (
            <div
              className="uf-glass rounded-2xl p-5 mb-6 space-y-3 border border-amber-400/25"
              data-testid="concluir-cadastro-loja"
            >
              <h2 className="font-bold text-sm text-uf-silver uppercase tracking-wide">Cadastro da loja incompleto</h2>
              <p className="text-xs text-uf-silver-dim">
                Finalize o onboarding (dados da loja + Access Token de produção do Mercado Pago) pra liberar Vitrine,
                Painel e preferências de venda.
              </p>
              <Link
                to="/onboarding"
                className="btn-primary text-sm px-4 py-3 inline-flex items-center justify-center gap-2 w-full sm:w-auto"
                data-testid="cta-concluir-cadastro-loja"
              >
                <Store className="w-4 h-4" />
                Concluir cadastro da loja
              </Link>
            </div>
          )}

          <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
            {TABS.map((t) => (
              <NavLink
                key={t.id}
                to={t.path}
                end={t.id === 'plano'}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-xl text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    isActive ? 'bg-white/10 text-white font-semibold' : 'text-uf-silver-dim hover:text-uf-silver'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </div>

          {error && <p className="error-msg mb-4">{error}</p>}
          {saved && <p className="text-sm text-emerald-400 mb-4">Salvo!</p>}
          {cancelResultMsg && <p className="text-sm text-emerald-400 mb-4">{cancelResultMsg}</p>}

          {tab === 'plano' && needsPlanPicker && (
            <section className="space-y-4" data-testid="reassinar-planos">
              {(panelUrl || publicUrl) && (
                <section
                  className="uf-glass rounded-2xl p-5 space-y-3 border border-uf-blue/30"
                  data-testid="loja-atalhos-reassinar"
                >
                  <h2 className="font-bold text-sm text-uf-silver-dim uppercase tracking-wide">Sua loja</h2>
                  <p className="text-xs text-uf-silver-dim">
                    Sua loja{storeSlug ? ` (${storeSlug})` : ''} continua acessível. Abra a vitrine ou o painel
                    enquanto reassina.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {publicUrl && (
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-primary text-sm px-4 py-3 inline-flex items-center justify-center gap-2"
                        data-testid="abrir-vitrine-reassinar"
                      >
                        <Store className="w-4 h-4" />
                        Vitrine
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {panelUrl && (
                      <a
                        href={panelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary text-sm px-4 py-3 inline-flex items-center justify-center gap-2"
                        data-testid="abrir-painel-loja-reassinar"
                      >
                        <LayoutDashboard className="w-4 h-4" />
                        Painel da loja
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </section>
              )}
              <div className="uf-glass rounded-2xl p-6 space-y-3">
                <h2 className="font-bold mb-1 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                  <Sparkles className="w-4 h-4" />{' '}
                  {me.plano ? planMap[me.plano]?.name ?? planDisplayName(me.plano) : 'Assinar um plano'}
                </h2>
                <p className="text-sm text-uf-silver-dim">
                  Status: <span className="text-uf-silver">{statusLabel}</span>
                </p>
                <p className="text-sm text-uf-silver-dim">{resubscribeHint}</p>
              </div>
              {planCards}
            </section>
          )}

          {tab === 'plano' && !needsPlanPicker && (
            <div className="space-y-4">
              {hasActiveSub && storeReady && (
                <form onSubmit={handleSavePreferenciasVenda} className="uf-glass rounded-2xl p-6 space-y-4" data-testid="preferencias-venda">
                  <h2 className="font-bold text-sm text-uf-silver-dim uppercase tracking-wide">Preferências de venda</h2>
                  <p className="text-xs text-uf-silver-dim">
                    Defina se a loja vende pro público externo, se exige verificação 18+ no checkout e se aceita só retirada.
                  </p>
                  <h3 className="text-[11px] font-bold text-uf-silver-dim/70 uppercase tracking-wider pt-1">Vitrine</h3>
                  {/* Ramo eletrônica: vender pro público externo é obrigatório (vrtech
                      É a vitrine, não tem modo "só painel interno") e não vende produto
                      +18 -- os dois checkboxes não fazem sentido nessa categoria. */}
                  {me.vertical !== 'eletronicos' && (
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={venderExternamente}
                      onChange={(e) => setVenderExternamente(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                      data-testid="pref-vender-externamente"
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        Quer vender pro público externo
                      </span>
                      Vitrine online (catálogo, carrinho, checkout). Desmarque pra usar só painel/PDV interno —
                      libera Pedidos e Frete no painel quando ativo.
                    </span>
                  </label>
                  )}
                  {/* Eletrônica: venda externa é sempre obrigatória (não há
                      checkbox pra desligar), então este gate nunca deve
                      esconder o resto do form nesse ramo -- só depende do
                      valor real do toggle pro ramo ecommerce (opcional). */}
                  {(me.vertical === 'eletronicos' || venderExternamente) && (
                  <>
                  {me.vertical !== 'eletronicos' && (
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={vendeMais18}
                      onChange={(e) => setVendeMais18(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                      data-testid="pref-vende-mais-18"
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        Vendo produtos para maiores de 18 anos
                      </span>
                      O cliente só compra logado — cadastro passa a exigir data de nascimento e consentimento de compra +18.
                    </span>
                  </label>
                  )}
                  <h3 className="text-[11px] font-bold text-uf-silver-dim/70 uppercase tracking-wider pt-2">Serviço e entrega</h3>
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={apenasRetirada}
                      onChange={(e) => setApenasRetirada(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                      data-testid="pref-apenas-retirada"
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        {me.vertical === 'eletronicos'
                          ? 'Apenas retirada/local — não ofereço serviço de deslocamento'
                          : 'Não ofereço serviço de entrega — retirada obrigatória na loja'}
                      </span>
                      {me.vertical === 'eletronicos'
                        ? 'Sem coleta de aparelho, sem entrega de produto e sem entrega de aparelho reparado. O cliente leva e retira na loja.'
                        : 'A vitrine não pede endereço de entrega; em vez disso mostra um botão com o endereço da loja no Google Maps.'}
                    </span>
                  </label>
                  {me.vertical !== 'eletronicos' && (
                    <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ofereceServicos}
                        onChange={(e) => setOfereceServicos(e.target.checked)}
                        className="w-4 h-4 mt-0.5"
                        data-testid="pref-oferece-servicos"
                      />
                      <span className="text-xs text-uf-silver-dim">
                        <span className="block text-uf-silver font-semibold mb-0.5">Ofereço serviços</span>
                        Além de produtos, sua vitrine ganha um botão "Ver serviços" e o painel ganha a aba de cadastro de serviços.
                      </span>
                    </label>
                  )}
                  {/* Cortesia de deslocamento só existe pra quem FAZ deslocamento —
                      marcar "apenas retirada" esconde (e o backend zera as duas). */}
                  {me.vertical === 'eletronicos' && !apenasRetirada && (
                    <>
                      <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={coletaGratis}
                          onChange={(e) => setColetaGratis(e.target.checked)}
                          className="w-4 h-4 mt-0.5"
                          data-testid="pref-coleta-gratis"
                        />
                        <span className="text-xs text-uf-silver-dim">
                          <span className="block text-uf-silver font-semibold mb-0.5">
                            Coleta de aparelho grátis
                          </span>
                          Buscar o aparelho pra diagnóstico/reparo não é cobrado do cliente. A entrega do aparelho pronto continua sendo cobrada normalmente (frete por distância).
                        </span>
                      </label>
                      <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entregaReparadoGratis}
                          onChange={(e) => setEntregaReparadoGratis(e.target.checked)}
                          className="w-4 h-4 mt-0.5"
                          data-testid="pref-entrega-reparado-gratis"
                        />
                        <span className="text-xs text-uf-silver-dim">
                          <span className="block text-uf-silver font-semibold mb-0.5">
                            Entrega do aparelho reparado grátis
                          </span>
                          Devolver o aparelho pronto na casa do cliente não é cobrado. A coleta continua sendo cobrada normalmente (frete por distância).
                        </span>
                      </label>
                    </>
                  )}
                  </>
                  )}
                  {me.vertical !== 'eletronicos' && (
                    <>
                      <h3 className="text-[11px] font-bold text-uf-silver-dim/70 uppercase tracking-wider pt-2">Cozinha</h3>
                      <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={precisaTelaCozinha}
                          onChange={(e) => setPrecisaTelaCozinha(e.target.checked)}
                          className="w-4 h-4 mt-0.5"
                          data-testid="pref-precisa-tela-cozinha"
                        />
                        <span className="text-xs text-uf-silver-dim">
                          <span className="block text-uf-silver font-semibold mb-0.5">Vou precisar de uma tela para cozinha</span>
                          Pedidos deixam de cair em Pedidos e passam direto pra tela de Cozinha, onde a equipe avança o status.
                        </span>
                      </label>
                    </>
                  )}
                  <button type="submit" disabled={saving} className="btn-primary w-full py-3" data-testid="salvar-preferencias">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar preferências
                  </button>
                </form>
              )}

              <section className="uf-glass rounded-2xl p-6" data-testid="meu-plano-atual">
                <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                  <Sparkles className="w-4 h-4" /> {me.plano ? planMap[me.plano]?.name ?? planDisplayName(me.plano) : 'Plano'}
                </h2>
                <p className="text-sm text-uf-silver-dim mb-1">
                  Status: <span className="text-uf-silver">{statusLabel}</span>
                </p>
                {hasActiveSub && (
                  <>
                    <p className="text-2xl font-black mb-1">
                      R$ {formatBRL(me.valor_mensal ?? (me.plano ? planMap[me.plano]?.price : 0) ?? 0)}/mês
                    </p>
                    {me.billing_cycle === 'semestral' && (
                      <p className="text-xs text-uf-silver-dim mb-4">
                        Ciclo semestral · R$ {formatBRL(priceForCycle(me.valor_mensal ?? 0, 'semestral'))} por período
                      </p>
                    )}
                    {me.coupon_code && <p className="text-xs text-emerald-400 mb-4">Cupom ativo: {me.coupon_code}</p>}
                    <p className="text-xs text-uf-silver-dim mb-4">
                      Você pode cancelar a qualquer momento (mês pré-pago).
                      {me.refund_eligible_on_cancel
                        ? ' Dentro de 7 dias do início da assinatura, o cancelamento gera estorno automático via Mercado Pago.'
                        : ' Já passou a janela de 7 dias — cancelar não gera estorno automático.'}
                    </p>
                    <button
                      type="button"
                      onClick={openCancelReasons}
                      disabled={busyPlano}
                      className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20"
                      data-testid="abrir-cancelar-assinatura"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  </>
                )}
              </section>
            </div>
          )}

          {cancelStep === 'reasons' && hasActiveSub && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center px-5 bg-black/70 backdrop-blur-sm"
              data-testid="cancelar-assinatura-dialog-reasons"
              onClick={() => !busyPlano && resetCancelForm()}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Motivo do cancelamento"
                className="uf-glass rounded-3xl p-6 w-full max-w-md relative max-h-[90vh] overflow-y-auto"
                style={{ background: 'var(--color-uf-surface)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => resetCancelForm()}
                  disabled={busyPlano}
                  aria-label="Fechar"
                  className="absolute top-5 right-5 text-uf-silver-dim hover:text-uf-silver"
                >
                  <X className="w-4 h-4" />
                </button>
                <h3 className="text-lg font-black mb-1 pr-8">Cancelar assinatura</h3>
                <p className="text-xs text-uf-silver-dim mb-4">
                  Motivo (pode marcar mais de um). A loja e os dados são preservados; painel e vitrine ficam offline.
                </p>

                <div className="space-y-3" data-testid="cancelar-assinatura-form">
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex flex-col gap-2 cursor-pointer">
                    <span className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={cancelReasons.includes('unexpected')}
                        onChange={() => toggleCancelReason('unexpected')}
                        className="w-4 h-4 mt-0.5"
                      />
                      <span className="text-xs text-uf-silver">O sistema não era aquilo que eu esperava :(</span>
                    </span>
                    {cancelReasons.includes('unexpected') && (
                      <textarea
                        className="input-field text-xs min-h-[4rem]"
                        placeholder="Complemento opcional"
                        value={cancelNote}
                        onChange={(e) => setCancelNote(e.target.value)}
                      />
                    )}
                  </label>

                  <label className="uf-glass rounded-xl px-3 py-2.5 flex flex-col gap-2 cursor-pointer">
                    <span className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={cancelReasons.includes('found_better')}
                        onChange={() => toggleCancelReason('found_better')}
                        className="w-4 h-4 mt-0.5"
                      />
                      <span className="text-xs text-uf-silver">Encontrei outro sistema melhor/mais barato</span>
                    </span>
                    {cancelReasons.includes('found_better') && (
                      <input
                        className="input-field text-xs"
                        placeholder="Qual sistema? (opcional)"
                        value={competitorNote}
                        onChange={(e) => setCompetitorNote(e.target.value)}
                      />
                    )}
                  </label>

                  <label className="uf-glass rounded-xl px-3 py-2.5 flex flex-col gap-2 cursor-pointer">
                    <span className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={cancelReasons.includes('other')}
                        onChange={() => toggleCancelReason('other')}
                        className="w-4 h-4 mt-0.5"
                      />
                      <span className="text-xs text-uf-silver">Outro</span>
                    </span>
                    {cancelReasons.includes('other') && (
                      <textarea
                        className="input-field text-xs min-h-[4rem]"
                        placeholder="Descreva o motivo"
                        value={otherNote}
                        onChange={(e) => setOtherNote(e.target.value)}
                        required
                      />
                    )}
                  </label>

                  <p className="text-xs text-uf-silver-dim">
                    {me.refund_eligible_on_cancel
                      ? 'Este cancelamento está na janela de 7 dias: haverá tentativa de estorno automático no Mercado Pago.'
                      : 'Este cancelamento está fora da janela de 7 dias: sem estorno automático.'}
                  </p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" onClick={() => resetCancelForm()} className="btn-ghost text-xs px-3 py-2">
                      Fechar
                    </button>
                    <button
                      type="button"
                      onClick={goToCancelConfirm}
                      className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20"
                      data-testid="cancelar-assinatura-prosseguir"
                    >
                      Cancelar assinatura
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {cancelStep === 'confirm' && hasActiveSub && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center px-5 bg-black/70 backdrop-blur-sm"
              data-testid="cancelar-assinatura-dialog-confirm"
              onClick={() => !busyPlano && setCancelStep('reasons')}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Confirmar cancelamento"
                className="uf-glass rounded-3xl p-6 w-full max-w-md relative"
                style={{ background: 'var(--color-uf-surface)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-black mb-2">Deseja mesmo cancelar?</h3>
                <p className="text-xs text-uf-silver-dim mb-4">
                  Digite exatamente <span className="font-mono text-uf-silver">quero cancelar</span> para confirmar.
                </p>
                <input
                  className="input-field text-sm mb-4"
                  value={cancelPhrase}
                  onChange={(e) => setCancelPhrase(e.target.value)}
                  placeholder="quero cancelar"
                  autoComplete="off"
                  data-testid="cancel-confirm-phrase"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCancelStep('reasons')}
                    disabled={busyPlano}
                    className="btn-ghost text-xs px-3 py-2"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelar}
                    disabled={busyPlano || cancelPhrase !== 'quero cancelar'}
                    className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20 disabled:opacity-40"
                    data-testid="confirmar-cancelamento"
                  >
                    {busyPlano ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    Confirmar cancelamento
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'layout' && !hasActiveSub && (
            <p className="text-sm text-uf-silver-dim uf-glass rounded-2xl p-5">{tabLocked}</p>
          )}
          {tab === 'layout' && hasActiveSub && (
            <form onSubmit={handleSaveLayout} className="uf-glass rounded-2xl p-6 space-y-4">
              <p className="text-xs text-uf-silver-dim">
                {content['meu_plano.layout_hint'] ?? 'Nome, logo, textos da landing, cor e endereço da vitrine.'}
              </p>
              <div>
                <label className="label">Nome da empresa</label>
                <input className="input-field" value={nomeLoja} onChange={(e) => setNomeLoja(e.target.value)} />
              </div>
              <AddressField endereco={endereco} numero={enderecoNumero} onEnderecoChange={setEndereco} onNumeroChange={setEnderecoNumero} />
              <div>
                <label className="label">Logo</label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-14 h-14 rounded-xl object-cover border border-white/10" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-[10px] text-uf-silver-dim">
                      sem logo
                    </div>
                  )}
                  <label className="btn-secondary text-xs px-3 py-2 cursor-pointer inline-flex items-center gap-1.5">
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {logoUrl ? 'Trocar imagem' : 'Enviar imagem'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingLogo}
                      onChange={(e) => handleLogoUpload(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              </div>
              <div>
                <label className="label">Imagem do hero (Essential)</label>
                <p className="text-[11px] text-uf-silver-dim mb-2 leading-snug">
                  No plano Essential, esta imagem retangular aparece acima do título na landing
                  (uiux2/3/4). Management e Premium usam os banners de promoção do painel — esta
                  imagem não substitui esses banners.
                </p>
                <div className="flex items-start gap-3">
                  {landingHeroImageUrl ? (
                    <img
                      src={landingHeroImageUrl}
                      alt="Hero"
                      className="w-28 h-16 rounded-xl object-cover border border-white/10"
                    />
                  ) : (
                    <div className="w-28 h-16 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-[10px] text-uf-silver-dim text-center px-1">
                      sem imagem
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label className="btn-secondary text-xs px-3 py-2 cursor-pointer inline-flex items-center gap-1.5">
                      {uploadingHero ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {landingHeroImageUrl ? 'Trocar imagem' : 'Enviar imagem'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingHero}
                        onChange={(e) => handleHeroUpload(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {landingHeroImageUrl && (
                      <button
                        type="button"
                        onClick={handleClearHero}
                        disabled={uploadingHero}
                        className="btn-ghost text-xs px-3 py-1.5 !text-red-300"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <label className="label flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5" /> Cor principal
                </label>
                <div className="flex gap-2">
                  {CORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCorPrincipal(c)}
                      className={`w-9 h-9 rounded-full border-2 ${corPrincipal === c ? 'scale-110 border-white' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <StorefrontCmsPreview
                values={{
                  corPrincipal,
                  layoutStyle,
                  landingHeadline,
                  landingSub,
                  landingBadge,
                  landingHighlights,
                  landingTexts,
                  cartFabStyle,
                  cartFabAnimate,
                }}
                onChange={(patch) => {
                  if (patch.layoutStyle != null) setLayoutStyle(patch.layoutStyle)
                  if (patch.landingHeadline != null) setLandingHeadline(patch.landingHeadline)
                  if (patch.landingSub != null) setLandingSub(patch.landingSub)
                  if (patch.landingBadge != null) setLandingBadge(patch.landingBadge)
                  if (patch.landingHighlights != null) setLandingHighlights(patch.landingHighlights)
                  if (patch.landingTexts != null) setLandingTexts(patch.landingTexts)
                  if (patch.cartFabStyle != null) setCartFabStyle(patch.cartFabStyle)
                  if (patch.cartFabAnimate != null) setCartFabAnimate(patch.cartFabAnimate)
                }}
                onSaveField={saveLayoutField}
                publicUrl={publicUrl}
                reloadToken={previewReloadKey}
                vertical={me.vertical}
              />
              <button type="submit" disabled={saving} className="btn-primary w-full py-3">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar layout
              </button>
            </form>
          )}

          {tab === 'financeiro' && !hasActiveSub && (
            <p className="text-sm text-uf-silver-dim uf-glass rounded-2xl p-5">{tabLocked}</p>
          )}
          {tab === 'financeiro' && hasActiveSub && (
            <div className="uf-glass rounded-2xl p-6 space-y-4">
              <p className="text-xs text-uf-silver-dim">
                {content['meu_plano.financeiro_hint'] ??
                  'Conecte sua conta Mercado Pago pra receber pagamentos automaticamente na loja.'}
              </p>
              {hasCredenciais ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-uf-silver flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Mercado Pago conectado.
                    {credencialMask ? <span className="text-uf-silver-dim">({credencialMask})</span> : null}
                  </span>
                  <div className="flex items-center gap-3 flex-none">
                    <button
                      type="button"
                      onClick={handleConnectMp}
                      disabled={connectingMp || disconnectingMp}
                      className="text-xs text-uf-silver-dim hover:text-uf-silver underline"
                    >
                      Reconectar
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectMp}
                      disabled={connectingMp || disconnectingMp}
                      className="text-xs text-red-400/80 hover:text-red-400 underline flex items-center gap-1"
                    >
                      {disconnectingMp ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Desconectar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectMp}
                  disabled={connectingMp}
                  className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                >
                  {connectingMp ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  Conectar Mercado Pago
                </button>
              )}
            </div>
          )}

          {tab === 'redes' && !hasActiveSub && (
            <p className="text-sm text-uf-silver-dim uf-glass rounded-2xl p-5">{tabLocked}</p>
          )}
          {tab === 'redes' && hasActiveSub && (
            <form onSubmit={handleSaveRedes} className="uf-glass rounded-2xl p-6 space-y-4">
              <p className="text-xs text-uf-silver-dim">{content['meu_plano.redes_hint'] ?? 'WhatsApp obrigatório. Instagram e Facebook opcionais.'}</p>
              <div>
                <label className="label">WhatsApp *</label>
                <input className="input-field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} type="tel" required />
              </div>
              <div>
                <label className="label flex items-center gap-1.5">
                  <AtSign className="w-3.5 h-3.5" /> Instagram
                </label>
                <div className="flex items-center gap-1 input-field !py-0 !px-3">
                  <span className="text-uf-silver-dim text-sm">@</span>
                  <input
                    className="flex-1 bg-transparent outline-none py-2.5 text-sm"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value.replace(/^@/, ''))}
                  />
                </div>
              </div>
              <div>
                <label className="label flex items-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5" /> Facebook
                </label>
                <input className="input-field" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="URL ou @página" />
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full py-3">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar redes
              </button>
            </form>
          )}
          {tab === 'assistente-ia' && isAssistantIaBetaTenant(me.slug, me.vertical) && me.slug && <AssistantIaTab tenantSlug={me.slug} />}
          <Outlet />
        </motion.div>
      </div>
    </main>
  )
}

function mapFieldsToMe(prev: MeResponse, fields: Parameters<typeof api.editarOnboarding>[0]): Partial<MeResponse> {
  const patch: Partial<MeResponse> = {}
  if (fields.nome_loja != null) patch.loja_nome = fields.nome_loja
  if (fields.endereco !== undefined) patch.endereco = fields.endereco ?? null
  if (fields.endereco_numero !== undefined) patch.endereco_numero = fields.endereco_numero ?? null
  if (fields.logo_url !== undefined) patch.logo_url = fields.logo_url ?? null
  if (fields.cor_principal != null) patch.cor_principal = fields.cor_principal
  if (fields.layout_style != null) patch.layout_style = fields.layout_style
  if (fields.forma_pagamento != null) patch.forma_pagamento = fields.forma_pagamento
  if (fields.plataforma_pagamento !== undefined) patch.plataforma_pagamento = fields.plataforma_pagamento ?? null
  if (fields.whatsapp !== undefined) patch.whatsapp = fields.whatsapp ?? ''
  if (fields.instagram !== undefined) patch.instagram = fields.instagram ?? null
  if (fields.facebook !== undefined) patch.facebook = fields.facebook ?? null
  if (fields.landing_headline !== undefined) patch.landing_headline = fields.landing_headline ?? null
  if (fields.landing_sub !== undefined) patch.landing_sub = fields.landing_sub ?? null
  if (fields.landing_badge !== undefined) patch.landing_badge = fields.landing_badge ?? null
  if (fields.landing_hero_image_url !== undefined) {
    patch.landing_hero_image_url = fields.landing_hero_image_url?.trim() ? fields.landing_hero_image_url.trim() : null
  }
  if (fields.cart_fab_style != null) patch.cart_fab_style = fields.cart_fab_style
  if (fields.cart_fab_animate != null) patch.cart_fab_animate = fields.cart_fab_animate
  if (fields.vende_mais_18 != null) patch.vende_mais_18 = fields.vende_mais_18
  if (fields.vender_externamente != null) patch.vender_externamente = fields.vender_externamente
  if (fields.apenas_retirada != null) patch.apenas_retirada = fields.apenas_retirada
  if (fields.pagamento_na_retirada != null) patch.pagamento_na_retirada = fields.pagamento_na_retirada
  if (fields.entrega_somente_pix != null) patch.entrega_somente_pix = fields.entrega_somente_pix
  if (fields.pagamento_manual != null) patch.pagamento_manual = fields.pagamento_manual
  return { ...prev, ...patch }
}
