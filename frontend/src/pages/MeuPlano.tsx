import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, CreditCard, Loader2, Save, Sparkles } from 'lucide-react'
import { api, ApiError, type FormaPagamento, type MeResponse, type PlanoCode, type PlataformaPagamento, type TipoDocumento } from '../lib/api'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { PLAN_MAP } from '../lib/plans'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const PLATAFORMAS: { value: PlataformaPagamento; label: string }[] = [
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'abacate_pay', label: 'AbacatePay' },
]

// /meu-plano: editar os dados do onboarding a qualquer momento (nunca
// re-provisiona o tenant, só atualiza os campos — ver PUT /api/onboarding)
// + trocar de plano (upgrade/downgrade, já existente via api.mudarPlano).
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

  const [categoria, setCategoria] = useState('')
  const [endereco, setEndereco] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [documento, setDocumento] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')
  const [venderExternamente, setVenderExternamente] = useState(true)
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
        setCategoria(m.categoria ?? '')
        setEndereco(m.endereco ?? '')
        setLogoUrl(m.logo_url ?? '')
        setDocumento(m.documento ?? '')
        setTipoDocumento(m.tipo_documento ?? 'cnpj')
        setVenderExternamente(m.vender_externamente)
        setWhatsapp(m.whatsapp ?? '')
        setWhatsappHabilitado(m.whatsapp_habilitado)
        setFormaPagamento(m.forma_pagamento)
        setPlataformaPagamento(m.plataforma_pagamento ?? 'mercado_pago')
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar seus dados.'))
      .finally(() => setLoading(false))
  }, [isAuthenticated])

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
    setSaving(true)
    try {
      await api.editarOnboarding({
        categoria: categoria.trim() || undefined,
        endereco: endereco.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        documento: documento.replace(/\D/g, '') || undefined,
        tipo_documento: tipoDocumento,
        vender_externamente: venderExternamente,
        whatsapp: whatsappHabilitado ? whatsapp.trim() || undefined : '',
        whatsapp_habilitado: whatsappHabilitado,
        forma_pagamento: formaPagamento,
        plataforma_pagamento: formaPagamento === 'plataforma' ? plataformaPagamento : undefined,
        plataforma_credenciais: formaPagamento === 'plataforma' && credencial.trim() ? { token: credencial.trim() } : undefined,
      })
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

  if (!me.plano) return <Navigate to="/planos" replace />
  if (me.onboarding_status !== 'provisionado') return <Navigate to="/onboarding" replace />

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="max-w-2xl mx-auto relative z-10">
        <button onClick={() => navigate('/dashboard')} className="btn-ghost text-sm mb-6">
          <ArrowLeft className="w-4 h-4" /> Voltar ao painel
        </button>

        <h1 className="text-2xl sm:text-3xl font-black mb-1">Meu plano</h1>
        <p className="text-sm text-uf-silver-dim mb-8">Edite os dados da sua loja a qualquer momento, ou troque de plano.</p>

        <section className="uf-glass rounded-2xl p-6 mb-6">
          <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
            <Sparkles className="w-4 h-4" /> Plano atual: {PLAN_MAP[me.plano].name}
          </h2>
          <div className="flex flex-wrap gap-2">
            {PLAN_ORDER.filter((p) => p !== me.plano).map((p) => (
              <button key={p} onClick={() => handleMudarPlano(p)} disabled={busyPlano} className="btn-secondary text-xs px-3 py-2">
                Mudar pra {PLAN_MAP[p].name}
              </button>
            ))}
          </div>
        </section>

        <form onSubmit={handleSave} className="uf-glass rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-sm text-uf-silver-dim uppercase tracking-wide">Dados da loja</h2>

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
            <input className="input-field" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
          </div>

          <div>
            <label className="label">Endereço</label>
            <input className="input-field" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          </div>

          <div>
            <label className="label">Logo (link da imagem)</label>
            <input className="input-field" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          </div>

          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={!venderExternamente} onChange={(e) => setVenderExternamente(!e.target.checked)} className="w-4 h-4 mt-0.5" />
            <span className="text-xs text-uf-silver-dim">
              <span className="block text-uf-silver font-semibold mb-0.5">Vender apenas internamente</span>
              Desativa a vitrine online (catálogo, carrinho, checkout) — só o painel e o PDV continuam disponíveis.
            </span>
          </label>

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
            <label className="label flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Pagamento
            </label>
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
