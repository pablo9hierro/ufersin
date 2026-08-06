import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AtSign, CheckCircle2, CreditCard, Loader2, MessageCircle, Palette, Rocket, Store } from 'lucide-react'
import { api, ApiError, type MeResponse, type TipoDocumento } from '../lib/api'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import StorefrontStylePicker from '../components/StorefrontStylePicker'
import AddressField from '../components/AddressField'
import { isValidDocumento, onlyDigits } from '../lib/documento'
import { planDisplayName } from '../lib/plans'
import { needsOnboardingLock, storeAlreadyExists } from '../lib/postPayRedirect'
import type { StorefrontStyle } from '../lib/storefrontStyles'

const CORES_DEFAULT = '#0f5132'
/** Full = first-time; complementary = upgrade (prefill + delta); skip = already provisioned. */
type OnboardingMode = 'loading' | 'full' | 'complementary' | 'skip'

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

function applyMePrefill(me: MeResponse): {
  nomeLoja: string
  tipoDocumento: TipoDocumento
  documento: string
  endereco: string
  enderecoNumero: string
  instagram: string
  venderExternamente: boolean
  vendeMais18: boolean
  apenasRetirada: boolean
  pagamentoNaRetirada: boolean
  entregaSomentePix: boolean
  layoutStyle: StorefrontStyle
  whatsappHabilitado: boolean
  hasCreds: boolean
} {
  const tipo = (me.tipo_documento === 'cpf' ? 'cpf' : 'cnpj') as TipoDocumento
  const layout =
    me.layout_style === 'burgerbite' || me.layout_style === 'burgerhouse' || me.layout_style === 'ufersin'
      ? me.layout_style
      : 'ufersin'
  return {
    nomeLoja: me.loja_nome?.trim() || '',
    tipoDocumento: tipo,
    documento: me.documento ? formatDocumento(tipo, me.documento) : '',
    endereco: me.endereco?.trim() || '',
    enderecoNumero: me.endereco_numero?.trim() || '',
    instagram: (me.instagram || '').replace(/^@/, ''),
    venderExternamente: me.vender_externamente !== false,
    vendeMais18: Boolean(me.vende_mais_18),
    apenasRetirada: Boolean(me.apenas_retirada),
    pagamentoNaRetirada: Boolean(me.pagamento_na_retirada),
    entregaSomentePix: Boolean(me.entrega_somente_pix),
    layoutStyle: layout,
    whatsappHabilitado: me.whatsapp_habilitado !== false,
    hasCreds: Boolean(me.has_plataforma_credenciais),
  }
}

