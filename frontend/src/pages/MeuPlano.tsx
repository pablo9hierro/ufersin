import { useEffect, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  AtSign,
  CreditCard,
  ExternalLink,
  Loader2,
  LogOut,
  Palette,
  Save,
  Share2,
  Sparkles,
  Upload,
} from 'lucide-react'
import {
  api,
  ApiError,
  type CancelReasonCode,
  type FormaPagamento,
  type MeResponse,
  type PlataformaPagamento,
  type TipoDocumento,
} from '../lib/api'
import { authStore, useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { fetchPlans, formatBRL, getPlans, getPlanMap, planDisplayName, priceForCycle } from '../lib/plans'
import { storeAdminLoginUrl, storePublicUrl } from '../lib/ecommerceUrl'
import AddressField from '../components/AddressField'
import StorefrontCmsPreview, { type CartFabStyle } from '../components/StorefrontCmsPreview'
import { isStorefrontStyle, type StorefrontStyle } from '../lib/storefrontStyles'
import { supabase } from '../lib/supabaseClient'

const CORES = ['#0f5132', '#4d7cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']
const PLATAFORMAS: { value: PlataformaPagamento; label: string }[] = [
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'abacate_pay', label: 'Abacate Pay' },
]

type Tab = 'plano' | 'layout' | 'financeiro' | 'redes'
type IntegracaoPagamento = PlataformaPagamento

const TAB_PATH: Record<Tab, string> = {
  plano: '/meu-plano',
  layout: '/meu-plano/layout',
  financeiro: '/meu-plano/financeiro',
  redes: '/meu-plano/redes',
}

function tabFromParam(param: string | undefined): Tab {
  if (param === 'layout' || param === 'financeiro' || param === 'redes') return param
  return 'plano'
}

function plataformasParaDocumento(tipo: TipoDocumento) {
  if (tipo === 'cpf') return PLATAFORMAS.filter((p) => p.value === 'mercado_pago')
  return PLATAFORMAS
}

