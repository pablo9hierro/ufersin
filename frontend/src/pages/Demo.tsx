import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, Lock, Scissors, ShoppingBag, X } from 'lucide-react'
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

type RamoCode = 'ecommerce' | 'salao_barbearia'

interface RamoDef {
  code: RamoCode
  label: string
  desc: string
  icon: typeof ShoppingBag
  /** Ramos sem site-demo próprio ainda ficam travados aqui -- vira
   *  `false` no dia em que esse site-demo existir, sem mexer em mais
   *  nada além disso + de buildPath abaixo. */
  comingSoon: boolean
  /** Pra onde a jornada de demo segue quando este ramo é escolhido.
   *  'ecommerce' usa o fluxo /demo/:plano já existente, que abre
   *  vitrine/admin/motoboy/vendedor do ecommerce/frontend (ver
   *  DemoPlano.tsx + ECOMMERCE_FRONTEND_URL) -- inclusive com o próprio
   *  seletor de layout visual da loja (DemoPaletteSwitcher.tsx, dentro
   *  daquele frontend). 'salao_barbearia', quando o site-demo dedicado
   *  existir (outro frontend, com seus próprios templates de vitrine
   *  para salão/barbearia + um seletor de layout equivalente ao
   *  DemoPaletteSwitcher), ganha aqui seu próprio path/URL apontando pra
   *  ele -- mesmo padrão de env var usado por ECOMMERCE_FRONTEND_URL em
   *  DemoPlano.tsx. Até lá, o botão fica com comingSoon: true e este
   *  path nunca é de fato navegado. */
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
    code: 'salao_barbearia',
    label: 'Salão de beleza / Barbearia',
    desc: 'Agendamento de horários e serviços.',
    icon: Scissors,
    comingSoon: true,
    buildPath: (plano) => `/demo/${plano}?ramo=salao_barbearia`,
  },
]

/**
 * Passo 1 da demo pública: escolher plano + ramo do negócio. Clicar em
 * "Ver demonstração" abre um diálogo pra escolher o ramo (hoje só
 * "Ecommerce" está disponível; "Salão/Barbearia" fica travado até existir
 * um site-demo próprio pra esse ramo). Escolhendo Ecommerce, segue pro
 * passo 2 (/demo/:plano, DemoPlano.tsx) -- de lá é que abre em nova guia
 * as telas REAIS de admin/motoboy/vitrine, logadas na loja demo dedicada
 * (nunca uma loja real). Ver ecommerce/backend/src/routes/demo.rs.
 */
export default function Demo() {
  const navigate = useNavigate()
  const [pendingPlano, setPendingPlano] = useState<PlanoCode | null>(null)

  useEffect(() => {
    document.body.style.overflow = pendingPlano ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [pendingPlano])

  const handleEscolherRamo = (ramo: RamoDef) => {
    if (ramo.comingSoon || !pendingPlano) return
    navigate(ramo.buildPath(pendingPlano))
    setPendingPlano(null)
  }

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
                <div className="uf-glass uf-glass-hover rounded-3xl p-7 flex flex-col h-full">
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
                  <button onClick={() => setPendingPlano(code)} className="btn-primary w-full py-3 text-sm mt-7">
                    Ver demonstração
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

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
                onClick={() => setPendingPlano(null)}
                aria-label="Fechar"
                className="absolute top-5 right-5 text-uf-silver-dim hover:text-uf-silver"
              >
                <X className="w-4 h-4" />
              </button>

              <span className="uf-eyebrow mb-4">Plano {pendingPlano && PLANS[pendingPlano].name}</span>
              <h2 className="text-xl font-black mt-4 mb-1">Qual é o ramo do seu negócio?</h2>
              <p className="text-sm text-uf-silver-dim mb-6">A demonstração muda conforme o tipo de loja.</p>

              <div className="space-y-3">
                {RAMOS.map((ramo) => (
                  <button
                    key={ramo.code}
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
    </main>
  )
}
