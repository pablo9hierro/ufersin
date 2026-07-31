import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { PLANS } from '../lib/plans'

/** Mesmos cards da Pricing da Landing, mas pra quem já está logado e ainda
 * não escolheu plano (`me.plano === null`) -- pula direto pro pagamento em
 * /assinar em vez de passar pelo cadastro de novo. */
export default function Planos() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <div className="uf-container relative z-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center mb-12">
          <Link to="/" className="text-2xl font-black uf-text">
            Rodoletas
          </Link>
          <h1 className="text-3xl sm:text-4xl font-black mt-4">Escolha seu plano</h1>
          <p className="mt-3 text-uf-silver-dim max-w-xl mx-auto">Sua conta já está criada — falta só escolher o plano e a forma de pagamento.</p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.code}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`relative rounded-3xl p-7 flex flex-col ${
                plan.highlight ? 'uf-bg shadow-2xl shadow-[color:var(--color-uf-purple)]/20 md:-translate-y-3' : 'uf-glass uf-glass-hover'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-uf-black text-[11px] font-bold px-3 py-1 rounded-full">
                  MAIS ESCOLHIDO
                </span>
              )}
              <h3 className={`font-black text-xl ${plan.highlight ? 'text-white' : ''}`}>{plan.name}</h3>
              <p className={`text-sm mt-1 ${plan.highlight ? 'text-white/80' : 'text-uf-silver-dim'}`}>{plan.tagline}</p>

              <div className="mt-6 mb-2">
                <span className={`text-4xl font-black ${plan.highlight ? 'text-white' : ''}`}>R$ {plan.price}</span>
                <span className={`text-sm ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>/mês</span>
              </div>

              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className={`flex items-center gap-2.5 text-sm ${plan.highlight ? 'text-white/95' : 'text-uf-silver'}`}>
                    <Check className={`w-4 h-4 shrink-0 ${plan.highlight ? 'text-white' : 'text-uf-blue'}`} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => navigate(`/assinar?plano=${plan.code}`)}
                className={`mt-8 w-full py-3 text-sm ${plan.highlight ? 'btn-secondary !bg-white !text-uf-black hover:!bg-white/90' : 'btn-primary'}`}
              >
                Assinar {plan.name}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </main>
  )
}
