import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Bike, Clock, Lock, ShoppingBag, Users2 } from 'lucide-react'
import type { PlanoCode } from '../lib/api'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const PLAN_NAMES: Record<PlanoCode, string> = { essential: 'Essential', management: 'Management', premium: 'Premium' }

const ECOMMERCE_API_URL = import.meta.env.VITE_ECOMMERCE_API_URL || 'http://localhost:8080'
const ECOMMERCE_FRONTEND_URL = import.meta.env.VITE_ECOMMERCE_FRONTEND_URL || 'http://localhost:5173'

interface AreaDef {
  key: 'vitrine' | 'admin' | 'motoboy' | 'vendedor'
  label: string
  desc: string
  icon: typeof ShoppingBag
  /** null = disponível em todo plano; senão, o plano mínimo que libera. */
  requiredPlan: PlanoCode | null
  /** Áreas ainda não plugadas na demo (dependem de uma peça que falta —
   *  ver comentário abaixo) ficam com essa flag em vez de fingir funcionar. */
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
    key: 'motoboy',
    label: 'Área do motoboy',
    desc: 'Fila de entregas, rota e confirmação de pagamento.',
    icon: Bike,
    requiredPlan: 'management',
  },
  {
    key: 'vendedor',
    label: 'Área do vendedor (PDV)',
    desc: 'Venda de balcão — em breve na demo pública.',
    icon: Clock,
    requiredPlan: 'management',
    comingSoon: true,
  },
]

export default function DemoPlano() {
  const { plano } = useParams<{ plano: string }>()
  const [loadingArea, setLoadingArea] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!plano || !PLAN_ORDER.includes(plano as PlanoCode)) {
    return <Navigate to="/demo" replace />
  }
  const planoCode = plano as PlanoCode
  const planoIndex = PLAN_ORDER.indexOf(planoCode)
  const isUnlocked = (a: AreaDef) => a.requiredPlan === null || PLAN_ORDER.indexOf(a.requiredPlan) <= planoIndex

  const abrirVitrine = () => {
    window.open(`${ECOMMERCE_FRONTEND_URL}/catalogo`, '_blank', 'noopener,noreferrer')
  }

  const abrirLogado = async (role: 'admin' | 'motoboy') => {
    setError(null)
    setLoadingArea(role)
    try {
      const res = await fetch(`${ECOMMERCE_API_URL}/demo/tokens`)
      if (!res.ok) throw new Error()
      const { admin_token, motoboy_token } = (await res.json()) as { admin_token: string; motoboy_token: string }
      const token = role === 'admin' ? admin_token : motoboy_token
      window.open(`${ECOMMERCE_FRONTEND_URL}/demo-entrar?role=${role}&token=${encodeURIComponent(token)}`, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Não foi possível abrir a demo agora. Tenta de novo em instantes.')
    } finally {
      setLoadingArea(null)
    }
  }

  const handleClick = (area: AreaDef) => {
    if (area.comingSoon || !isUnlocked(area)) return
    if (area.key === 'vitrine') abrirVitrine()
    else if (area.key === 'admin' || area.key === 'motoboy') abrirLogado(area.key)
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

        {error && <p className="error-msg text-center mb-4">{error}</p>}

        <div className="grid sm:grid-cols-2 gap-4">
          {AREAS.map((a, i) => {
            const unlocked = isUnlocked(a) && !a.comingSoon
            return (
              <motion.button
                key={a.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                onClick={() => handleClick(a)}
                disabled={!unlocked || loadingArea === a.key}
                className={`text-left uf-glass rounded-2xl p-5 flex items-start gap-4 transition-colors ${
                  unlocked ? 'uf-glass-hover cursor-pointer' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <a.icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm flex items-center gap-2">
                    {a.label}
                    {loadingArea === a.key && <span className="text-xs text-uf-silver-dim">abrindo...</span>}
                  </p>
                  <p className="text-xs text-uf-silver-dim mt-1">{a.desc}</p>
                  {!unlocked && (
                    <p className="text-[11px] text-uf-silver-dim/70 mt-2 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      {a.comingSoon ? 'Em breve' : `Disponível a partir do ${PLAN_NAMES[a.requiredPlan as PlanoCode]}`}
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
