import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check } from 'lucide-react'
import type { PlanoCode } from '../lib/api'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const PLANS: Record<PlanoCode, { name: string; price: number; tagline: string; features: string[] }> = {
  essential: {
    name: 'Essential',
    price: 60,
    tagline: 'Pra começar a vender online',
    features: ['Catálogo', 'Checkout', 'Pix', 'WhatsApp', 'Pedidos'],
  },
  management: {
    name: 'Management',
    price: 250,
    tagline: 'Pra quem já tem equipe e entrega',
    features: ['Tudo do Essential', 'Funcionários', 'Motoboy', 'Banner promocional', 'Comissões'],
  },
  premium: {
    name: 'Premium',
    price: 350,
    tagline: 'Pra escalar com CRM e campanhas',
    features: ['Tudo do Management', 'CRM completo', 'Cupons', 'Campanhas', 'Relatórios'],
  },
}

/**
 * Passo 1 da demo pública: escolher qual plano ver por dentro. Passo 2 é
 * /demo/:plano (DemoPlano.tsx) — de lá sim é que abre em nova guia as
 * telas REAIS de admin/motoboy/vitrine, logadas na loja demo dedicada
 * (nunca uma loja real). Ver ecommerce/backend/src/routes/demo.rs.
 */
export default function Demo() {
  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <div className="max-w-5xl mx-auto relative z-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-uf-silver-dim hover:text-uf-silver mb-8">
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Link>

        <div className="text-center mb-12">
          <span className="uf-eyebrow mb-4">Demo pública</span>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">Escolha um plano pra ver por dentro</h1>
          <p className="text-sm text-uf-silver-dim mt-3 max-w-lg mx-auto">
            Você vai acessar as páginas reais que vem com cada plano — vitrine, painel admin e área do motoboy —
            com dados de demonstração, exatamente como o assinante recebe.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {PLAN_ORDER.map((code, i) => {
            const plan = PLANS[code]
            return (
              <motion.div
                key={code}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <Link to={`/demo/${code}`} className="uf-glass uf-glass-hover rounded-3xl p-7 flex flex-col h-full">
                  <h2 className="font-black text-xl">{plan.name}</h2>
                  <p className="text-sm text-uf-silver-dim mt-1">{plan.tagline}</p>
                  <p className="mt-5 mb-1">
                    <span className="text-3xl font-black">R$ {plan.price}</span>
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
                  <span className="btn-primary w-full py-3 text-sm mt-7">Ver demonstração</span>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
