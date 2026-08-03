import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AtSign, CheckCircle2, CreditCard, Loader2, MessageCircle, Palette, Rocket, Store } from 'lucide-react'
import { api, ApiError, type FormaPagamento, type PlataformaPagamento, type TipoDocumento } from '../lib/api'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import StorefrontStylePicker from '../components/StorefrontStylePicker'
import AddressField from '../components/AddressField'
import { isValidDocumento, onlyDigits } from '../lib/documento'
import { resolveSessionHome } from '../lib/sessionHome'
import type { StorefrontStyle } from '../lib/storefrontStyles'

const CORES_DEFAULT = '#0f5132'
const PLATAFORMAS: { value: PlataformaPagamento; label: string }[] = [
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'abacate_pay', label: 'Abacate Pay' },
]

type IntegracaoPagamento = PlataformaPagamento

function plataformasParaDocumento(tipo: TipoDocumento): typeof PLATAFORMAS {
  if (tipo === 'cpf') return PLATAFORMAS.filter((p) => p.value === 'mercado_pago')
  return PLATAFORMAS
}

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function formatDocumento(tipo: TipoDocumento, value: string) {
  const digits = onlyDigits(value)
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

/** Etapa 1 — após pagamento, antes do painel. Provisiona o tenant. */
export default function Onboarding() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()

  const [nomeLoja, setNomeLoja] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')
  const [documento, setDocumento] = useState('')
  const [endereco, setEndereco] = useState('')
  const [enderecoNumero, setEnderecoNumero] = useState('')
  const [instagram, setInstagram] = useState('')
  const [integracao, setIntegracao] = useState<IntegracaoPagamento>('mercado_pago')
  const [credencial, setCredencial] = useState('')
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [vendeMais18, setVendeMais18] = useState(false)
  const [apenasRetirada, setApenasRetirada] = useState(false)
  const [layoutStyle, setLayoutStyle] = useState<StorefrontStyle>('ufersin')
  const [whatsappHabilitado, setWhatsappHabilitado] = useState(true)

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

  const plataformasDisponiveis = plataformasParaDocumento(tipoDocumento)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!nomeLoja.trim()) return setError('Informe o nome da empresa.')
    if (!isValidDocumento(tipoDocumento, documento)) {
      return setError(`${tipoDocumento.toUpperCase()} inválido — confira os dígitos.`)
    }
    if (!endereco.trim()) return setError('Informe o endereço da loja.')
    if (!instagram.trim().replace(/^@/, '')) return setError('Informe o Instagram da loja.')

    let formaPagamento: FormaPagamento = 'manual'
    let plataformaPagamento: PlataformaPagamento =
      tipoDocumento === 'cpf' ? 'mercado_pago' : integracao
    if (tipoDocumento === 'cpf' && integracao === 'abacate_pay') {
      return setError('Com CPF só Mercado Pago está disponível.')
    }
    // Cobrança online só com token; sem credencial fica manual (baixa no painel).
    if (credencial.trim()) {
      formaPagamento = 'plataforma'
    }

    const slug = slugify(nomeLoja) || `loja-${Date.now().toString(36)}`
    setLoading(true)
    try {
      await api.onboarding({
        nome_loja: nomeLoja.trim(),
        categoria: 'Outro',
        whatsapp: '',
        endereco: endereco.trim(),
        endereco_numero: enderecoNumero.trim() || undefined,
        cor_principal: CORES_DEFAULT,
        slug,
        documento: onlyDigits(documento),
        tipo_documento: tipoDocumento,
        instagram: instagram.trim().replace(/^@/, ''),
        vender_externamente: venderExternamente,
        vende_mais_18: vendeMais18,
        apenas_retirada: apenasRetirada,
        whatsapp_habilitado: whatsappHabilitado,
        forma_pagamento: formaPagamento,
        plataforma_pagamento: plataformaPagamento,
        plataforma_credenciais: credencial.trim() ? { token: credencial.trim() } : undefined,
        layout_style: venderExternamente ? layoutStyle : 'ufersin',
      })
      setDone(true)
      resolveSessionHome().then((dest) => setTimeout(() => navigate(dest), 2200))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível finalizar o onboarding.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-black mb-2">Painel liberado!</h1>
          <p className="text-sm text-uf-silver-dim">
            No primeiro acesso à loja você conclui WhatsApp e horário de funcionamento.
          </p>
        </motion.div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mx-auto relative z-10 max-w-2xl"
      >
        <div className="text-center mb-8">
          <span className="uf-eyebrow mb-4">Onboarding</span>
          <h1 className="text-2xl sm:text-3xl font-black mt-4">Configure sua loja</h1>
          <p className="text-sm text-uf-silver-dim mt-2">
            Dados essenciais pra liberar o painel. WhatsApp e horários ficam no primeiro acesso à loja.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 sm:p-8 space-y-4">
          <div>
            <label className="label flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5" /> Nome da empresa *
            </label>
            <input
              className="input-field"
              value={nomeLoja}
              onChange={(e) => setNomeLoja(e.target.value)}
              placeholder="Ex: Minha Loja"
            />
          </div>

          <div>
            <label className="label">CNPJ ou CPF *</label>
            <div className="flex gap-2 mb-2">
              {(['cnpj', 'cpf'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTipoDocumento(t)
                    setDocumento('')
                    if (t === 'cpf' && integracao === 'abacate_pay') setIntegracao('mercado_pago')
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

          <AddressField
            endereco={endereco}
            numero={enderecoNumero}
            onEnderecoChange={setEndereco}
            onNumeroChange={setEnderecoNumero}
          />

          <div>
            <label className="label flex items-center gap-1.5">
              <AtSign className="w-3.5 h-3.5" /> Rede social — Instagram *
            </label>
            <div className="flex items-center gap-1 input-field !py-0 !px-3">
              <span className="text-uf-silver-dim text-sm">@</span>
              <input
                className="flex-1 bg-transparent outline-none py-2.5 text-sm"
                value={instagram.replace(/^@/, '')}
                onChange={(e) => setInstagram(e.target.value.replace(/^@/, ''))}
                placeholder="sua_loja"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Integrar com *
            </label>
            <div className="space-y-2">
              {plataformasDisponiveis.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setIntegracao(p.value)}
                  className={`w-full text-left uf-glass rounded-xl px-3 py-2.5 border ${
                    integracao === p.value ? 'border-uf-blue' : 'border-transparent'
                  }`}
                >
                  <span className="block text-sm font-semibold text-uf-silver">{p.label}</span>
                </button>
              ))}
            </div>
            {tipoDocumento === 'cpf' && (
              <p className="text-[11px] text-uf-silver-dim mt-2">Com CPF só Mercado Pago está disponível. Abacate Pay exige CNPJ.</p>
            )}
            <div className="mt-3">
              <label className="label">Credencial (opcional agora)</label>
              <input
                className="input-field"
                value={credencial}
                onChange={(e) => setCredencial(e.target.value)}
                placeholder={integracao === 'mercado_pago' ? 'Access Token' : 'Chave de API'}
              />
              <p className="text-[11px] text-uf-silver-dim mt-1">
                Sem credencial, vendas ficam em cobrança manual. Pode completar depois em Meu plano → Financeiro.
              </p>
            </div>
          </div>

          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={venderExternamente}
              onChange={(e) => setVenderExternamente(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span className="text-xs text-uf-silver-dim">
              <span className="block text-uf-silver font-semibold mb-0.5">Quer vender pro público externo</span>
              Vitrine online (catálogo, carrinho, checkout). Desmarque pra usar só painel/PDV.
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
              <span className="block text-uf-silver font-semibold mb-0.5">Minha loja vende produtos para maiores de 18 anos</span>
              Se marcado, o checkout do cliente exige consentimento de compra normal + 18+.
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
              <span className="block text-uf-silver font-semibold mb-0.5">Aceitar apenas compras com retirada na loja</span>
              Clientes da vitrine só podem comprar com retirada — sem entrega, frete ou motoboy.
            </span>
          </label>

          {venderExternamente && (
            <div className="uf-glass rounded-2xl px-4 py-4 space-y-3 border border-white/10">
              <p className="label mb-1 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5" /> Layout da vitrine
              </p>
              <StorefrontStylePicker
                value={layoutStyle}
                onChange={setLayoutStyle}
                lojaNome={nomeLoja}
                corPrincipal={CORES_DEFAULT}
              />
            </div>
          )}

          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={whatsappHabilitado}
              onChange={(e) => setWhatsappHabilitado(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span className="text-xs text-uf-silver-dim">
              <MessageCircle className="w-3.5 h-3.5 inline mr-1" />
              <span className="text-uf-silver font-semibold">Quer usar WhatsApp pra mensageria</span>
              <br />
              A conexão por QR fica no primeiro acesso ao painel da loja (ou em Configurações).
            </span>
          </label>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Liberar painel
          </button>
        </form>
      </motion.div>
    </main>
  )
}
