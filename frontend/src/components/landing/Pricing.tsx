import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Check, MousePointerClick } from 'lucide-react'
import type { PlanoCode } from '../../lib/api'

interface Plan {
  code: PlanoCode
  name: string
  price: number
  tagline: string
  features: string[]
  highlight?: boolean
}

const PLANS: Plan[] = [
  {
    code: 'essential',
    name: 'Essential',
    price: 60,
    tagline: 'Pra começar a vender online',
    features: ['Catálogo', 'Checkout', 'Pix', 'WhatsApp', 'Pedidos'],
  },
  {
    code: 'management',
    name: 'Management',
    price: 250,
    tagline: 'Pra quem já tem equipe e entrega',
    features: ['Tudo do Essential', 'Funcionários', 'Motoboy', 'Banner promocional', 'Comissões'],
    highlight: true,
  },
  {
    code: 'premium',
    name: 'Premium',
    price: 350,
    tagline: 'Pra escalar com CRM e campanhas',
    features: ['Tudo do Management', 'CRM completo', 'Segmentações', 'Automações', 'Cupons', 'Campanhas', 'Relatórios'],
  },
]

export default function Pricing() {
  return (
    <section id="planos" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">Planos</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Um plano pra <span className="uf-text">cada momento</span> do seu negócio
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            Comece simples e evolua quando precisar. Trocar de plano é instantâneo, sem taxa, direto pelo
            seu painel.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.code}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`relative rounded-3xl p-7 flex flex-col ${
                plan.highlight
                  ? 'uf-bg shadow-2xl shadow-[color:var(--color-uf-purple)]/20 md:-translate-y-3'
                  : 'uf-glass uf-glass-hover'
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

              <Link
                to={`/cadastro?plano=${plan.code}`}
                className={`mt-8 w-full py-3 text-sm ${plan.highlight ? 'btn-secondary !bg-white !text-uf-black hover:!bg-white/90' : 'btn-primary'}`}
              >
                Assinar {plan.name}
              </Link>
              <a
                href={`/demo?plano=${plan.code}`}
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
          ))}
        </div>
      </div>
    </section>
  )
}