function contentMap(items: { key: string; value: string }[]) {
  return Object.fromEntries(items.map((i) => [i.key, i.value]))
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
  const [cartFabStyle, setCartFabStyle] = useState<CartFabStyle>('sacola')
  const [cartFabAnimate, setCartFabAnimate] = useState(false)
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')

  const [whatsapp, setWhatsapp] = useState('')
  const [instagram, setInstagram] = useState('')
  const [facebook, setFacebook] = useState('')
  const [vendeMais18, setVendeMais18] = useState(false)
  const [apenasRetirada, setApenasRetirada] = useState(false)
  const [pagamentoNaRetirada, setPagamentoNaRetirada] = useState(false)
  const [entregaSomentePix, setEntregaSomentePix] = useState(false)
  const [pagamentoManual, setPagamentoManual] = useState(false)
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [integracao, setIntegracao] = useState<IntegracaoPagamento>('mercado_pago')
  const [credencial, setCredencial] = useState('')
  const [hasCredenciais, setHasCredenciais] = useState(false)

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelReasons, setCancelReasons] = useState<CancelReasonCode[]>([])
  const [competitorNote, setCompetitorNote] = useState('')
  const [otherNote, setOtherNote] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [cancelResultMsg, setCancelResultMsg] = useState<string | null>(null)

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
        const [m, ct] = await Promise.all([api.me(), api.listPublicContent(), fetchPlans()])
        if (cancelled) return
        setMe(m)
        setContent(contentMap(ct))
        setPlansLoaded(true)
        setNomeLoja(m.loja_nome ?? '')
        setEndereco(m.endereco ?? '')
        setEnderecoNumero(m.endereco_numero ?? '')
        setLogoUrl(m.logo_url ?? '')
        setCorPrincipal(m.cor_principal || CORES[0])
        setLayoutStyle(isStorefrontStyle(m.layout_style) ? m.layout_style : 'ufersin')
        setLandingHeadline(m.landing_headline ?? '')
        setLandingSub(m.landing_sub ?? '')
        setLandingBadge(m.landing_badge ?? '')
        setCartFabStyle(m.cart_fab_style === 'cart_icon' ? 'cart_icon' : 'sacola')
        setCartFabAnimate(!!m.cart_fab_animate)
        setTipoDocumento(m.tipo_documento ?? 'cnpj')
        setWhatsapp(m.whatsapp ?? '')
        setInstagram((m.instagram ?? '').replace(/^@/, ''))
        setFacebook(m.facebook ?? '')
        setVendeMais18(!!m.vende_mais_18)
        setApenasRetirada(!!m.apenas_retirada)
        setPagamentoNaRetirada(!!m.pagamento_na_retirada)
        setEntregaSomentePix(!!m.entrega_somente_pix)
        setPagamentoManual(!!m.pagamento_manual)
        setVenderExternamente(m.vender_externamente !== false)
        // Prefer explicit flag; fall back to forma_pagamento until API redeploy ships the field.
        setHasCredenciais(!!m.has_plataforma_credenciais || m.forma_pagamento === 'plataforma')
        if (m.plataforma_pagamento) {
          const plat = m.tipo_documento === 'cpf' ? 'mercado_pago' : m.plataforma_pagamento
          setIntegracao(plat)
        } else {
          setIntegracao('mercado_pago')
        }
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
                pagamento_na_retirada?: boolean
                entrega_somente_pix?: boolean
                pagamento_manual?: boolean
                vende_mais_18?: boolean
                vender_externamente?: boolean
              }
              if (typeof row.apenas_retirada === 'boolean') setApenasRetirada(row.apenas_retirada)
              if (typeof row.pagamento_na_retirada === 'boolean') setPagamentoNaRetirada(row.pagamento_na_retirada)
              if (typeof row.entrega_somente_pix === 'boolean') setEntregaSomentePix(row.entrega_somente_pix)
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

  if (!ready || loading) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!me) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <p className="text-uf-silver-dim">{error || 'Não foi possível carregar seu plano.'}</p>
      </main>
    )
  }

  const planMap = getPlanMap()
  const hasActiveSub = me.plano != null && me.status === 'ativo'
  const tabLocked = content['meu_plano.tab_locked'] ?? 'Você ainda não assinou um plano para gerenciar.'
  const panelUrl = me.onboarding_status === 'provisionado' && me.slug ? storeAdminLoginUrl(me.slug, me.email) : null
  const publicUrl = me.onboarding_status === 'provisionado' && me.slug ? storePublicUrl(me.slug) : null

  const handleLogout = async () => {
    await authStore.signOut('lojista')
    navigate('/')
  }

  const handleCancelar = async () => {
    if (!cancelConfirm) {
      setError('Marque "Quer realmente cancelar?" para continuar.')
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
        reasons: cancelReasons,
        competitor_note: cancelReasons.includes('found_better') ? competitorNote.trim() || undefined : undefined,
        other_note: cancelReasons.includes('other') ? otherNote.trim() || undefined : undefined,
        note: cancelNote.trim() || undefined,
      })
      setMe((prev) => (prev ? { ...prev, status: 'cancelado' } : prev))
      setCancelOpen(false)
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
        fields.vender_externamente != null
      ) {
        const { error: prefsErr } = await supabase.schema('resolutoo').rpc('set_my_sale_prefs', {
          p_apenas_retirada: fields.apenas_retirada ?? null,
          p_vende_mais_18: fields.vende_mais_18 ?? null,
          p_vender_externamente: fields.vender_externamente ?? null,
          p_pagamento_na_retirada: fields.pagamento_na_retirada ?? null,
          p_entrega_somente_pix: fields.entrega_somente_pix ?? null,
          p_pagamento_manual: fields.pagamento_manual ?? null,
        })
        if (prefsErr) console.warn('set_my_sale_prefs:', prefsErr.message)
      }
      setMe((prev) => (prev ? { ...prev, ...mapFieldsToMe(prev, fields) } : prev))
      setSaved(true)
      setCredencial('')
      if (
        fields.plataforma_credenciais &&
        typeof fields.plataforma_credenciais.token === 'string' &&
        fields.plataforma_credenciais.token.trim()
      ) {
        setHasCredenciais(true)
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
      cart_fab_style: cartFabStyle,
      cart_fab_animate: cartFabAnimate,
      vende_mais_18: vendeMais18,
    })
  }

  const handleSaveFinanceiro = (e: React.FormEvent) => {
    e.preventDefault()
    const plataformaPagamento: PlataformaPagamento = tipoDocumento === 'cpf' ? 'mercado_pago' : integracao
    const token = credencial.trim()
    // Online PIX only with a registered token (new or already saved).
    const ativarPlataforma = !!token || hasCredenciais
    const formaPagamento: FormaPagamento = ativarPlataforma ? 'plataforma' : 'manual'
    saveOnboarding({
      forma_pagamento: formaPagamento,
      plataforma_pagamento: plataformaPagamento,
      plataforma_credenciais: token ? { token } : undefined,
    })
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
    saveOnboarding({
      vende_mais_18: vendeMais18,
      vender_externamente: venderExternamente,
      apenas_retirada: apenasRetirada,
      pagamento_na_retirada: pagamentoNaRetirada,
      entrega_somente_pix: entregaSomentePix,
      pagamento_manual: pagamentoManual,
    })
  }

  const TABS: { id: Tab; label: string; path: string }[] = [
    { id: 'plano', label: 'Meu plano atual', path: TAB_PATH.plano },
    { id: 'layout', label: 'Layout', path: TAB_PATH.layout },
    { id: 'financeiro', label: 'Financeiro', path: TAB_PATH.financeiro },
    { id: 'redes', label: 'Redes sociais', path: TAB_PATH.redes },
  ]

  if (!me.plano) {
    const noPlanMsg = content['meu_plano.no_plan'] ?? 'Escolha um plano pra começar.'
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver relative">
        <div className="uf-mesh" />
        <header className="border-b border-white/5 px-5 py-4 relative z-10">
          <div className="uf-container flex items-center justify-between">
            <Link to="/" className="text-lg font-black uf-text">
              Resolutoo
            </Link>
            <div className="flex items-center gap-3">
              <Link to="/esqueci-senha" className="btn-ghost text-sm">
                Trocar senha
              </Link>
              <button onClick={handleLogout} className="btn-ghost text-sm">
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </div>
          </div>
        </header>
        <div className="uf-container px-5 py-12 relative z-10 max-w-3xl mx-auto">
          <h1 className="text-2xl font-black mb-2">Meu plano</h1>
          <p className="text-sm text-uf-silver-dim mb-8">{noPlanMsg}</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {plansLoaded &&
              getPlans().map((p) => (
                <Link
                  key={p.code}
                  to={`/assinar?plano=${p.code}`}
                  className="uf-glass uf-glass-hover rounded-2xl p-4 block"
                  data-testid={`plan-cta-${p.code}`}
                >
                  <p className="font-bold text-sm">{p.name}</p>
                  <p className="text-lg font-black uf-text mt-1">R$ {formatBRL(p.price)}/mês</p>
                </Link>
              ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver relative">
      <div className="uf-mesh" />
      <header className="border-b border-white/5 px-5 py-4 relative z-10">
        <div className="uf-container flex items-center justify-between">
          <Link to="/" className="text-lg font-black uf-text">
            Resolutoo
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/esqueci-senha" className="btn-ghost text-sm hidden sm:inline-flex">
              Trocar senha
            </Link>
            <button onClick={handleLogout} className="btn-ghost text-sm">
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="uf-container px-5 py-8 relative z-10 max-w-2xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-black mb-1">{me.loja_nome}</h1>
          <p className="text-sm text-uf-silver-dim mb-6">Hub do lojista — plano, layout e integrações.</p>

          {(panelUrl || publicUrl) && (
            <div className="flex flex-wrap gap-2 mb-6">
              {publicUrl && (
                <a href={publicUrl} target="_blank" rel="noreferrer" className="btn-primary text-xs px-3 py-2 inline-flex">
                  Ver loja
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {panelUrl && (
                <a href={panelUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs px-3 py-2 inline-flex">
                  Painel da loja
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
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

          {tab === 'plano' && me.plano && (
            <div className="space-y-4">
              {hasActiveSub && (
                <form onSubmit={handleSavePreferenciasVenda} className="uf-glass rounded-2xl p-6 space-y-4" data-testid="preferencias-venda">
                  <h2 className="font-bold text-sm text-uf-silver-dim uppercase tracking-wide">Preferências de venda</h2>
                  <p className="text-xs text-uf-silver-dim">
                    Defina se a loja vende pro público externo, se exige verificação 18+ no checkout e se aceita só retirada.
                  </p>
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
                        Minha loja vende produtos para maiores de 18 anos
                      </span>
                      Se marcado, o checkout do cliente exige data de nascimento e consentimento 18+.
                    </span>
                  </label>
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
                        Aceitar apenas compras com retirada na loja
                      </span>
                      Clientes da vitrine só podem comprar com retirada — sem entrega, frete ou motoboy.
                    </span>
                  </label>
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pagamentoNaRetirada}
                      onChange={(e) => setPagamentoNaRetirada(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                      data-testid="pref-pagamento-na-retirada"
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        Pagamento só no ato da retirada
                      </span>
                      Pagamento de pedidos para retirada só é processado no ato da retirada na loja —
                      o checkout confirma o pedido sem cobrar Pix online.
                    </span>
                  </label>
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entregaSomentePix}
                      onChange={(e) => setEntregaSomentePix(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                      data-testid="pref-entrega-somente-pix"
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        Só aceito pedidos de entrega pagos com Pix no checkout
                      </span>
                      Entrega só com Pix já pago online. Cartão e dinheiro ficam só para retirada na loja.
                    </span>
                  </label>
                  <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pagamentoManual}
                      onChange={(e) => setPagamentoManual(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                      data-testid="pref-pagamento-manual"
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        Ativar modo pagamento manual
                      </span>
                      PDV, retirada, entrega, vendedor e checkout usam confirmação manual (sem QR Pix).
                      Desmarque pra voltar ao Pix online quando houver credenciais de plataforma.
                    </span>
                  </label>
                  <button type="submit" disabled={saving} className="btn-primary w-full py-3" data-testid="salvar-preferencias">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar preferências
                  </button>
                </form>
              )}

              <section className="uf-glass rounded-2xl p-6" data-testid="meu-plano-atual">
                <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                  <Sparkles className="w-4 h-4" /> {planMap[me.plano]?.name ?? planDisplayName(me.plano)}
                </h2>
                <p className="text-sm text-uf-silver-dim mb-1">
                  Status: <span className="text-uf-silver">{me.status}</span>
                </p>
                <p className="text-2xl font-black mb-1">R$ {formatBRL(me.valor_mensal ?? planMap[me.plano]?.price ?? 0)}/mês</p>
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
                {me.status !== 'cancelado' && !cancelOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setCancelOpen(true)
                      setCancelConfirm(false)
                      setCancelReasons([])
                      setCompetitorNote('')
                      setOtherNote('')
                      setCancelNote('')
                      setError(null)
                    }}
                    disabled={busyPlano}
                    className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20"
                    data-testid="abrir-cancelar-assinatura"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Cancelar assinatura
                  </button>
                )}
                {me.status !== 'cancelado' && cancelOpen && (
                  <div className="mt-4 space-y-3 border-t border-white/10 pt-4" data-testid="cancelar-assinatura-form">
                    <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cancelConfirm}
                        onChange={(e) => setCancelConfirm(e.target.checked)}
                        className="w-4 h-4 mt-0.5"
                        data-testid="cancel-confirm"
                      />
                      <span className="text-sm text-uf-silver font-semibold">Quer realmente cancelar?</span>
                    </label>

                    <p className="text-xs text-uf-silver-dim">Motivo (pode marcar mais de um):</p>

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

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleCancelar}
                        disabled={busyPlano}
                        className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20"
                        data-testid="confirmar-cancelamento"
                      >
                        {busyPlano ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                        Confirmar cancelamento
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelOpen(false)}
                        disabled={busyPlano}
                        className="btn-ghost text-xs px-3 py-2"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                )}
              </section>
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
                  lojaNome: nomeLoja,
                  endereco: [endereco, enderecoNumero].filter(Boolean).join(', '),
                  logoUrl,
                  corPrincipal,
                  layoutStyle,
                  landingHeadline,
                  landingSub,
                  landingBadge,
                  cartFabStyle,
                  cartFabAnimate,
                }}
                onChange={(patch) => {
                  if (patch.layoutStyle != null) setLayoutStyle(patch.layoutStyle)
                  if (patch.landingHeadline != null) setLandingHeadline(patch.landingHeadline)
                  if (patch.landingSub != null) setLandingSub(patch.landingSub)
                  if (patch.landingBadge != null) setLandingBadge(patch.landingBadge)
                  if (patch.cartFabStyle != null) setCartFabStyle(patch.cartFabStyle)
                  if (patch.cartFabAnimate != null) setCartFabAnimate(patch.cartFabAnimate)
                }}
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
            <form onSubmit={handleSaveFinanceiro} className="uf-glass rounded-2xl p-6 space-y-4">
              <p className="text-xs text-uf-silver-dim">
                {content['meu_plano.financeiro_hint'] ??
                  'Cadastre a credencial da plataforma pra cobrança Pix online. Sem credencial, vendas ficam em cobrança manual.'}
              </p>
              <div>
                <label className="label flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4" /> Plataforma
                </label>
                <div className="space-y-2">
                  {plataformasParaDocumento(tipoDocumento).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setIntegracao(p.value)}
                      className={`w-full text-left uf-glass rounded-xl px-3 py-2.5 border ${integracao === p.value ? 'border-uf-blue' : 'border-transparent'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {tipoDocumento === 'cpf' && (
                  <p className="text-[11px] text-uf-silver-dim mt-2">Com CPF só Mercado Pago está disponível. Abacate Pay exige CNPJ.</p>
                )}
              </div>
              <div>
                <label className="label">Credencial (token)</label>
                <input
                  className="input-field"
                  value={credencial}
                  onChange={(e) => setCredencial(e.target.value)}
                  placeholder={hasCredenciais ? 'Deixe em branco pra manter a atual' : 'Access Token / chave de API'}
                />
                <p className="text-[11px] text-uf-silver-dim mt-1">
                  {hasCredenciais
                    ? 'Credencial cadastrada — Pix online e confirmação automática ativos.'
                    : 'Sem credencial, o site não gera cobrança Pix; o lojista confirma pagamentos manualmente.'}
                </p>
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full py-3">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar financeiro
              </button>
            </form>
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
