import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, ExternalLink, Loader2, QrCode, Rocket, Tag } from 'lucide-react'
import { api, ApiError, type BillingCycle, type CouponPreview, type MetodoPagamento, type PandadocStatus, type PlanoCode } from '../lib/api'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { fetchPlans, formatBRL, getPlanMap, priceForCycle, SEMESTRAL_DISCOUNT } from '../lib/plans'

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
  const [aceiteContrato, setAceiteContrato] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pandadocStatus, setPandadocStatus] = useState<PandadocStatus | null>(null)
  const [pandadocShareLink, setPandadocShareLink] = useState<string | null>(null)

  useEffect(() => {
    fetchPlans().finally(() => setPlansReady(true))
    api.getPandadocStatus().then(setPandadocStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    api
      .superadminWhoami()
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => {
        /* lojista */
      })
  }, [isAuthenticated, navigate])

  const planMap = getPlanMap()
  const plano: PlanoCode | null = planoParam && planoParam in planMap ? planoParam : null

  useEffect(() => {
    if (!plano || !cupom.trim()) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    const t = window.setTimeout(() => {
      setPreviewLoading(true)
      setPreviewError(null)
      api
        .previewCoupon(cupom.trim(), plano)
        .then(setPreview)
        .catch((e) => {
          setPreview(null)
          setPreviewError(e instanceof ApiError ? e.message : 'Cupom inválido.')
        })
        .finally(() => setPreviewLoading(false))
    }, 400)
    return () => window.clearTimeout(t)
  }, [cupom, plano])

  if (!ready || !plansReady) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to={plano ? `/login?plano=${plano}&ciclo=${ciclo}` : '/login'} replace />
  if (!plano) return <Navigate to="/planos" replace />

  const planInfo = planMap[plano]
  const monthly = preview?.monthly_after ?? planInfo.price
  const charged = priceForCycle(monthly, ciclo)
  const platformSigningReady = pandadocStatus?.platform_signing_ready ?? false

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

      const result = await api.assinarPlano({
        plano,
        metodo,
        ciclo,
        ...(cupom.trim() ? { cupom: cupom.trim() } : {}),
      })

      if (result.sandbox) {
        const q = new URLSearchParams({ id: result.id })
        if (result.checkout_url) q.set('checkout', result.checkout_url)
        navigate(`/obrigado?${q.toString()}`)
      } else if (result.checkout_url) {
        window.location.href = result.checkout_url
      } else {
        navigate(`/obrigado?id=${result.id}`)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível iniciar a assinatura. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">Escolha o ciclo e como pagar.</p>
        </div>

        <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
          <p className="text-xs text-uf-silver-dim mb-1">Plano {planInfo.name}</p>
          {preview && (
            <p className="text-xs text-emerald-400 mb-1">
              Cupom {preview.code}: de R$ {formatBRL(preview.monthly_before)} → R$ {formatBRL(preview.monthly_after)}/mês
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
          <Link to="/planos" className="text-[11px] text-uf-silver-dim hover:text-uf-silver underline mt-1 inline-block">
            trocar plano
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Cupom (opcional)
            </label>
            <input
              className="input-field uppercase"
              value={cupom}
              onChange={(e) => setCupom(e.target.value.toUpperCase())}
              placeholder="CODIGO"
            />
            {previewLoading && <p className="text-[11px] text-uf-silver-dim mt-1">Validando cupom…</p>}
            {previewError && <p className="text-[11px] text-red-400 mt-1">{previewError}</p>}
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
                <span className="block text-[10px] text-emerald-400 mt-0.5">−{Math.round(SEMESTRAL_DISCOUNT * 100)}% off</span>
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
            <input type="checkbox" checked={aceiteContrato} onChange={(e) => setAceiteContrato(e.target.checked)} className="w-4 h-4 mt-0.5" required />
            <span className="text-xs text-uf-silver-dim">
              <span className="block text-uf-silver font-semibold mb-0.5">Li e aceito o contrato de assinatura Resolutoo</span>
              Este é o contrato entre você (lojista) e a plataforma.
            </span>
          </label>

          {pandadocShareLink && (
            <a href={pandadocShareLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-uf-blue hover:underline">
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir documento PandaDoc (opcional)
            </a>
          )}

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading || !aceiteContrato || !!previewError} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Assinar e configurar pagamento
          </button>
        </form>
      </motion.div>
    </main>
  )
}
