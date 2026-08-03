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
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [integracao, setIntegracao] = useState<IntegracaoPagamento>('mercado_pago')
  const [credencial, setCredencial] = useState('')
  const [hasCredenciais, setHasCredenciais] = useState(false)

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
        setVenderExternamente(m.vender_externamente !== false)
        // Prefer explicit flag; fall back to forma_pagamento until API redeploy ships the field.
        setHasCredenciais(!!m.has_plataforma_credenciais || m.forma_pagamento === 'plataforma')
        if (m.plataforma_pagamento) {
          const plat = m.tipo_documento === 'cpf' ? 'mercado_pago' : m.plataforma_pagamento
          setIntegracao(plat)
        } else {
          setIntegracao('mercado_pago')
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
    if (!confirm('Tem certeza que quer cancelar sua assinatura?')) return
    setBusyPlano(true)
    try {
      await api.cancelar()
      setMe((prev) => (prev ? { ...prev, status: 'cancelado' } : prev))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar.')
    } finally {
      setBusyPlano(false)
    }
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
                <Link key={p.code} to={`/assinar?plano=${p.code}`} className="uf-glass uf-glass-hover rounded-2xl p-4 block">
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

          {tab === 'plano' && me.plano && (
            <div className="space-y-4">
              <section className="uf-glass rounded-2xl p-6">
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
                {me.status !== 'cancelado' && (
                  <button onClick={handleCancelar} disabled={busyPlano} className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Cancelar assinatura
                  </button>
                )}
              </section>

              {hasActiveSub && (
                <form onSubmit={handleSavePreferenciasVenda} className="uf-glass rounded-2xl p-6 space-y-4">
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
                    />
                    <span className="text-xs text-uf-silver-dim">
                      <span className="block text-uf-silver font-semibold mb-0.5">
                        Aceitar apenas compras com retirada na loja
                      </span>
                      Clientes da vitrine só podem comprar com retirada — sem entrega, frete ou motoboy.
                    </span>
                  </label>
                  <button type="submit" disabled={saving} className="btn-primary w-full py-3">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar preferências
                  </button>
                </form>
              )}
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
  return { ...prev, ...patch }
}
