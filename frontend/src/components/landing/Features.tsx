import { motion } from 'framer-motion'
import { BadgePercent, LayoutGrid, MessageCircle, QrCode, ShoppingCart, Users2 } from 'lucide-react'

const FEATURES = [
  {
    icon: LayoutGrid,
    title: 'Catálogo completo',
    desc: 'Produtos, categorias, fotos e estoque — tudo gerenciado direto do painel, sem depender de ninguém.',
  },
  {
    icon: ShoppingCart,
    title: 'Checkout pronto',
    desc: 'Carrinho, frete e finalização de pedido já configurados — seu cliente compra sem fricção.',
  },
  {
    icon: QrCode,
    title: 'Pix integrado',
    desc: 'Cobrança via Pix direto no checkout, com confirmação automática de pagamento.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp automático',
    desc: 'Notificações de pedido, status de entrega e recuperação de senha — tudo pelo WhatsApp da sua loja.',
  },
  {
    icon: Users2,
    title: 'Equipe e motoboys',
    desc: 'Funcionários com acesso próprio e gestão de entregas com motoboys — disponível no plano Management.',
  },
  {
    icon: BadgePercent,
    title: 'CRM e campanhas',
    desc: 'Segmentação de clientes, cupons e campanhas promocionais — disponível no plano Premium.',
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

export default function Features() {
  return (
    <section id="recursos" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">Recursos</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Tudo que sua loja precisa, <span className="uf-text">em um só lugar</span>
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            Nada de juntar cinco ferramentas diferentes. A Rodoletas já vem com o que uma loja online
            de verdade precisa pra vender.
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {FEATURES.map((f) => (
            <motion.div key={f.title} variants={item} className="uf-glass uf-glass-hover rounded-2xl p-6">
              <div className="w-11 h-11 rounded-xl uf-bg flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-lg mb-1.5">{f.title}</h3>
              <p className="text-sm text-uf-silver-dim leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
