import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { MessageCircle, ShoppingBag, Smartphone } from 'lucide-react'
import { CmsText } from '../../lib/cms'

const ASSISTANTS = [
  {
    kind: 'ecommerce',
    icon: ShoppingBag,
    title: 'Assistente de IA — Ecommerce',
    desc: 'Responde seu cliente no WhatsApp, sugere produtos do catálogo e consulta status de pedido, tudo sozinha.',
    bullets: ['Busca produtos por nome ou categoria', 'Consulta status de pedido em tempo real', 'Atende 24h, sem fila de espera'],
  },
  {
    kind: 'eletronicos',
    icon: Smartphone,
    title: 'Assistente de IA — Eletrônicos',
    desc: 'Feita pra assistência técnica: orça reparo, explica prazo e acompanha a ordem de serviço do cliente.',
    bullets: ['Consulta preço e prazo de reparo', 'Acompanha status da ordem de serviço', 'Guia o cliente do diagnóstico à entrega'],
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

export default function Assistants() {
  return (
    <section id="assistentes-ia" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">
            <MessageCircle className="w-3.5 h-3.5" />
            Assistentes de IA
          </span>
          <CmsText
            contentKey="landing.assistants.title"
            as="h2"
            className="text-3xl sm:text-4xl md:text-5xl font-black mt-4 block"
          />
          <CmsText
            contentKey="landing.assistants.sub"
            as="p"
            className="mt-4 text-uf-silver-dim max-w-xl mx-auto block"
          />
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto"
        >
          {ASSISTANTS.map((a) => (
            <motion.div key={a.kind} variants={item} className="uf-glass uf-glass-hover rounded-2xl p-6 flex flex-col">
              <div className="w-11 h-11 rounded-xl uf-bg flex items-center justify-center mb-4">
                <a.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-lg mb-1.5">{a.title}</h3>
              <p className="text-sm text-uf-silver-dim leading-relaxed mb-4">{a.desc}</p>
              <ul className="text-sm text-uf-silver-dim space-y-1.5 mb-6 flex-1">
                {a.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-uf-silver-dim shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
              <Link to={`/demo/assistente/${a.kind}`} className="btn-primary px-5 py-2.5 text-sm justify-center">
                Ver demonstração
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