/** Etapa 1 — após pagamento. Never shows blank form when store data already exists. */
export default function Onboarding() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()

  const [mode, setMode] = useState<OnboardingMode>('loading')
  const [planLabel, setPlanLabel] = useState<string | null>(null)
  const [hasCreds, setHasCreds] = useState(false)
  const [connectingMp, setConnectingMp] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [nomeLoja, setNomeLoja] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')
  const [documento, setDocumento] = useState('')
  const [endereco, setEndereco] = useState('')
  const [enderecoNumero, setEnderecoNumero] = useState('')
  const [instagram, setInstagram] = useState('')
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [vendeMais18, setVendeMais18] = useState(false)
  const [apenasRetirada, setApenasRetirada] = useState(false)
  const [pagamentoNaRetirada, setPagamentoNaRetirada] = useState(false)
  const [entregaSomentePix, setEntregaSomentePix] = useState(false)
  const [layoutStyle, setLayoutStyle] = useState<StorefrontStyle>('ufersin')
  const [whatsappHabilitado, setWhatsappHabilitado] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!ready || !isAuthenticated) return
    let cancelled = false
    setLoadError(null)
    setMode('loading')

    ;(async () => {
      try {
        const me = await api.me()
        if (cancelled) return

        setPlanLabel(me.plano ? planDisplayName(me.plano) : null)
        const pre = applyMePrefill(me)
        setNomeLoja(pre.nomeLoja)
        setTipoDocumento(pre.tipoDocumento)
        setDocumento(pre.documento)
        setEndereco(pre.endereco)
        setEnderecoNumero(pre.enderecoNumero)
        setInstagram(pre.instagram)
        setVenderExternamente(pre.venderExternamente)
        setVendeMais18(pre.vendeMais18)
        setApenasRetirada(pre.apenasRetirada)
        setPagamentoNaRetirada(pre.pagamentoNaRetirada)
        setEntregaSomentePix(pre.entregaSomentePix)
        setLayoutStyle(pre.layoutStyle)
        setWhatsappHabilitado(pre.whatsappHabilitado)
        setHasCreds(pre.hasCreds)

        // Stay on /onboarding until lock clears (provisionado / store ready).
        if (!needsOnboardingLock(me)) {
          setMode('skip')
          if (!cancelled) navigate('/meu-plano', { replace: true })
          return
        }

        // Upgrade complementary (BE set aguardando_onboarding + store exists).
        if (storeAlreadyExists(me) && me.onboarding_status === 'aguardando_onboarding') {
          setMode('complementary')
          return
        }

        // Brand-new store — full onboarding (may still prefill loja_nome from cadastro).
        setMode('full')
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof ApiError ? e.message : 'Não foi possível carregar os dados da loja.')
        setMode('loading')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, isAuthenticated, navigate, reloadKey])

  if (!ready || mode === 'loading' || mode === 'skip') {
    return (
      <main className="min-h-screen bg-uf-black flex flex-col items-center justify-center gap-4 px-5">
        {loadError ? (
          <>
            <p className="text-sm text-red-400 text-center max-w-md">{loadError}</p>
            <button type="button" className="btn-primary px-6 py-3" onClick={() => setReloadKey((k) => k + 1)}>
              Tentar de novo
            </button>
          </>
        ) : (
          <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
        )}
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const complementary = mode === 'complementary'
  const mpTokenRequired = !hasCreds
  const returning = complementary || Boolean(nomeLoja || documento || endereco)

  const finishOk = () => {
    setDone(true)
    setTimeout(() => navigate('/meu-plano'), 1800)
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

  const handleKeepCurrent = async () => {
    setError(null)
    if (mpTokenRequired) {
      setError('Conecte sua conta Mercado Pago pra continuar.')
      return
    }
    setLoading(true)
    try {
      await api.editarOnboarding({})
      finishOk()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!nomeLoja.trim()) return setError('Informe o nome da empresa.')
    if (!isValidDocumento(tipoDocumento, documento)) {
      return setError(`${tipoDocumento.toUpperCase()} inválido — confira os dígitos.`)
    }
    if (!endereco.trim()) return setError('Informe o endereço da loja.')
    if (!instagram.trim().replace(/^@/, '')) return setError('Informe o Instagram da loja.')
    if (mpTokenRequired) {
      return setError('Conecte sua conta Mercado Pago pra concluir o cadastro.')
    }

    const slug = slugify(nomeLoja) || `loja-${Date.now().toString(36)}`
    setLoading(true)
    try {
      if (complementary) {
        await api.editarOnboarding({
          nome_loja: nomeLoja.trim(),
          endereco: endereco.trim(),
          endereco_numero: enderecoNumero.trim() || undefined,
          documento: onlyDigits(documento),
          tipo_documento: tipoDocumento,
          instagram: instagram.trim().replace(/^@/, ''),
          vender_externamente: venderExternamente,
          vende_mais_18: vendeMais18,
          apenas_retirada: apenasRetirada,
          pagamento_na_retirada: pagamentoNaRetirada,
          entrega_somente_pix: entregaSomentePix,
          whatsapp_habilitado: whatsappHabilitado,
          layout_style: venderExternamente ? layoutStyle : 'ufersin',
        })
      } else {
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
          pagamento_na_retirada: pagamentoNaRetirada,
          entrega_somente_pix: entregaSomentePix,
          whatsapp_habilitado: whatsappHabilitado,
          layout_style: venderExternamente ? layoutStyle : 'ufersin',
        })
      }
      finishOk()
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
          <h1 className="text-2xl font-black mb-2">{complementary ? 'Plano atualizado!' : 'Painel liberado!'}</h1>
          <p className="text-sm text-uf-silver-dim">
            {complementary
              ? 'Sua loja e dados anteriores foram preservados.'
              : 'No primeiro acesso à loja você conclui WhatsApp e horário de funcionamento.'}
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
          <span className="uf-eyebrow mb-4">{complementary ? 'Upgrade' : 'Onboarding'}</span>
          <h1 className="text-2xl sm:text-3xl font-black mt-4">
            {complementary
              ? `Complementos do plano ${planLabel ?? 'novo'}`
              : 'Configure sua loja'}
          </h1>
          <p className="text-sm text-uf-silver-dim mt-2">
            {complementary
              ? 'Dados da loja já carregados — confirme ou ajuste só o que mudou. Nada é apagado.'
              : 'Dados essenciais pra liberar o painel. WhatsApp e horários ficam no primeiro acesso à loja.'}
          </p>
        </div>

        {returning && (
          <div className="mb-4 uf-glass rounded-xl px-4 py-3 text-xs text-emerald-300/90 border border-emerald-500/20">
            Dados existentes carregados
            {nomeLoja ? (
              <>
                {' '}
                — <span className="font-semibold text-uf-silver">{nomeLoja}</span>
              </>
            ) : null}
            . Revise antes de continuar.
          </div>
        )}

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
                    if (!documento) setDocumento('')
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

          <div className="uf-glass rounded-xl p-4">
            {hasCreds ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-uf-silver flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Mercado Pago conectado.
                </span>
                <button
                  type="button"
                  onClick={handleConnectMp}
                  disabled={connectingMp}
                  className="text-xs text-uf-silver-dim hover:text-uf-silver underline"
                >
                  Reconectar
                </button>
              </div>
            ) : (
              <>
                <p className="label flex items-center gap-1.5 mb-1">
                  <CreditCard className="w-3.5 h-3.5" /> Conecte sua conta Mercado Pago
                </p>
                <p className="text-[11px] text-uf-silver-dim mb-3">Receba pagamentos automaticamente na sua loja.</p>
                <button
                  type="button"
                  onClick={handleConnectMp}
                  disabled={connectingMp}
                  className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
                >
                  {connectingMp ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Conectar Mercado Pago
                </button>
              </>
            )}
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

          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={pagamentoNaRetirada}
              onChange={(e) => setPagamentoNaRetirada(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span className="text-xs text-uf-silver-dim">
              <span className="block text-uf-silver font-semibold mb-0.5">Pagamento só no ato da retirada</span>
              Pagamento de pedidos para retirada só é processado no ato da retirada na loja.
            </span>
          </label>

          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={entregaSomentePix}
              onChange={(e) => setEntregaSomentePix(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span className="text-xs text-uf-silver-dim">
              <span className="block text-uf-silver font-semibold mb-0.5">Só aceito pedidos de entrega pagos com Pix no checkout</span>
              Entrega só com Pix já pago online. Cartão e dinheiro ficam só para retirada na loja.
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
            {complementary ? 'Salvar e liberar painel' : 'Liberar painel'}
          </button>

          {complementary && (
            <button
              type="button"
              disabled={loading}
              onClick={handleKeepCurrent}
              className="btn-secondary w-full py-3 text-sm"
            >
              Manter dados atuais e continuar
            </button>
          )}
        </form>
      </motion.div>
    </main>
  )
}
