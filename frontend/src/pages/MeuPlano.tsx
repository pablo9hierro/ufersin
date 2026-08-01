import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, CreditCard, ExternalLink, Loader2, Palette, Save, Sparkles, Store } from 'lucide-react'
import { api, ApiError, type FormaPagamento, type MeResponse, type PlanoCode, type PlataformaPagamento, type TipoDocumento } from '../lib/api'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { PLAN_MAP } from '../lib/plans'
import { storeAdminLoginUrl } from '../lib/ecommerceUrl'
import StorefrontStylePicker from '../components/StorefrontStylePicker'
import { isStorefrontStyle, type StorefrontStyle } from '../lib/storefrontStyles'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const CATEGORIAS = ['Alimentação', 'Moda', 'Beleza', 'Casa & decoração', 'Eletrônicos', 'Pet shop', 'Outro']
const CORES = ['#0f5132', '#4d7cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']
const PLATAFORMAS: { value: PlataformaPagamento; label: string }[] = [
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'abacate_pay', label: 'AbacatePay' },
]

// /meu-plano: editar etapa 1 + etapa 2 do onboarding a qualquer momento
// (nunca re-provisiona o tenant — PUT /api/onboarding) + trocar de plano.
export default function MeuPlano() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyPlano, setBusyPlano] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Etapa 1
  const [nomeLoja, setNomeLoja] = useState('')
  const [categoria, setCategoria] = useState('')
  const [endereco, setEndereco] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [corPrincipal, setCorPrincipal] = useState(CORES[0])
  const [layoutStyle, setLayoutStyle] = useState<StorefrontStyle>('ufersin')
  const [documento, setDocumento] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')
  const [venderExternamente, setVenderExternamente] = useState(true)

  // Etapa 2
  const [whatsapp, setWhatsapp] = useState('')
  const [whatsappHabilitado, setWhatsappHabilitado] = useState(true)
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('manual')
  const [plataformaPagamento, setPlataformaPagamento] = useState<PlataformaPagamento>('mercado_pago')
  const [credencial, setCredencial] = useState('')

  useEffect(() => {
    if (!isAuthenticated) return
    api
      .me()
      .then((m) => {
        setMe(m)
        setNomeLoja(m.loja_nome ?? '')
        setCategoria(m.categoria ?? '')
        setEndereco(m.endereco ?? '')
        setLogoUrl(m.logo_url ?? '')
        setCorPrincipal(m.cor_principal || CORES[0])
        setLayoutStyle(isStorefrontStyle(m.layout_style) ? m.layout_style : 'ufersin')
        setDocumento(m.documento ?? '')
        setTipoDocumento(m.tipo_documento ?? 'cnpj')
        setVenderExternamente(m.vender_externamente)
        setWhatsapp(m.whatsapp ?? '')
        setWhatsappHabilitado(m.whatsapp_habilitado)
        setFormaPagamento(m.forma_pagamento)
        setPlataformaPagamento(m.plataforma_pagamento ?? 'mercado_pago')
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          navigate('/completar-conta', { replace: true })
          return
        }
        setError(e instanceof ApiError ? e.message : 'Não foi possível carregar seus dados.')
      })
      .finally(() => setLoading(false))
  }, [isAuthenticated, navigate])

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    if (!nomeLoja.trim()) {
      setError('Informe o nome da empresa.')
      return
    }
    setSaving(true)
    try {
      await api.editarOnboarding({
        nome_loja: nomeLoja.trim(),
        categoria: categoria.trim() || undefined,
        endereco: endereco.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        cor_principal: corPrincipal,
        layout_style: venderExternamente ? layoutStyle : 'ufersin',
        documento: documento.replace(/\D/g, '') || undefined,
        tipo_documento: tipoDocumento,
        vender_externamente: venderExternamente,
        whatsapp: whatsappHabilitado ? whatsapp.trim() || undefined : '',
        whatsapp_habilitado: whatsappHabilitado,
        forma_pagamento: formaPagamento,
        plataforma_pagamento: formaPagamento === 'plataforma' ? plataformaPagamento : undefined,
        plataforma_credenciais: formaPagamento === 'plataforma' && credencial.trim() ? { token: credencial.trim() } : undefined,
      })
      setMe((prev) =>
        prev
          ? {
              ...prev,
              loja_nome: nomeLoja.trim(),
              cor_principal: corPrincipal,
              layout_style: venderExternamente ? layoutStyle : 'ufersin',
              vender_externamente: venderExternamente,
              whatsapp_habilitado: whatsappHabilitado,
            }
          : prev
      )
      setSaved(true)
      setCredencial('')
      window.setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const handleMudarPlano = async (novo: PlanoCode) => {
    if (!me || busyPlano) return
    setBusyPlano(true)
    try {
      await api.mudarPlano(novo)
      setMe((prev) => (prev ? { ...prev, plano: novo } : prev))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível trocar de plano.')
    } finally {
      setBusyPlano(false)
    }
  }

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

  if (!me.plano) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
        <div className="uf-mesh" />
        <div className="max-w-2xl mx-auto relative z-10">
          <button onClick={() => navigate('/dashboard')} className="btn-ghost text-sm mb-6">
            <ArrowLeft className="w-4 h-4" /> Voltar ao painel
          </button>
          <h1 className="text-2xl font-black mb-2">Meu plano</h1>
          <p className="text-sm text-uf-silver-dim mb-8">Você ainda não assinou — escolha um plano pra liberar a loja.</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {PLAN_ORDER.map((code) => (
              <Link key={code} to={`/assinar?plano=${code}`} className="uf-glass uf-glass-hover rounded-2xl p-4 block">
                <p className="font-bold text-sm">{PLAN_MAP[code].name}</p>
                <p className="text-lg font-black uf-text mt-1">R$ {PLAN_MAP[code].price}/mês</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    )
  }

  const canEditOnboarding = me.onboarding_status === 'provisionado'
  const panelUrl =
    me.onboarding_status === 'provisionado' && me.slug ? storeAdminLoginUrl(me.slug, me.email) : null

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="max-w-2xl mx-auto relative z-10">
        <button onClick={() => navigate('/dashboard')} className="btn-ghost text-sm mb-6">
          <ArrowLeft className="w-4 h-4" /> Voltar ao painel
        </button>

        <h1 className="text-2xl sm:text-3xl font-black mb-1">Meu plano</h1>
        <p className="text-sm text-uf-silver-dim mb-8">Gerencie sua assinatura, os dados da loja e o acesso ao painel.</p>

        <section className="uf-glass rounded-2xl p-6 mb-6">
          <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
            <Sparkles className="w-4 h-4" /> Plano atual: {PLAN_MAP[me.plano].name}
          </h2>
          <p className="text-sm text-uf-silver-dim mb-4">
            Status: {me.status} · R$ {(me.valor_mensal ?? 0).toFixed(2)}/mês
          </p>
          <div className="flex flex-wrap gap-2">
            {PLAN_ORDER.filter((p) => p !== me.plano).map((p) => (
              <button key={p} onClick={() => handleMudarPlano(p)} disabled={busyPlano} className="btn-secondary text-xs px-3 py-2">
                Mudar pra {PLAN_MAP[p].name}
              </button>
            ))}
          </div>
        </section>

        {panelUrl && (
          <section className="uf-glass rounded-2xl p-6 mb-6">
            <h2 className="font-bold mb-3 text-sm text-uf-silver-dim uppercase tracking-wide">Painel da loja</h2>
            <a href={panelUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm px-4 py-2.5 inline-flex">
              Entrar no painel
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <p className="text-[11px] text-uf-silver-dim mt-2">Mesmo e-mail e senha da conta Resolutoo.</p>
          </section>
        )}

        {!canEditOnboarding && (
          <div className="uf-glass rounded-2xl p-5 mb-6 border-uf-blue/30">
            <p className="font-semibold text-sm mb-1">Onboarding ainda não finalizado</p>
            <p className="text-xs text-uf-silver-dim mb-3">Complete a configuração inicial pra liberar a edição contínua e o painel da loja.</p>
            <Link to="/onboarding" className="btn-primary text-sm px-4 py-2.5 inline-flex">
              Continuar onboarding
            </Link>
          </div>
        )}

        <form onSubmit={handleSave} className={`space-y-6 ${!canEditOnboarding ? 'opacity-60 pointer-events-none' : ''}`}>
          <section className="uf-glass rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-sm text-uf-silver-dim uppercase tracking-wide flex items-center gap-2">
              <Store className="w-4 h-4" /> Etapa 1 — Empresa &amp; vitrine
            </h2>

            <div>
              <label className="label">Nome da empresa</label>
              <input className="input-field" value={nomeLoja} onChange={(e) => setNomeLoja(e.target.value)} />
            </div>

            <div>
              <label className="label">Documento</label>
              <div className="flex gap-2 mb-2">
                {(['cnpj', 'cpf'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipoDocumento(t)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase ${tipoDocumento === t ? 'bg-uf-blue text-white' : 'bg-white/5 text-uf-silver-dim'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <input className="input-field" value={documento} onChange={(e) => setDocumento(e.target.value)} />
            </div>

            <div>
              <label className="label">Categoria</label>
              <select className="input-field" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {!CATEGORIAS.includes(categoria) && categoria ? <option value={categoria}>{categoria}</option> : null}
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Endereço</label>
              <input className="input-field" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
            </div>

            <div>
              <label className="label">Logo (link da imagem)</label>
              <input className="input-field" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
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
                    className={`w-9 h-9 rounded-full border-2 transition-transform ${corPrincipal === c ? 'scale-110 border-white' : 'border-transparent'}`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>

            <div className="uf-glass rounded-2xl px-4 py-4 space-y-4 border border-white/10">
              <div>
                <p className="label mb-1 flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5" /> Vitrine pra clientes
                </p>
                <p className="text-[11px] text-uf-silver-dim leading-snug">
                  Vai vender pelo site ou só usar o painel/PDV internamente?
                </p>
              </div>

              <label className="rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer bg-black/20 border border-white/5">
                <input
                  type="checkbox"
                  checked={!venderExternamente}
                  onChange={(e) => setVenderExternamente(!e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                />
                <span className="text-xs text-uf-silver-dim">
                  <span className="block text-uf-silver font-semibold mb-0.5">Vender apenas pro público interno</span>
                  Desativa a vitrine online — sem vitrine, a escolha de layout some.
                </span>
              </label>

              {venderExternamente && (
                <StorefrontStylePicker value={layoutStyle} onChange={setLayoutStyle} lojaNome={nomeLoja} corPrincipal={corPrincipal} />
              )}
            </div>
          </section>

          <section className="uf-glass rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-sm text-uf-silver-dim uppercase tracking-wide flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> Etapa 2 — Pagamento &amp; WhatsApp
            </h2>

            <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={whatsappHabilitado} onChange={(e) => setWhatsappHabilitado(e.target.checked)} className="w-4 h-4 mt-0.5" />
              <span className="text-xs text-uf-silver-dim">
                <span className="block text-uf-silver font-semibold mb-0.5">Notificações por WhatsApp</span>
                Se desmarcar, a seção de conectar WhatsApp some de Configurações e os avisos automáticos param.
              </span>
            </label>

            {whatsappHabilitado && (
              <div>
                <label className="label">WhatsApp da loja</label>
                <input className="input-field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} type="tel" inputMode="numeric" />
              </div>
            )}

            <div>
              <label className="label">Pagamento</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setFormaPagamento('manual')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${formaPagamento === 'manual' ? 'bg-uf-blue text-white' : 'bg-white/5 text-uf-silver-dim'}`}
                >
                  Cobrança manual
                </button>
                <button
                  type="button"
                  onClick={() => setFormaPagamento('plataforma')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${formaPagamento === 'plataforma' ? 'bg-uf-blue text-white' : 'bg-white/5 text-uf-silver-dim'}`}
                >
                  Gerar QR Pix
                </button>
              </div>
              {formaPagamento === 'plataforma' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {PLATAFORMAS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPlataformaPagamento(p.value)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${plataformaPagamento === p.value ? 'bg-uf-blue text-white' : 'bg-white/5 text-uf-silver-dim'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    className="input-field"
                    value={credencial}
                    onChange={(e) => setCredencial(e.target.value)}
                    placeholder="Nova credencial (deixe em branco pra manter a atual)"
                  />
                </div>
              )}
            </div>
          </section>

          {error && <p className="error-msg">{error}</p>}
          {saved && <p className="text-sm text-emerald-400">Salvo!</p>}

          <button type="submit" disabled={saving} className="btn-primary w-full py-3">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar alterações
          </button>
        </form>

        <p className="text-center mt-6">
          <Link to="/dashboard" className="text-xs text-uf-silver-dim hover:text-uf-silver">
            Voltar ao painel
          </Link>
        </p>
      </motion.div>
    </main>
  )
}
