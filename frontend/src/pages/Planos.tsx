import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { fetchPlans } from '../lib/plans'
import type { BillingCycle } from '../lib/api'
import PlanCardsGrid, { BillingCycleToggle } from '../components/PlanCardsGrid'

export default function Planos() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()
  const [ciclo, setCiclo] = useState<BillingCycle>('mensal')
  const [plansReady, setPlansReady] = useState(false)

  useEffect(() => {
    fetchPlans().finally(() => setPlansReady(true))
  }, [])

  if (!ready || !plansReady) {
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
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <Link to="/" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <h1 className="text-3xl sm:text-4xl font-black mt-4">Escolha seu plano</h1>
          <p className="mt-3 text-uf-silver-dim max-w-xl mx-auto">
            Sua conta já está criada — falta só escolher o plano e a forma de pagamento.
          </p>

          <div className="mt-8">
            <BillingCycleToggle ciclo={ciclo} onChange={setCiclo} />
          </div>
        </motion.div>

        <div className="max-w-5xl mx-auto">
          <PlanCardsGrid
            ciclo={ciclo}
            animateOnMount
            cta={{
              kind: 'button',
              onSelect: (code, c) => navigate(`/assinar?plano=${code}&ciclo=${c}`),
            }}
          />
        </div>
      </div>
    </main>
  )
}
