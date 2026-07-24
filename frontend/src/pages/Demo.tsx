import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  BarChart3,
  Bike,
  ClipboardList,
  DollarSign,
  ImageIcon,
  Lock,
  Megaphone,
  Package,
  Sparkles,
  Ticket,
  UserCircle2,
  Users,
} from 'lucide-react'
import type { PlanoCode } from '../lib/api'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']
const PLAN_NAMES: Record<PlanoCode, string> = { essential: 'Essential', management: 'Management', premium: 'Premium' }
const PLAN_PRICES: Record<PlanoCode, number> = { essential: 60, management: 250, premium: 350 }

// Pedidos falsos só pra preencher o mockup — nunca vem de API nenhuma.
const PEDIDOS_MOCK = [
  { id: '#a1b2c3', cliente: 'Marina S.', status: 'Pedido pronto', total: 'R$ 68,90' },
  { id: '#d4e5f6', cliente: 'João P.', status: 'Em rota', total: 'R$ 124,50' },
  { id: '#g7h8i9', cliente: 'Carla M.', status: 'Concluído', total: 'R$ 42,00' },
  { id: '#j1k2l3', cliente: 'Rafael T.', status: 'Montando', total: 'R$ 89,90' },
]
const PRODUTOS_MOCK = [
  { emoji: '🥐', nome: 'Combo Café', preco: 'R$ 24,90' },
  { emoji: '🍔', nome: 'Burger Artesanal', preco: 'R$ 32,00' },
  { emoji: '🍕', nome: 'Pizza Média', preco: 'R$ 48,00' },
  { emoji: '🥤', nome: 'Suco Natural', preco: 'R$ 12,00' },
]
const FUNCIONARIOS_MOCK = [
  { nome: 'Ana Souza', papel: 'Vendedora' },
  { nome: 'Bruno Lima', papel: 'Caixa' },
]
const MOTOBOYS_MOCK = [
  { nome: 'Diego R.', status: 'Em entrega', pedidos: 2 },
  { nome: 'Felipe A.', status: 'Disponível', pedidos: 0 },
]
const CUPONS_MOCK = [
  { codigo: 'BEMVINDO10', desconto: '10% off' },
  { codigo: 'FRETEGRATIS', desconto: 'Frete grátis' },
]
const CAMPANHAS_MOCK = [
  { nome: 'Aniversário da loja', status: 'Ativa' },
  { nome: 'Volta às aulas', status: 'Agendada' },
]
const SEGMENTOS_MOCK = [
  { nome: 'Clientes VIP', pessoas: 128 },
  { nome: 'Não compram há 30 dias', pessoas: 47 },
]

interface ModuleDef {
  key: string
  label: string
  icon: typeof Package
  requiredPlan: PlanoCode
  content: React.ReactNode
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="uf-glass rounded-2xl p-4">
      <p className="text-xs text-uf-silver-dim mb-1">{label}</p>
      <p className="text-xl font-black">{value}</p>
    </div>
  )
}

function ListMock({ rows }: { rows: { left: string; right: string }[] }) {
  return (
    <div className="uf-glass rounded-2xl divide-y divide-white/5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3 text-sm">
          <span>{r.left}</span>
          <span className="text-uf-silver-dim">{r.right}</span>
        </div>
      ))}
    </div>
  )
}

