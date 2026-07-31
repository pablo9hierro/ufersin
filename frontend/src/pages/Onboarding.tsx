import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, CreditCard, ImagePlus, Loader2, MessageCircle, Palette, QrCode, Rocket, Store } from 'lucide-react'
import { api, ApiError, type FormaPagamento, type PlataformaPagamento, type TipoDocumento } from '../lib/api'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'

const CATEGORIAS = ['Alimentação', 'Moda', 'Beleza', 'Casa & decoração', 'Eletrônicos', 'Pet shop', 'Outro']
const CORES = ['#0f5132', '#4d7cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']
const PLATAFORMAS: { value: PlataformaPagamento; label: string; credField: string }[] = [
  { value: 'mercado_pago', label: 'Mercado Pago', credField: 'Access Token' },
  { value: 'abacate_pay', label: 'AbacatePay', credField: 'Chave de API' },
]

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics left over after NFD decomposition
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function formatDocumento(tipo: TipoDocumento, value: string) {
  const digits = value.replace(/\D/g, '')
  if (tipo === 'cpf') {
    return digits
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digits
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

// Onboarding do plano Essential — 2 etapas específicas desse plano (ver
// conversa: "o formulário de onboarding do plano essential é diferente
// dos outros planos"). Etapa 1: empresa/documento/logo/vender-
// externamente. Etapa 2: pagamento (Pix por plataforma ou cobrança
// manual) + WhatsApp. Categoria/endereço/cor/slug do form antigo
// continuam na etapa 1 -- ainda necessários pro funcionamento da loja,
// só reorganizados junto dos campos novos.
export default function Onboarding() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()

  const [step, setStep] = useState<1 | 2>(1)

  // Etapa 1
  const [nomeLoja, setNomeLoja] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')
  const [documento, setDocumento] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [endereco, setEndereco] = useState('')
  const [corPrincipal, setCorPrincipal] = useState(CORES[0])
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)

  // Etapa 2
  const [whatsappHabilitado, setWhatsappHabilitado] = useState(true)
  const [whatsapp, setWhatsapp] = useState('')
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('manual')
  const [plataformaPagamento, setPlataformaPagamento] = useState<PlataformaPagamento>('mercado_pago')
  const [credencial, setCredencial] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const handleNomeChange = (v: string) => {
    setNomeLoja(v)
    if (!slugTocado) setSlug(slugify(v))
  }

  const validateStep1 = () => {
    if (!nomeLoja.trim()) return 'Informe o nome da empresa.'
    if (documento.replace(/\D/g, '').length < (tipoDocumento === 'cpf' ? 11 : 14)) {
      return `Informe um ${tipoDocumento.toUpperCase()} válido.`
    }
    if (!endereco.trim() || !slug.trim()) return 'Preencha endereço e slug.'
    return null
  }

  const goToStep2 = () => {
    const err = validateStep1()
    if (err) return setError(err)
    setError(null)
    setStep(2)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (whatsappHabilitado) {
      const digits = whatsapp.replace(/\D/g, '')
      if (digits.length < 10) return setError('Informe um WhatsApp válido pra loja, ou desmarque a opção de notificações.')
    }
    if (formaPagamento === 'plataforma' && !credencial.trim()) {
      return setError(`Informe a(s) credencial(is) da ${PLATAFORMAS.find((p) => p.value === plataformaPagamento)?.label}, ou marque cobrança manual.`)
    }

    const digits = whatsapp.replace(/\D/g, '')
    setLoading(true)
    try {
      await api.onboarding({
        nome_loja: nomeLoja.trim(),
        categoria,
        whatsapp: whatsappHabilitado && digits ? `55${digits}` : '',
        endereco: endereco.trim(),
        cor_principal: corPrincipal,
        slug: slugify(slug),
        documento: documento.replace(/\D/g, ''),
        tipo_documento: tipoDocumento,
        vender_externamente: venderExternamente,
        whatsapp_habilitado: whatsappHabilitado,
        forma_pagamento: formaPagamento,
        plataforma_pagamento: formaPagamento === 'plataforma' ? plataformaPagamento : undefined,
        plataforma_credenciais: formaPagamento === 'plataforma' ? { token: credencial.trim() } : undefined,
      })
      setDone(true)
      setTimeout(() => navigate('/dashboard'), 2200)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível finalizar o onboarding.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-black mb-2">Sua loja está pronta! 🎉</h1>
          <p className="text-sm text-uf-silver-dim">Te levando pro seu painel...</p>
        </motion.div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="max-w-lg mx-auto relative z-10">
        <div className="text-center mb-8">
          <span className="uf-eyebrow mb-4">Onboarding · Essential</span>
          <h1 className="text-2xl sm:text-3xl font-black mt-4">Configure sua loja</h1>
          <p className="text-sm text-uf-silver-dim mt-2">Etapa {step} de 2 — dá pra editar tudo depois em "Meu plano".</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <span className={`h-1.5 rounded-full transition-all ${step === 1 ? 'w-8 bg-uf-blue' : 'w-4 bg-uf-blue/40'}`} />
            <span className={`h-1.5 rounded-full transition-all ${step === 2 ? 'w-8 bg-uf-blue' : 'w-4 bg-uf-blue/40'}`} />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div key="step1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                <div>
                  <label className="label flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5" /> Nome da empresa *
                  </label>
                  <input className="input-field" value={nomeLoja} onChange={(e) => handleNomeChange(e.target.value)} placeholder="Ex: Sunset Tabas" />
                </div>

                <div>
                  <label className="label">Documento *</label>
                  <div className="flex gap-2 mb-2">
                    {(['cnpj', 'cpf'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setTipoDocumento(t)
                          setDocumento('')
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase transition-all ${
                          tipoDocumento === t ? 'bg-uf-blue text-white' : 'bg-white/5 text-uf-silver-dim'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                    <span className="text-[11px] text-uf-silver-dim self-center">Sem CNPJ? Use seu CPF.</span>
                  </div>
                  <input
                    className="input-field"
                    value={documento}
                    onChange={(e) => setDocumento(formatDocumento(tipoDocumento, e.target.value))}
                    placeholder={tipoDocumento === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'}
                    inputMode="numeric"
                  />
                </div>

                <div>
                  <label className="label">Categoria *</label>
                  <select className="input-field" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    {CATEGORIAS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">Endereço *</label>
                  <input className="input-field" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro, cidade" />
                </div>

                <div>
                  <label className="label flex items-center gap-1.5">
                    <ImagePlus className="w-3.5 h-3.5" /> Logo (opcional)
                  </label>
                  <input className="input-field" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Cole um link de imagem, ou configure depois no painel" />
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

                <div>
                  <label className="label">Slug / subdomínio *</label>
                  <input
                    className="input-field"
                    value={slug}
                    onChange={(e) => {
                      setSlugTocado(true)
                      setSlug(e.target.value)
                    }}
                    placeholder="minha-loja"
                  />
                  <p className="text-[11px] text-uf-silver-dim mt-1">
                    Sua loja vai ficar em <span className="text-uf-silver">{slugify(slug) || 'minha-loja'}.rodoletas.app</span>
                  </p>
                </div>

                <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={!venderExternamente} onChange={(e) => setVenderExternamente(!e.target.checked)} className="w-4 h-4 mt-0.5" />
                  <span className="text-xs text-uf-silver-dim">
                    <span className="block text-uf-silver font-semibold mb-0.5">Vender apenas internamente</span>
                    Marque se você só vai usar o painel e o PDV pro seu próprio controle — a vitrine online (catálogo, carrinho, checkout) fica desativada pros seus clientes.
                  </span>
                </label>

                {error && <p className="error-msg">{error}</p>}

                <button type="button" onClick={goToStep2} className="btn-primary w-full py-3.5">
                  Continuar
                </button>
              </motion.div>
            ) : (
              <motion.div key="step2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                <div>
                  <label className="label flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5" /> Pagamento
                  </label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setFormaPagamento('manual')}
                      className={`w-full text-left uf-glass rounded-xl px-3 py-2.5 border ${formaPagamento === 'manual' ? 'border-uf-blue' : 'border-transparent'}`}
                    >
                      <span className="block text-sm font-semibold text-uf-silver">Cobrança manual</span>
                      <span className="block text-[11px] text-uf-silver-dim mt-0.5">
                        Você cobra e recebe por conta própria (Pix copia-e-cola, maquininha, dinheiro) e confirma cada venda manualmente no painel.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormaPagamento('plataforma')}
                      className={`w-full text-left uf-glass rounded-xl px-3 py-2.5 border ${formaPagamento === 'plataforma' ? 'border-uf-blue' : 'border-transparent'}`}
                    >
                      <span className="block text-sm font-semibold text-uf-silver">Gerar QR Pix automaticamente</span>
                      <span className="block text-[11px] text-uf-silver-dim mt-0.5">Cadastre uma plataforma de pagamento — cartão e dinheiro continuam manuais do mesmo jeito.</span>
                    </button>
                  </div>
                </div>

                {formaPagamento === 'plataforma' && (
                  <div className="pl-1 space-y-3 border-l-2 border-uf-blue/30 ml-1">
                    <div className="pl-3">
                      <label className="label">Plataforma</label>
                      <div className="flex flex-wrap gap-2">
                        {PLATAFORMAS.map((p) => (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() => setPlataformaPagamento(p.value)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                              plataformaPagamento === p.value ? 'bg-uf-blue text-white' : 'bg-white/5 text-uf-silver-dim'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="pl-3">
                      <label className="label flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" />
                        {PLATAFORMAS.find((p) => p.value === plataformaPagamento)?.credField}
                      </label>
                      <input className="input-field" value={credencial} onChange={(e) => setCredencial(e.target.value)} placeholder="Cole a credencial da plataforma" />
                    </div>
                  </div>
                )}

                <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={whatsappHabilitado} onChange={(e) => setWhatsappHabilitado(e.target.checked)} className="w-4 h-4 mt-0.5" />
                  <span className="text-xs text-uf-silver-dim">
                    <MessageCircle className="w-3.5 h-3.5 inline mr-1" />
                    <span className="text-uf-silver font-semibold">Notificações por WhatsApp</span>
                    <br />
                    Se desmarcar, sua loja não terá instância própria de WhatsApp e os avisos automáticos de pedido não vão funcionar.
                  </span>
                </label>

                {whatsappHabilitado && (
                  <div>
                    <label className="label">WhatsApp da loja *</label>
                    <input className="input-field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} type="tel" inputMode="numeric" placeholder="(83) 99999-9999" />
                  </div>
                )}

                {error && <p className="error-msg">{error}</p>}

                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1 py-3.5">
                    Voltar
                  </button>
                  <button type="submit" disabled={loading} className="btn-primary flex-1 py-3.5">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    Finalizar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </motion.div>
    </main>
  )
}
