import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Check, Copy, CreditCard, ExternalLink, Loader2, QrCode, Rocket, Tag } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  api,
  ApiError,
  type AssinaturaCriada,
  type BillingCycle,
  type CouponPreview,
  type MetodoPagamento,
  type PandadocStatus,
  type PlanoCode,
} from '../lib/api'
import { CmsEditProvider, CmsText, usePlatformContent } from '../lib/cms'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { fetchPlans, formatBRL, getPlanMap, priceForCycle, SEMESTRAL_DISCOUNT } from '../lib/plans'

type PayStep = 'form' | 'pix' | 'card' | 'done'

export default function Assinar() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()

  const planoParam = searchParams.get('plano') as PlanoCode | null
  const cicloParam = searchParams.get('ciclo') as BillingCycle | null
  const initialCiclo: BillingCycle = cicloParam === 'semestral' ? 'semestral' : 'mensal'

  const [plansReady, setPlansReady] = useState(false)
  const [ciclo, setCiclo] = useState<BillingCycle>(initialCiclo)
  const [metodo, setMetodo] = useState<MetodoPagamento>('cartao')
  const [cupom, setCupom] = useState('')
  const [preview, setPreview] = useState<CouponPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewSeq = useRef(0)
  const [aceiteContrato, setAceiteContrato] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pandadocStatus, setPandadocStatus] = useState<PandadocStatus | null>(null)
  const [pandadocShareLink, setPandadocShareLink] = useState<string | null>(null)
  const { content, ready: contentReady } = usePlatformContent()

  const [payStep, setPayStep] = useState<PayStep>('form')
  const [charge, setCharge] = useState<AssinaturaCriada | null>(null)
  const [copied, setCopied] = useState(false)
  const [simulating, setSimulating] = useState(false)

  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [cvv, setCvv] = useState('')
  const [autoDebit, setAutoDebit] = useState(false)
  const [payingCard, setPayingCard] = useState(false)

  useEffect(() => {
    fetchPlans().finally(() => setPlansReady(true))
    api.getPandadocStatus().then(setPandadocStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    if (isKnownPlatformAdminEmail(session?.user?.email)) {
      navigate('/dashboard', { replace: true })
      return
    }
    api
      .superadminWhoami()
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => {
        /* lojista */
      })
  }, [isAuthenticated, navigate, session?.user?.email])

  const planMap = getPlanMap()
  const plano: PlanoCode | null = planoParam && planMap[planoParam] ? planoParam : null

  useEffect(() => {
    const code = cupom.trim().toUpperCase()
    if (!plano || !code) {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }
    const seq = ++previewSeq.current
    const t = window.setTimeout(() => {
      setPreviewLoading(true)
      api
        .previewCoupon(code, plano)
        .then((p) => {
          if (seq !== previewSeq.current) return
          setPreview(p)
          setPreviewError(null)
        })
        .catch((e) => {
          if (seq !== previewSeq.current) return
          setPreview(null)
          setPreviewError(e instanceof ApiError ? e.message : 'Cupom inválido.')
        })
        .finally(() => {
          if (seq === previewSeq.current) setPreviewLoading(false)
        })
    }, 400)
    return () => window.clearTimeout(t)
  }, [cupom, plano])

  if (!ready || !plansReady || !contentReady) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to={plano ? `/login?plano=${plano}&ciclo=${ciclo}` : '/login'} replace />
  if (!plano) return <Navigate to="/planos" replace />

  const planInfo = planMap[plano]
  if (!planInfo) return <Navigate to="/planos" replace />
  const monthly = preview?.monthly_after ?? planInfo.price
  const charged = priceForCycle(monthly, ciclo)
  const platformSigningReady = pandadocStatus?.platform_signing_ready ?? false
  const couponBlocksSubmit = !!previewError && !preview
  const sandbox = Boolean(charge?.sandbox)

  const goActive = (onboarding: string) => {
    setPayStep('done')
    if (onboarding === 'aguardando_onboarding') {
      setTimeout(() => navigate('/onboarding'), 900)
    } else {
      setTimeout(() => navigate('/meu-plano'), 900)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!aceiteContrato) {
      setError('Aceite o contrato de assinatura Resolutoo para continuar.')
      return
    }
    setLoading(true)
    try {
      try {
        await api.contratosAccept('platform_subscription', 'checkbox')
      } catch {
        /* catálogo pode ainda não ter migrado */
      }

      if (platformSigningReady && session?.user.email) {
        try {
          const signerName =
            session.user.user_metadata?.responsavel_nome ||
            session.user.user_metadata?.full_name ||
            session.user.user_metadata?.name ||
            undefined
          const pd = await api.contratosPandadocSession(session.user.email, signerName)
          if (pd.ready && pd.share_link) setPandadocShareLink(pd.share_link)
        } catch {
          /* checkbox já registrou */
        }
      }

      const code = cupom.trim().toUpperCase()
      const result = await api.assinarPlano({
        plano,
        metodo,
        ciclo,
        ...(code ? { cupom: code } : {}),
      })

      // Never redirect to mercadopago.com.br — always stay on resolutoo.com.
      setCharge(result)
      if (metodo === 'pix' || result.payment_step === 'pix' || result.pix_qr_code) {
        setPayStep('pix')
      } else {
        setPayStep('card')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível iniciar a assinatura. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyPix = async () => {
    const code = charge?.pix_qr_code
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Não foi possível copiar o código Pix.')
    }
  }

  const handleSimulate = async () => {
    setSimulating(true)
    setError(null)
    try {
      const r = await api.simularPagamento()
      goActive(r.onboarding_status)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível simular o pagamento.')
    } finally {
      setSimulating(false)
    }
  }

  const handlePayCard = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPayingCard(true)
    try {
      const r = await api.pagarCartao({
        card_number: cardNumber,
        card_holder: cardHolder.trim(),
        exp_month: expMonth.trim(),
        exp_year: expYear.trim(),
        cvv: cvv.trim(),
        auto_debit: autoDebit,
      })
      goActive(r.onboarding_status)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pagamento com cartão recusado.')
    } finally {
      setPayingCard(false)
    }
  }

  return (
    <CmsEditProvider editable={false} content={content}>
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
        <div className="uf-mesh" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10"
        >
          <div className="text-center mb-8">
            <Link to="/" className="text-2xl font-black uf-text">
              Resolutoo
            </Link>
            <CmsText contentKey="assinar.title" as="p" className="text-uf-silver-dim text-sm mt-2 block" />
          </div>

          <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
            <p className="text-xs text-uf-silver-dim mb-1">Plano {planInfo.name}</p>
            {preview && (
              <p className="text-xs text-emerald-400 mb-1">
                Cupom {preview.code}: de R$ {formatBRL(preview.monthly_before)} → R$ {formatBRL(preview.monthly_after)}
                /mês
                {preview.duration_kind === 'lifetime_current_plan'
                  ? ' · vitalício neste plano'
                  : preview.duration_days != null
                    ? ` · ${preview.duration_days} dias`
                    : ''}
              </p>
            )}
            {ciclo === 'mensal' ? (
              <p className="text-3xl font-black uf-text">R$ {formatBRL(monthly)}/mês</p>
            ) : (
              <>
                <p className="text-3xl font-black uf-text">R$ {formatBRL(charged)}/semestre</p>
                <p className="text-xs text-emerald-400 mt-1">
                  {Math.round(SEMESTRAL_DISCOUNT * 100)}% de desconto · equiv. R$ {formatBRL(charged / 6)}/mês
                </p>
              </>
            )}
            {payStep === 'form' && (
              <Link to="/planos" className="text-[11px] text-uf-silver-dim hover:text-uf-silver underline mt-1 inline-block">
                trocar plano
              </Link>
            )}
          </div>

          {payStep === 'form' && (
            <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
              <div>
                <label className="label flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Cupom (opcional)
                </label>
                <input
                  className="input-field uppercase"
                  value={cupom}
                  onChange={(e) => setCupom(e.target.value.toUpperCase())}
                  onBlur={() => setCupom((c) => c.trim())}
                  placeholder="CODIGO"
                  autoComplete="off"
                />
                {previewLoading && <p className="text-[11px] text-uf-silver-dim mt-1">Validando cupom…</p>}
                {preview && !previewError && (
                  <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Cupom aplicado
                  </p>
                )}
                {previewError && !preview && <p className="text-[11px] text-red-400 mt-1">{previewError}</p>}
              </div>

              <div>
                <label className="label">Ciclo de cobrança</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCiclo('mensal')}
                    className={`rounded-xl py-3 text-sm border transition-colors ${ciclo === 'mensal' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'}`}
                  >
                    Mensal
                  </button>
                  <button
                    type="button"
                    onClick={() => setCiclo('semestral')}
                    className={`rounded-xl py-3 text-sm border transition-colors ${ciclo === 'semestral' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'}`}
                  >
                    Semestral
                    <span className="block text-[10px] text-emerald-400 mt-0.5">
                      −{Math.round(SEMESTRAL_DISCOUNT * 100)}% off
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Forma de pagamento</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMetodo('cartao')}
                    className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm border transition-colors ${metodo === 'cartao' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'}`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Cartão
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodo('pix')}
                    className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm border transition-colors ${metodo === 'pix' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'}`}
                  >
                    <QrCode className="w-4 h-4" />
                    Pix
                  </button>
                </div>
              </div>

              <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceiteContrato}
                  onChange={(e) => setAceiteContrato(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                  required
                />
                <span className="text-xs text-uf-silver-dim">
                  <span className="block text-uf-silver font-semibold mb-0.5">
                    Li e aceito o contrato de assinatura Resolutoo
                  </span>
                  Este é o contrato entre você (lojista) e a plataforma.
                </span>
              </label>

              {pandadocShareLink && (
                <a
                  href={pandadocShareLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-uf-blue hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir documento PandaDoc (opcional)
                </a>
              )}

              {error && <p className="error-msg">{error}</p>}

              <button
                type="submit"
                disabled={loading || !aceiteContrato || couponBlocksSubmit}
                className="btn-primary w-full py-3.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                Assinar e configurar pagamento
              </button>
            </form>
          )}

          {payStep === 'pix' && charge && (
            <div className="uf-glass rounded-2xl p-6 space-y-4" data-testid="onsite-pix">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <QrCode className="w-5 h-5" /> Pague com Pix
              </h2>
              <p className="text-xs text-uf-silver-dim">
                Escaneie o QR ou copie o código. Pagamento permanece em resolutoo.com — sem redirecionar ao Mercado
                Pago.
              </p>
              <div className="flex justify-center bg-white rounded-2xl p-4">
                {charge.pix_qr_base64 ? (
                  <img src={charge.pix_qr_base64} alt="QR Pix" className="w-48 h-48 object-contain" />
                ) : charge.pix_qr_code ? (
                  <QRCodeSVG value={charge.pix_qr_code} size={192} />
                ) : (
                  <p className="text-sm text-uf-black p-4">Gerando QR…</p>
                )}
              </div>
              {charge.pix_qr_code && (
                <button type="button" onClick={handleCopyPix} className="btn-secondary w-full py-3 text-sm">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copiado!' : 'Copiar código Pix'}
                </button>
              )}
              {sandbox && (
                <div className="space-y-2 pt-2 border-t border-white/10">
                  <p className="text-xs text-amber-300/90">Homologação — nenhum valor real será cobrado.</p>
                  <button type="button" onClick={handleSimulate} disabled={simulating} className="btn-primary w-full py-3">
                    {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Simular pagamento
                  </button>
                </div>
              )}
              {error && <p className="error-msg">{error}</p>}
            </div>
          )}

          {payStep === 'card' && (
            <form onSubmit={handlePayCard} className="uf-glass rounded-2xl p-6 space-y-4" data-testid="onsite-card">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5" /> Pagamento com cartão
              </h2>
              <p className="text-xs text-uf-silver-dim">
                Dados do cartão ficam nesta página. Sem redirecionar ao Mercado Pago.
                {sandbox
                  ? ' Sandbox: use cartão de teste (ex. 5031 4332 1540 6351, CVV 123, validade futura).'
                  : ''}
              </p>
              <div>
                <label className="label">Número do cartão</label>
                <input
                  className="input-field"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value.replace(/[^\d\s]/g, ''))}
                  placeholder="5031 4332 1540 6351"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  required
                />
              </div>
              <div>
                <label className="label">Nome no cartão</label>
                <input
                  className="input-field uppercase"
                  value={cardHolder}
                  onChange={(e) => setCardHolder(e.target.value)}
                  placeholder="COMO NO CARTÃO"
                  autoComplete="cc-name"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Mês</label>
                  <input
                    className="input-field"
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="12"
                    inputMode="numeric"
                    autoComplete="cc-exp-month"
                    required
                  />
                </div>
                <div>
                  <label className="label">Ano</label>
                  <input
                    className="input-field"
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="2030"
                    inputMode="numeric"
                    autoComplete="cc-exp-year"
                    required
                  />
                </div>
                <div>
                  <label className="label">CVV</label>
                  <input
                    className="input-field"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="123"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    required
                  />
                </div>
              </div>

              <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDebit}
                  onChange={(e) => setAutoDebit(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                />
                <span className="text-xs text-uf-silver-dim">
                  <span className="block text-uf-silver font-semibold mb-0.5">
                    Aceitar cobrança em débito automático da assinatura
                  </span>
                  Opcional — desmarcado por padrão. Se marcado, tentamos configurar a renovação automática.
                </span>
              </label>

              {sandbox && (
                <button type="button" onClick={handleSimulate} disabled={simulating} className="btn-secondary w-full py-3 text-sm">
                  {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Simular pagamento (sandbox)
                </button>
              )}

              {error && <p className="error-msg">{error}</p>}

              <button type="submit" disabled={payingCard} className="btn-primary w-full py-3.5">
                {payingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                Pagar R$ {formatBRL(charge?.valor_cobrado ?? charged)}
              </button>
            </form>
          )}

          {payStep === 'done' && (
            <div className="uf-glass rounded-2xl p-6 text-center space-y-3">
              <Check className="w-10 h-10 text-emerald-400 mx-auto" />
              <h2 className="font-black text-xl">Assinatura ativa</h2>
              <p className="text-sm text-uf-silver-dim">Redirecionando…</p>
            </div>
          )}
        </motion.div>
      </main>
    </CmsEditProvider>
  )
}
