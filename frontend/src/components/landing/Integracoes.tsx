import { motion } from 'framer-motion'
import { Lock, Soup, Truck, UtensilsCrossed } from 'lucide-react'
import { CmsText } from '../../lib/cms'

const INTEGRACOES = [
  {
    key: 'integracoes.ifood',
    icon: UtensilsCrossed,
    title: 'iFood',
    desc: 'Pedidos feitos no iFood caem direto no mesmo painel de Pedidos da loja, com o mesmo controle de estoque e status que você já usa hoje.',
  },
  {
    key: 'integracoes.ubereats',
    icon: Soup,
    title: 'Uber Eats',
    desc: 'Cardápio e pedidos sincronizados com o Uber Eats sem cadastrar nada duas vezes — vitrine, estoque e pedido em um só lugar.',
  },
  {
    key: 'integracoes.uberdirect',
    icon: Truck,
    title: 'Uber Direct',
    desc: 'Motoboy sob demanda pra quem não tem entregador próprio — pedido finalizado no site já sai direto pra um entregador da Uber.',
  },
]

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

export default function Integracoes() {
  return (
    <section id="integracoes" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">
            <CmsText contentKey="integracoes.eyebrow">Integrações</CmsText>
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            <CmsText contentKey="integracoes.title">Sua loja também nos apps que seu cliente já usa</CmsText>
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            <CmsText contentKey="integracoes.sub">
              Em breve, tudo isso conectado ao mesmo painel — sem duplicar cadastro, sem perder pedido.
            </CmsText>
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {INTEGRACOES.map((f) => (
            <motion.div
              key={f.key}
              variants={item}
              className="uf-glass rounded-2xl p-6 opacity-50 cursor-not-allowed"
            >
              <div className="w-11 h-11 rounded-xl uf-bg flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-lg mb-1.5">
                <CmsText contentKey={`${f.key}.title`} fallback={f.title} />
              </h3>
              <p className="text-sm text-uf-silver-dim leading-relaxed">
                <CmsText contentKey={`${f.key}.desc`} fallback={f.desc} />
              </p>
              <p className="text-[11px] text-uf-silver-dim/70 mt-3 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Em breve
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
