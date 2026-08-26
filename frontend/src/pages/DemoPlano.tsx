import { Link, Navigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Lock, ShoppingBag, Truck, Users, Users2 } from 'lucide-react'
import type { PlanoCode } from '../lib/api'
import { PLAN_NAMES } from '../lib/plans'
import { demoExperienceUrl, type DemoRole } from '../lib/ecommerceUrl'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']

interface AreaDef {
  key: DemoRole
  label: string
  desc: string
  icon: typeof ShoppingBag
  /** null = disponível em todo plano; senão, o plano mínimo que libera. */
  requiredPlan: PlanoCode | null
  comingSoon?: boolean
}

const AREAS: AreaDef[] = [
  {
    key: 'vitrine',
    label: 'Vitrine (loja do cliente)',
    desc: 'O catálogo e checkout que o cliente final da loja vê.',
    icon: ShoppingBag,
    requiredPlan: null,
  },
  {
    key: 'admin',
    label: 'Painel admin',
    desc: 'Pedidos, produtos, financeiro — o painel completo do lojista.',
    icon: Users2,
    requiredPlan: null,
  },
  {
    key: 'vendedor',
    label: 'Painel vendedor',
    desc: 'PDV e pedidos do vendedor de balcão.',
    icon: Users,
    requiredPlan: 'management',
  },
  {
    key: 'motoboy',
    label: 'App motoboy',
    desc: 'Fila de entregas e corridas em andamento.',
    icon: Truck,
    requiredPlan: 'management',
  },
]

export default function DemoPlano() {
  const { plano } = useParams<{ plano: string }>()

  if (!plano || !PLAN_ORDER.includes(plano as PlanoCode)) {
    return <Navigate to="/demo" replace />
  }
  const planoCode = plano as PlanoCode
  const planoIndex = PLAN_ORDER.indexOf(planoCode)
  const isUnlocked = (a: AreaDef) => a.requiredPlan === null || PLAN_ORDER.indexOf(a.requiredPlan) <= planoIndex

  // Abre `/demo/{role}/{plano}` (URL canônica Resolutoo). A página embute
  // o motor via iframe já autenticado — nunca /loja/admin/login.
  const handleClick = (area: AreaDef) => {
    if (area.comingSoon || !isUnlocked(area)) return
    window.open(demoExperienceUrl(area.key, planoCode), '_blank', 'noopener,noreferrer')
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <div className="max-w-3xl mx-auto relative z-10">
        <Link to="/demo" className="inline-flex items-center gap-2 text-sm text-uf-silver-dim hover:text-uf-silver mb-8">
          <ArrowLeft className="w-4 h-4" />
          Trocar plano
        </Link>

        <div className="text-center mb-10">
          <span className="uf-eyebrow mb-4">Plano {PLAN_NAMES[planoCode]}</span>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black mt-4">O que você quer ver por dentro?</h1>
          <p className="text-sm text-uf-silver-dim mt-2">Cada área abre em uma nova aba, já logada, com dados de demonstração.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {AREAS.filter(isUnlocked).map((a, i) => {
            const available = !a.comingSoon
            return (
              <motion.button
                key={a.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                onClick={() => handleClick(a)}
                disabled={!available}
                className={`text-left uf-glass rounded-2xl p-5 flex items-start gap-4 transition-colors ${
                  available ? 'uf-glass-hover cursor-pointer' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <a.icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{a.label}</p>
                  <p className="text-xs text-uf-silver-dim mt-1">{a.desc}</p>
                  {!available && (
                    <p className="text-[11px] text-uf-silver-dim/70 mt-2 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Em breve
                    </p>
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </main>
  )
}
