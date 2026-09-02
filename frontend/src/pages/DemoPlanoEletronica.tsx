import { Link, Navigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ShoppingBag, Users2 } from 'lucide-react'
import type { PlanoCode } from '../lib/api'
import { PLAN_NAMES } from '../lib/plans'
import { fetchDemoAdminAutoLoginUrl, storePublicUrl } from '../lib/ecommerceUrl'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium', 'eletronica']

// Demo do ramo eletrônica roda 100% dentro do Resolutoo, nativa (mesmo
// motor Rust + o frontend do /loja) -- nunca mais um domínio externo
// (vrtech-jp.vercel.app foi descontinuado). Usava o tenant real "vrtech"
// (dono: pablohierro01@gmail.com) como vitrine/dados de demonstração --
// isso expunha dado de produção do dono como se fosse demo pública.
// Trocado pelo tenant demo seedado de verdade (ecommerce/backend/src/
// seed.rs::seed_demo_eletronica), isolado, sem dado real de ninguém.
const DEMO_TENANT_SLUG = 'demo-eletronica'

interface AreaDef {
  key: 'vitrine' | 'admin'
  label: string
  desc: string
  icon: typeof ShoppingBag
  url?: string
}

const AREAS: AreaDef[] = [
  {
    key: 'vitrine',
    label: 'Vitrine (loja do cliente)',
    desc: 'Catálogo de produtos, catálogo de serviços de reparo e checkout que o cliente final vê.',
    icon: ShoppingBag,
    url: storePublicUrl(DEMO_TENANT_SLUG),
  },
  {
    key: 'admin',
    label: 'Área logada (admin)',
    desc: 'Solicitações, agenda, estoque, PDV, mensagens — o painel completo do lojista.',
    icon: Users2,
    // Sem url fixa: abre já autenticado via token de /demo/tokens (ver handleClick).
  },
]

export default function DemoPlanoEletronica() {
  const { plano } = useParams<{ plano: string }>()

  if (!plano || !PLAN_ORDER.includes(plano as PlanoCode)) {
    return <Navigate to="/demo" replace />
  }
  const planoCode = plano as PlanoCode

  const handleClick = async (area: AreaDef) => {
    if (area.key === 'admin') {
      // Abre a aba já (gesto síncrono do clique) pra não cair no bloqueio
      // de pop-up do navegador enquanto o token é buscado.
      const tab = window.open('', '_blank', 'noopener,noreferrer')
      try {
        const url = await fetchDemoAdminAutoLoginUrl('eletronica')
        if (tab) tab.location.href = url
        else window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        tab?.close()
        window.alert('Não foi possível abrir o painel da demo agora. Tente de novo em instantes.')
      }
      return
    }
    if (area.url) window.open(area.url, '_blank', 'noopener,noreferrer')
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

        <p className="text-xs text-uf-silver-dim text-center mt-8">
          Área logada (admin) abre direto autenticada, sem senha — dados de demonstração, isolados de qualquer loja real.
        </p>
      </div>
    </main>
  )
}
