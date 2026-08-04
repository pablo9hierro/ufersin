import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { CmsText } from '../../lib/cms'
import { fetchPlans, SEMESTRAL_DISCOUNT } from '../../lib/plans'
import type { BillingCycle } from '../../lib/api'
import PlanCardsGrid, { BillingCycleToggle } from '../PlanCardsGrid'

export default function Pricing() {
  const [ciclo, setCiclo] = useState<BillingCycle>('mensal')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetchPlans().finally(() => setReady(true))
  }, [])

  return (
    <section id="planos" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <span className="uf-eyebrow mb-4">Planos</span>
          <CmsText
            contentKey="landing.pricing.title"
            as="h2"
            className="text-3xl sm:text-4xl md:text-5xl font-black mt-4 block"
          />
          <CmsText
            contentKey="landing.pricing.sub"
            as="p"
            className="mt-4 text-uf-silver-dim max-w-xl mx-auto block"
          />

          <div className="mt-8">
            <BillingCycleToggle ciclo={ciclo} onChange={setCiclo} />
          </div>
          {ciclo === 'semestral' && (
            <p className="mt-3 text-sm text-emerald-400/90">
              Assine semestralmente e ganhe {Math.round(SEMESTRAL_DISCOUNT * 100)}% de desconto no total do semestre.
            </p>
          )}
        </motion.div>

        {!ready ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
          </div>
        ) : (
          <PlanCardsGrid
            ciclo={ciclo}
            showDemo
            cta={{
              kind: 'link',
              to: (code, c) => `/cadastro?plano=${code}&ciclo=${c}`,
            }}
          />
        )}
      </div>
    </section>
  )
}
