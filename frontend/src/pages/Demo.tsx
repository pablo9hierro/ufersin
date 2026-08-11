import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, Loader2, Lock, ShoppingBag, Smartphone, X } from 'lucide-react'
import type { PlanoCode } from '../lib/api'
import { CmsEditProvider, CmsText, usePlatformContent } from '../lib/cms'
import { fetchPlans, formatBRL, getPlans, planDisplayName } from '../lib/plans'

type RamoCode = 'ecommerce' | 'eletronica'

interface RamoDef {
  code: RamoCode
  label: string
  desc: string
  icon: typeof ShoppingBag
  comingSoon: boolean
  buildPath: (plano: PlanoCode) => string
}

const RAMOS: RamoDef[] = [
  {
    code: 'ecommerce',
    label: 'Ecommerce',
    desc: 'Lanchonete, pizzaria, tabacaria, conveniência e afins — catálogo, checkout e entrega.',
    icon: ShoppingBag,
    comingSoon: false,
    buildPath: (plano) => `/demo/${plano}`,
  },
  {
    code: 'eletronica',
    label: 'Manutenção e venda de eletrônicos',
    desc: 'Assistência técnica e loja de equipamentos — catálogo de produtos e serviços de reparo.',
    icon: Smartphone,
    comingSoon: false,
    // Página própria de escolha de área (vitrine/admin do vrtech) — mesmo
    // padrão do ramo ecommerce (DemoPlano), nunca o motor genérico.
    buildPath: (plano) => `/demo/eletronica/${plano}`,
  },
]

interface DemoProps {
  /** When true, skip auth chrome wrappers and use outer CmsEditProvider. */
  cmsPreview?: boolean
}

/**
 * Passo 1 da demo pública: escolher plano + ramo do negócio.
 */
export default function Demo({ cmsPreview = false }: DemoProps) {
  const navigate = useNavigate()
  const [pendingPlano, setPendingPlano] = useState<PlanoCode | null>(null)
  const [plansReady, setPlansReady] = useState(false)
  const { content, ready: contentReady } = usePlatformContent()

  useEffect(() => {
    fetchPlans().finally(() => setPlansReady(true))
  }, [])

  useEffect(() => {
    if (cmsPreview) return
    document.body.style.overflow = pendingPlano ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [pendingPlano, cmsPreview])

  const handleEscolherRamo = (ramo: RamoDef) => {
    if (cmsPreview || ramo.comingSoon || !pendingPlano) return
    navigate(ramo.buildPath(pendingPlano))
    setPendingPlano(null)
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
                    onClick={() => !cmsPreview && setPendingPlano(plan.code)}
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

      {!cmsPreview && (
        <AnimatePresence>
          {pendingPlano && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center px-5 bg-black/70 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingPlano(null)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Escolher ramo do negócio"
                className="uf-glass rounded-3xl p-7 w-full max-w-md relative"
                style={{ background: 'var(--color-uf-surface)' }}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setPendingPlano(null)}
                  aria-label="Fechar"
                  className="absolute top-5 right-5 text-uf-silver-dim hover:text-uf-silver"
                >
                  <X className="w-4 h-4" />
                </button>

                <span className="uf-eyebrow mb-4">Plano {planDisplayName(pendingPlano)}</span>
                <h2 className="text-xl font-black mt-4 mb-1">Qual é o ramo do seu negócio?</h2>
                <p className="text-sm text-uf-silver-dim mb-6">A demonstração muda conforme o tipo de loja.</p>

                <div className="space-y-3">
                  {RAMOS.map((ramo) => (
                    <button
                      key={ramo.code}
                      type="button"
                      onClick={() => handleEscolherRamo(ramo)}
                      disabled={ramo.comingSoon}
                      className={`w-full text-left rounded-2xl p-4 flex items-start gap-3.5 border transition-colors ${
                        ramo.comingSoon
                          ? 'border-white/5 opacity-50 cursor-not-allowed'
                          : 'border-white/10 hover:border-white/20 hover:bg-white/[0.04] cursor-pointer'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                        <ramo.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm">{ramo.label}</p>
                        <p className="text-xs text-uf-silver-dim mt-1">{ramo.desc}</p>
                        {ramo.comingSoon && (
                          <p className="text-[11px] text-uf-silver-dim/70 mt-2 flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            Em breve
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
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
