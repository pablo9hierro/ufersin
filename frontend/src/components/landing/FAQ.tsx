import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

const QUESTIONS = [
  {
    q: 'Preciso saber programar ou ter equipe de tecnologia?',
    a: 'Não. A Resolutoo já entrega sua loja pronta — catálogo, checkout, Pix e WhatsApp configurados. Você só cuida do seu negócio.',
  },
  {
    q: 'Posso trocar de plano depois?',
    a: 'Sim, upgrade e downgrade são feitos direto pelo seu painel, a qualquer momento, sem multa ou taxa de troca.',
  },
  {
    q: 'Como funciona o pagamento da assinatura?',
    a: 'Você escolhe Pix ou cartão de crédito no checkout. A cobrança é recorrente mensal, processada com segurança pelo gateway de pagamento.',
  },
  {
    q: 'Minha loja fica no meu próprio domínio?',
    a: 'Sua loja recebe um subdomínio Resolutoo automaticamente (ex: sualoja.resolutoo.com). Domínio próprio é um recurso que estamos preparando.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, sem fidelidade. O cancelamento é feito direto pelo painel do assinante.',
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faq" className="uf-section">
      <div className="uf-container max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="uf-eyebrow mb-4">Perguntas frequentes</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Tirando <span className="uf-text">suas dúvidas</span>
          </h2>
        </motion.div>

        <div className="space-y-3">
          {QUESTIONS.map((item, i) => (
            <motion.div
              key={item.q}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="uf-glass rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 text-left px-6 py-5"
              >
                <span className="font-semibold text-sm sm:text-base">{item.q}</span>
                <ChevronDown className={`w-4 h-4 shrink-0 text-uf-silver-dim transition-transform ${open === i ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <p className="px-6 pb-5 text-sm text-uf-silver-dim leading-relaxed">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
