import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Check, Loader2, MousePointerClick } from 'lucide-react'
import { fetchPlans, formatBRL, getPlans, priceForCycle, SEMESTRAL_DISCOUNT } from '../../lib/plans'
import type { BillingCycle } from '../../lib/api'

export default function Pricing() {
  const [ciclo, setCiclo] = useState<BillingCycle>('mensal')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetchPlans().finally(() => setReady(true))
  }, [])

  const plans = getPlans()

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
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Um plano pra <span className="uf-text">cada momento</span> do seu negócio
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            Comece simples e evolua quando precisar. Trocar de plano é instantâneo, sem taxa, direto pelo seu painel.
          </p>

          <div className="mt-8 inline-flex rounded-xl border border-white/10 p-1 bg-white/5">
            <button
              type="button"
              onClick={() => setCiclo('mensal')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                ciclo === 'mensal' ? 'bg-white text-uf-black font-semibold' : 'text-uf-silver-dim hover:text-uf-silver'
              }`}
            >
              Mensal
            </button>
            <button
              type="button"
              onClick={() => setCiclo('semestral')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                ciclo === 'semestral' ? 'bg-white text-uf-black font-semibold' : 'text-uf-silver-dim hover:text-uf-silver'
              }`}
            >
              Semestral
              <span className="ml-1.5 text-[11px] font-bold text-emerald-600">−{Math.round(SEMESTRAL_DISCOUNT * 100)}%</span>
            </button>
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
          <div className="grid md:grid-cols-3 gap-5">
            {plans.map((plan, i) => {
              const charged = priceForCycle(plan.price, ciclo)
              return (
                <motion.div
                  key={plan.code}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
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
                  {ciclo === 'semestral' && (
                    <span
                      className={`absolute top-4 right-4 text-[10px] font-bold px-2 py-1 rounded-md ${
                        plan.highlight ? 'bg-white/20 text-white' : 'bg-emerald-500/15 text-emerald-300'
                      }`}
                    >
                      {Math.round(SEMESTRAL_DISCOUNT * 100)}% OFF
                    </span>
                  )}
                  <h3 className={`font-black text-xl ${plan.highlight ? 'text-white' : ''}`}>{plan.name}</h3>
                  <p className={`text-sm mt-1 ${plan.highlight ? 'text-white/80' : 'text-uf-silver-dim'}`}>{plan.tagline}</p>

                  <div className="mt-6 mb-2">
                    {ciclo === 'mensal' ? (
                      <>
                        <span className={`text-4xl font-black ${plan.highlight ? 'text-white' : ''}`}>R$ {formatBRL(plan.price)}</span>
                        <span className={`text-sm ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>/mês</span>
                      </>
                    ) : (
                      <>
                        <span className={`text-4xl font-black ${plan.highlight ? 'text-white' : ''}`}>R$ {formatBRL(charged)}</span>
                        <span className={`text-sm ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>/semestre</span>
                        <p className={`text-xs mt-1 ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>
                          equiv. R$ {formatBRL(charged / 6)}/mês · de R$ {formatBRL(plan.price * 6)}
                        </p>
                      </>
                    )}
                  </div>

                  <ul className="mt-6 space-y-3 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className={`flex items-center gap-2.5 text-sm ${plan.highlight ? 'text-white/95' : 'text-uf-silver'}`}>
                        <Check className={`w-4 h-4 shrink-0 ${plan.highlight ? 'text-white' : 'text-uf-blue'}`} />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <Link
                    to={`/cadastro?plano=${plan.code}&ciclo=${ciclo}`}
                    className={`mt-8 w-full py-3 text-sm text-center ${plan.highlight ? 'btn-secondary !bg-white !text-uf-black hover:!bg-white/90' : 'btn-primary'}`}
                  >
                    Assinar {plan.name}
                  </Link>
                  <a
                    href={`/demo/${plan.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`mt-2 w-full py-2.5 text-xs flex items-center justify-center gap-1.5 ${
                      plan.highlight ? 'text-white/80 hover:text-white' : 'text-uf-silver-dim hover:text-uf-silver'
                    }`}
                  >
                    <MousePointerClick className="w-3.5 h-3.5" />
                    Experimentar esse plano
                  </a>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
