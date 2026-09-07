import { useState, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import {
  Bike,
  ChefHat,
  ClipboardList,
  CreditCard,
  FileText,
  Package,
  ShoppingBag,
  Wrench,
} from 'lucide-react'
import { CmsText } from '../../lib/cms'
import FeaturePreviewDialog from './FeaturePreviewDialog'

type Item = {
  key: string
  icon: typeof FileText
  title: string
  desc: string
  preview: () => ReactElement
}

function MockCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-uf-surface border border-white/10 rounded-xl p-4 text-sm">{children}</div>
}

const ITEMS: Item[] = [
  {
    key: 'systems.fiscal',
    icon: FileText,
    title: 'Nota fiscal (NF-e/NFC-e)',
    desc: 'Emissão automática assim que o pagamento cai. Nunca mais tirar nota na mão.',
    preview: () => (
      <MockCard>
        <p className="font-mono text-xs text-uf-silver-dim mb-2">Pedido #4821 — pago</p>
        <div className="flex items-center justify-between border-t border-white/10 pt-2">
          <span>NF-e emitida</span>
          <span className="text-emerald-400 font-semibold">autorizada</span>
        </div>
        <p className="text-xs text-uf-silver-dim mt-2 break-all">chave: 3526...9012 · protocolo real da SEFAZ</p>
      </MockCard>
    ),
  },
  {
    key: 'systems.servicos',
    icon: Wrench,
    title: 'Catálogo de serviços',
    desc: 'Vende produto e serviço na mesma vitrine, sem precisar de outro sistema.',
    preview: () => (
      <MockCard>
        <p className="mb-2 font-semibold">Troca de tela — iPhone 13</p>
        <p className="text-uf-silver-dim text-xs">Peça vinculada: Tela iPhone 13 (estoque: 4un)</p>
        <p className="text-uf-blue font-bold mt-2">R$ 349,00</p>
      </MockCard>
    ),
  },
  {
    key: 'systems.formulacao',
    icon: Package,
    title: 'Ficha técnica de produto',
    desc: 'Cadastra os insumos de um produto e o estoque final é calculado sozinho.',
    preview: () => (
      <MockCard>
        <p className="font-semibold mb-2">Combo Lanche + Suco</p>
        <ul className="space-y-1 text-xs text-uf-silver-dim">
          <li>Pão — 1un</li>
          <li>Carne — 150g</li>
          <li>Suco — 300ml</li>
        </ul>
        <p className="text-xs text-emerald-400 mt-2">Estoque disponível: calculado pelo insumo mais baixo</p>
      </MockCard>
    ),
  },
  {
    key: 'systems.estoque-servico',
    icon: ClipboardList,
    title: 'Estoque baixado pelo serviço',
    desc: 'Concluiu o serviço, a peça usada sai do estoque na hora — sem lançar nada manual.',
    preview: () => (
      <MockCard>
        <p className="font-semibold mb-2">OS #118 concluída</p>
        <div className="flex items-center justify-between text-xs">
          <span>Tela iPhone 13</span>
          <span className="text-uf-silver-dim">4un → 3un</span>
        </div>
      </MockCard>
    ),
  },
  {
    key: 'systems.uber',
    icon: Bike,
    title: 'Uber Direct nativo',
    desc: 'Chama o entregador direto do painel e acompanha a corrida em tempo real, sem app terceiro.',
    preview: () => (
      <MockCard>
        <p className="font-semibold mb-2">Entrega #92 — a caminho</p>
        <div className="h-20 rounded-lg bg-gradient-to-br from-uf-blue/20 to-transparent border border-white/10 flex items-center justify-center text-xs text-uf-silver-dim">
          mapa com localização do entregador em tempo real
        </div>
        <p className="text-xs text-uf-silver-dim mt-2">Chegada estimada: 12 min</p>
      </MockCard>
    ),
  },
  {
    key: 'systems.point',
    icon: CreditCard,
    title: 'Mercado Pago Point',
    desc: 'Cobra na maquininha direto do pedido — sem sair do painel pra outro app.',
    preview: () => (
      <MockCard>
        <p className="font-semibold mb-2">Cobrar R$ 87,90</p>
        <button className="w-full bg-uf-blue/20 border border-uf-blue/40 rounded-lg py-2 text-xs text-center">
          Enviar pra maquininha "Caixa 01"
        </button>
      </MockCard>
    ),
  },
  {
    key: 'systems.cozinha',
    icon: ChefHat,
    title: 'Tela de cozinha',
    desc: 'Pedido cai direto na cozinha, organizado por status — sem grito, sem papel.',
    preview: () => (
      <MockCard>
        <div className="grid grid-cols-3 gap-2 text-[10px] text-center">
          <div><p className="text-uf-silver-dim mb-1">Pendente</p><div className="bg-white/5 rounded p-2">#4822</div></div>
          <div><p className="text-uf-silver-dim mb-1">Montando</p><div className="bg-white/5 rounded p-2">#4820</div></div>
          <div><p className="text-uf-silver-dim mb-1">Pronto</p><div className="bg-emerald-500/10 rounded p-2">#4818</div></div>
        </div>
      </MockCard>
    ),
  },
  {
    key: 'systems.pdv',
    icon: ShoppingBag,
    title: 'PDV com comandas',
    desc: 'Venda de balcão e comanda de mesa no mesmo sistema, sincronizado com o estoque.',
    preview: () => (
      <MockCard>
        <p className="font-semibold mb-2">Comanda — Mesa 4</p>
        <ul className="text-xs text-uf-silver-dim space-y-1 mb-2">
          <li>2x Refrigerante — R$ 12,00</li>
          <li>1x Porção — R$ 38,00</li>
        </ul>
        <div className="flex justify-between border-t border-white/10 pt-2 text-sm font-semibold">
          <span>Total</span><span>R$ 50,00</span>
        </div>
      </MockCard>
    ),
  },
]

/** Ilustrativo -- não é print real da tela, é mockup pra explicar o
 * recurso de forma visual e rápida. */
export default function SystemsShowcase() {
  const [open, setOpen] = useState<Item | null>(null)

  return (
    <section className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="uf-eyebrow mb-4">Como funciona</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            <CmsText contentKey="systems.title">Clique e veja cada recurso na prática</CmsText>
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            <CmsText contentKey="systems.sub">Ilustrativo — clique em qualquer card pra ver como funciona de verdade.</CmsText>
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ITEMS.map((it) => (
            <button
              key={it.key}
              onClick={() => setOpen(it)}
              className="uf-glass uf-glass-hover rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5"
            >
              <div className="w-10 h-10 rounded-xl uf-bg flex items-center justify-center mb-3">
                <it.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-sm mb-1">
                <CmsText contentKey={`${it.key}.title`} fallback={it.title} />
              </h3>
              <p className="text-xs text-uf-silver-dim leading-relaxed">
                <CmsText contentKey={`${it.key}.desc`} fallback={it.desc} />
              </p>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <FeaturePreviewDialog title={open.title} desc={open.desc} onClose={() => setOpen(null)}>
          {open.preview()}
        </FeaturePreviewDialog>
      )}
    </section>
  )
}
