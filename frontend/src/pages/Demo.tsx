import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { CmsEditProvider, CmsText, usePlatformContent } from '../lib/cms'
import { fetchPlans, formatBRL, getPlans } from '../lib/plans'

interface DemoProps {
  /** When true, skip auth chrome wrappers and use outer CmsEditProvider. */
  cmsPreview?: boolean
}

/**
 * Demo pública: cada plano já sabe o próprio ramo (`plan.vertical`), então
 * "Ver demonstração" navega direto -- sem perguntar ramo de novo. Antes
 * existia um modal "Qual é o ramo do seu negócio?" aqui porque o grid
 * misturava planos de ecommerce e eletrônica sem saber pra qual demo
 * mandar; virou redundante desde que o plano eletrônica ganhou card
 * exclusivo (Pricing.tsx) e cada `PlanInfo` carrega `vertical`.
 */
export default function Demo({ cmsPreview = false }: DemoProps) {
  const navigate = useNavigate()
  const [plansReady, setPlansReady] = useState(false)
  const { content, ready: contentReady } = usePlatformContent()

  useEffect(() => {
    fetchPlans().finally(() => setPlansReady(true))
  }, [])

  const handleVerDemo = (plano: string, vertical: string) => {
    if (cmsPreview) return
    navigate(vertical === 'eletronicos' ? `/demo/eletronica/${plano}` : `/demo/${plano}`)
  }

  const plans = getPlans()
  const body = (
    <main className={`${cmsPreview ? 'min-h-full' : 'min-h-screen'} bg-uf-black text-uf-silver px-5 py-16 relative`}>
      <div className="uf-mesh" />
      <div className="max-w-5xl mx-auto relative z-10">
        {!cmsPreview && (
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-uf-silver-dim hover:text-uf-silver mb-8">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Link>
        )}

        <div className="text-center mb-12">
          <span className="uf-eyebrow mb-4">Demo pública</span>
          <CmsText contentKey="demo.title" as="h1" className="text-3xl sm:text-4xl md:text-5xl font-black mt-4 block" />
          <CmsText contentKey="demo.sub" as="p" className="text-sm text-uf-silver-dim mt-3 max-w-lg mx-auto block" />
        </div>

        {!plansReady ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
          </div>
        ) : plans.length === 0 ? (
          <p className="text-center text-sm text-uf-silver-dim py-12">Nenhum plano disponível no momento.</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-5">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.code}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <div className="uf-glass uf-glass-hover rounded-3xl p-7 flex flex-col h-full">
                  <h2 className="font-black text-xl">{plan.name}</h2>
                  <p className="text-sm text-uf-silver-dim mt-1">{plan.tagline}</p>
                  <p className="mt-5 mb-1">
                    <span className="text-3xl font-black">R$ {formatBRL(plan.price)}</span>
                    <span className="text-sm text-uf-silver-dim">/mês</span>
                  </p>
                  <ul className="mt-5 space-y-2.5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-uf-blue shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => handleVerDemo(plan.code, plan.vertical)}
                    className="btn-primary w-full py-3 text-sm mt-7"
                  >
                    Ver demonstração
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </main>
  )

  if (cmsPreview) return body

  if (!contentReady) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }

  return (
    <CmsEditProvider editable={false} content={content}>
      {body}
    </CmsEditProvider>
  )
}
