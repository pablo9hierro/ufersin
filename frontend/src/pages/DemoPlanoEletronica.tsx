import { Link, Navigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ShoppingBag, Users2 } from 'lucide-react'
import type { PlanoCode } from '../lib/api'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const PLAN_NAMES: Record<PlanoCode, string> = { essential: 'Essential', management: 'Management', premium: 'Premium' }

// Módulo eletrônicos é um app separado (vrtech) — nunca embutido via
// /demo/{role}/{plano} do motor de e-commerce (esse mecanismo só existe pro
// ramo 'ecommerce'). Aqui é sempre navegação de página cheia pro domínio
// real do módulo.
function vrtechUrl(path: string) {
  const base = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://vrtech-jp.vercel.app'
  return `${base}${path}`
}

interface AreaDef {
  key: 'vitrine' | 'admin'
  label: string
  desc: string
  icon: typeof ShoppingBag
  url: string
}

const AREAS: AreaDef[] = [
  {
    key: 'vitrine',
    label: 'Vitrine (loja do cliente)',
    desc: 'Catálogo de produtos, catálogo de serviços de reparo e checkout que o cliente final vê.',
    icon: ShoppingBag,
    url: vrtechUrl('/'),
  },
  {
    key: 'admin',
    label: 'Área logada (admin)',
    desc: 'Solicitações, produtos/serviços, pedidos, financeiro — o painel completo do lojista.',
    icon: Users2,
    url: vrtechUrl('/login'),
  },
]

export default function DemoPlanoEletronica() {
  const { plano } = useParams<{ plano: string }>()

  if (!plano || !PLAN_ORDER.includes(plano as PlanoCode)) {
    return <Navigate to="/demo" replace />
  }
  const planoCode = plano as PlanoCode

  const handleClick = (area: AreaDef) => {
    window.open(area.url, '_blank', 'noopener,noreferrer')
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
          <span className="uf-eyebrow mb-4">Plano {PLAN_NAMES[planoCode]} — Manutenção e venda de eletrônicos</span>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black mt-4">O que você quer ver por dentro?</h1>
          <p className="text-sm text-uf-silver-dim mt-2">Cada área abre em uma nova aba, direto no app da loja.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {AREAS.map((a, i) => (
            <motion.button
              key={a.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              onClick={() => handleClick(a)}
              className="text-left uf-glass uf-glass-hover cursor-pointer rounded-2xl p-5 flex items-start gap-4 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                <a.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{a.label}</p>
                <p className="text-xs text-uf-silver-dim mt-1">{a.desc}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </main>
  )
}
