import { motion } from 'framer-motion'
import { CreditCard, Rocket, Settings2, UserPlus } from 'lucide-react'

const STEPS = [
  { icon: UserPlus, title: 'Assine', desc: 'Escolha seu plano e crie sua conta em menos de 2 minutos.' },
  { icon: CreditCard, title: 'Pague', desc: 'Pix ou cartão, cobrança recorrente automática todo mês.' },
  { icon: Settings2, title: 'Configure', desc: 'Nome da loja, categoria, cor, logo e WhatsApp — seu jeito, sua marca.' },
  { icon: Rocket, title: 'Venda', desc: 'Sua loja já entra no ar com catálogo, checkout e Pix funcionando.' },
]

export default function HowItWorks() {
  return (
    <section id="como-funciona" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">Como funciona</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Do zero à primeira venda <span className="uf-text">em minutos</span>
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
          <div className="hidden lg:block absolute top-9 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.12 }}
              className="relative text-center"
            >
              <div className="relative z-10 w-[4.5rem] h-[4.5rem] mx-auto rounded-2xl uf-glass flex items-center justify-center mb-5">
                <s.icon className="w-6 h-6 text-uf-blue" />
                <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full uf-bg text-white text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <h3 className="font-bold mb-1.5">{s.title}</h3>
              <p className="text-sm text-uf-silver-dim leading-relaxed px-2">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
