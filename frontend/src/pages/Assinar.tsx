import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, Loader2, QrCode, Rocket } from 'lucide-react'
import { api, ApiError, type BillingCycle, type MetodoPagamento, type PlanoCode } from '../lib/api'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { formatBRL, PLAN_MAP, priceForCycle, SEMESTRAL_DISCOUNT } from '../lib/plans'

/** Passo final do fluxo de assinatura -- só o método de pagamento, já
 * autenticado (conta e plano já foram decididos antes, ver Cadastro/Login/
 * Planos). Equivalente à segunda metade do antigo /cadastro. */
export default function Assinar() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()

  const planoParam = searchParams.get('plano') as PlanoCode | null
  const plano: PlanoCode | null = planoParam && planoParam in PLAN_MAP ? planoParam : null
  const cicloParam = searchParams.get('ciclo') as BillingCycle | null
  const initialCiclo: BillingCycle = cicloParam === 'semestral' ? 'semestral' : 'mensal'

  const [ciclo, setCiclo] = useState<BillingCycle>(initialCiclo)
  // Homologação AbacatePay costuma ter só PIX liberado — cartão cai pra PIX no backend.
  const [metodo, setMetodo] = useState<MetodoPagamento>('pix')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to={plano ? `/login?plano=${plano}&ciclo=${ciclo}` : '/login'} replace />
  if (!plano) return <Navigate to="/planos" replace />

  const planInfo = PLAN_MAP[plano]
  const charged = priceForCycle(planInfo.price, ciclo)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await api.assinarPlano({ plano, metodo, ciclo })
      // Homologação: vai pra /obrigado com botão "Simular pagamento" (e link do checkout real).
      // Produção: redireciona direto ao checkout AbacatePay.
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
            Rodoletas
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">Escolha o ciclo e como pagar.</p>
        </div>

        <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
          <p className="text-xs text-uf-silver-dim mb-1">Plano {planInfo.name}</p>
          {ciclo === 'mensal' ? (
            <p className="text-3xl font-black uf-text">R$ {formatBRL(planInfo.price)}/mês</p>
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
            <label className="label">Ciclo de cobrança</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCiclo('mensal')}
                className={`rounded-xl py-3 text-sm border transition-colors ${
                  ciclo === 'mensal' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'
                }`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setCiclo('semestral')}
                className={`rounded-xl py-3 text-sm border transition-colors ${
                  ciclo === 'semestral' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'
                }`}
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
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm border transition-colors ${
                  metodo === 'cartao' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                Cartão
              </button>
              <button
                type="button"
                onClick={() => setMetodo('pix')}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm border transition-colors ${
                  metodo === 'pix' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'
                }`}
              >
                <QrCode className="w-4 h-4" />
                Pix
              </button>
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Assinar e configurar pagamento
          </button>
          <p className="text-[11px] text-uf-silver-dim text-center">
            Checkout seguro AbacatePay ({metodo === 'pix' ? 'Pix' : 'cartão'}). Se o cartão não estiver ativo na loja
            AbacatePay, usamos Pix automaticamente. Em homologação, a próxima tela tem “Simular pagamento”.
          </p>
        </form>
      </motion.div>
    </main>
  )
}