const MODULES: ModuleDef[] = [
  {
    key: 'catalogo',
    label: 'Catálogo',
    icon: Package,
    requiredPlan: 'essential',
    content: (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PRODUTOS_MOCK.map((p) => (
          <div key={p.nome} className="uf-glass rounded-2xl p-4 text-center">
            <p className="text-3xl mb-2">{p.emoji}</p>
            <p className="text-sm font-semibold">{p.nome}</p>
            <p className="text-xs text-uf-silver-dim mt-1">{p.preco}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'pedidos',
    label: 'Pedidos',
    icon: ClipboardList,
    requiredPlan: 'essential',
    content: (
      <div className="uf-glass rounded-2xl overflow-hidden">
        {PEDIDOS_MOCK.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm border-b border-white/5 last:border-b-0">
            <div>
              <p className="font-semibold">{p.id}</p>
              <p className="text-xs text-uf-silver-dim">{p.cliente}</p>
            </div>
            <span className="text-xs uf-glass px-2.5 py-1 rounded-full">{p.status}</span>
            <span className="font-semibold">{p.total}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: DollarSign,
    requiredPlan: 'essential',
    content: (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile label="Faturamento (mês)" value="R$ 8.240" />
        <StatTile label="Pedidos" value="164" />
        <StatTile label="Ticket médio" value="R$ 50,20" />
      </div>
    ),
  },
  {
    key: 'funcionarios',
    label: 'Funcionários',
    icon: Users,
    requiredPlan: 'management',
    content: <ListMock rows={FUNCIONARIOS_MOCK.map((f) => ({ left: f.nome, right: f.papel }))} />,
  },
  {
    key: 'motoboy',
    label: 'Motoboy',
    icon: Bike,
    requiredPlan: 'management',
    content: <ListMock rows={MOTOBOYS_MOCK.map((m) => ({ left: m.nome, right: `${m.status} · ${m.pedidos} pedido(s)` }))} />,
  },
  {
    key: 'banner',
    label: 'Banner promocional',
    icon: ImageIcon,
    requiredPlan: 'management',
    content: (
      <div className="uf-glass rounded-2xl aspect-[3/1] flex items-center justify-center text-uf-silver-dim text-sm">
        Prévia do banner promocional da home
      </div>
    ),
  },
  {
    key: 'crm',
    label: 'CRM',
    icon: UserCircle2,
    requiredPlan: 'premium',
    content: <ListMock rows={SEGMENTOS_MOCK.map((s) => ({ left: s.nome, right: `${s.pessoas} clientes` }))} />,
  },
  {
    key: 'cupons',
    label: 'Cupons',
    icon: Ticket,
    requiredPlan: 'premium',
    content: <ListMock rows={CUPONS_MOCK.map((c) => ({ left: c.codigo, right: c.desconto }))} />,
  },
  {
    key: 'campanhas',
    label: 'Campanhas',
    icon: Megaphone,
    requiredPlan: 'premium',
    content: <ListMock rows={CAMPANHAS_MOCK.map((c) => ({ left: c.nome, right: c.status }))} />,
  },
  {
    key: 'relatorios',
    label: 'Relatórios',
    icon: BarChart3,
    requiredPlan: 'premium',
    content: (
      <div className="uf-glass rounded-2xl p-6 text-center text-uf-silver-dim text-sm">
        Gráficos de vendas, produtos mais vendidos e comissões por período
      </div>
    ),
  },
]

export default function Demo() {
  const [searchParams] = useSearchParams()
  const planoParam = searchParams.get('plano') as PlanoCode | null
  const [plano, setPlano] = useState<PlanoCode>(planoParam && PLAN_ORDER.includes(planoParam) ? planoParam : 'essential')
  const [activeKey, setActiveKey] = useState('catalogo')

  const planoIndex = PLAN_ORDER.indexOf(plano)
  const isUnlocked = (m: ModuleDef) => PLAN_ORDER.indexOf(m.requiredPlan) <= planoIndex
  const active = MODULES.find((m) => m.key === activeKey) ?? MODULES[0]

  const handleSelectPlano = (p: PlanoCode) => {
    setPlano(p)
    // Se o módulo aberto ficar bloqueado no plano novo, volta pro Catálogo
    // (sempre disponível) em vez de deixar a tela travada num módulo cinza.
    const stillUnlocked = MODULES.find((m) => m.key === activeKey && PLAN_ORDER.indexOf(m.requiredPlan) <= PLAN_ORDER.indexOf(p))
    if (!stillUnlocked) setActiveKey('catalogo')
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver">
      <header className="border-b border-white/5 px-5 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-uf-silver-dim hover:text-uf-silver">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Link>
          <span className="text-lg font-black uf-text">Rodoletas</span>
          <Link to={`/cadastro?plano=${plano}`} className="btn-primary px-4 py-2 text-sm">
            Assinar {PLAN_NAMES[plano]}
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-10">
        <div className="text-center mb-8">
          <span className="uf-eyebrow mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Demo interativa
          </span>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black mt-4">Veja o painel por dentro, em cada plano</h1>
          <p className="text-sm text-uf-silver-dim mt-2 max-w-xl mx-auto">
            Dados de exemplo, só pra mostrar o que cada plano libera — nada aqui é real.
          </p>
        </div>

        {/* Seletor de plano */}
        <div className="flex justify-center mb-8">
          <div className="uf-glass rounded-full p-1 flex gap-1 w-full sm:w-auto overflow-x-auto">
            {PLAN_ORDER.map((p) => (
              <button
                key={p}
                onClick={() => handleSelectPlano(p)}
                className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                  plano === p ? 'uf-bg text-white' : 'text-uf-silver-dim hover:text-uf-silver'
                }`}
              >
                {PLAN_NAMES[p]} · R$ {PLAN_PRICES[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Painel mockado */}
        <div className="uf-glass rounded-3xl p-2 sm:p-3 overflow-hidden">
          <div className="grid lg:grid-cols-[220px_1fr] gap-2 sm:gap-3">
            {/* Sidebar de módulos */}
            <nav className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
              {MODULES.map((m) => {
                const unlocked = isUnlocked(m)
                const isActive = activeKey === m.key
                return (
                  <button
                    key={m.key}
                    onClick={() => unlocked && setActiveKey(m.key)}
                    disabled={!unlocked}
                    className={`shrink-0 lg:shrink flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm text-left transition-colors ${
                      isActive && unlocked
                        ? 'bg-white/10 text-uf-silver'
                        : unlocked
                          ? 'text-uf-silver-dim hover:text-uf-silver hover:bg-white/5'
                          : 'text-uf-silver-dim/40 cursor-not-allowed'
                    }`}
                  >
                    <m.icon className="w-4 h-4 shrink-0" />
                    <span className="whitespace-nowrap lg:whitespace-normal">{m.label}</span>
                    {!unlocked && <Lock className="w-3 h-3 ml-auto shrink-0" />}
                  </button>
                )
              })}
            </nav>

            {/* Conteúdo do módulo ativo */}
            <div className="bg-uf-surface rounded-2xl p-4 sm:p-6 min-h-[320px]">
              <AnimatePresence mode="wait">
                {isUnlocked(active) ? (
                  <motion.div
                    key={active.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <h2 className="font-bold text-lg mb-4">{active.label}</h2>
                    {active.content}
                  </motion.div>
                ) : (
                  <motion.div
                    key="locked"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center text-center h-full min-h-[280px] gap-3"
                  >
                    <Lock className="w-8 h-8 text-uf-silver-dim" />
                    <p className="text-sm text-uf-silver-dim max-w-xs">
                      {active.label} disponível a partir do plano {PLAN_NAMES[active.requiredPlan]}.
                    </p>
                    <button onClick={() => handleSelectPlano(active.requiredPlan)} className="btn-secondary text-xs px-4 py-2 mt-1">
                      Ver no plano {PLAN_NAMES[active.requiredPlan]}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
