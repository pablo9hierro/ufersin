import { motion } from 'framer-motion'
import { Bike, Check, FileText, MessageCircle, Store, X } from 'lucide-react'
import { CmsText } from '../../lib/cms'

const SYSTEMS = [
  {
    icon: Store,
    name: 'Plataforma de loja virtual',
    example: 'Nuvemshop, Tray, Loja Integrada',
    price: 'R$ 119 – 449/mês',
  },
  {
    icon: FileText,
    name: 'Emissão de nota fiscal (NF-e/NFC-e)',
    example: 'Bling, Tiny, Omie',
    price: 'R$ 89 – 199/mês',
  },
  {
    icon: MessageCircle,
    name: 'Atendimento com IA no WhatsApp',
    example: 'Plataformas de chatbot com IA real',
    price: 'R$ 300 – 800/mês',
  },
  {
    icon: Store,
    name: 'PDV + controle de estoque',
    example: 'Sistemas de PDV avulsos',
    price: 'R$ 99 – 150/mês',
  },
  {
    icon: Bike,
    name: 'Gestão de entrega terceirizada (Uber Direct)',
    example: 'Não existe de prateleira — geralmente vira projeto sob encomenda',
    price: 'R$ 100 – 300/mês',
  },
]

export default function FiveInOne() {
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
          <span className="uf-eyebrow mb-4">O mote</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            <CmsText contentKey="fiveinone.title">5 sistemas em 1 — não 5 assinaturas</CmsText>
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-2xl mx-auto">
            <CmsText contentKey="fiveinone.sub">
              Loja virtual, nota fiscal, atendimento com IA, PDV/estoque e entrega terceirizada nativa (Uber Direct)
              — hoje isso é sempre 5 sistemas diferentes, 5 painéis que não conversam entre si, e você quem fica no
              meio repassando status de um pro outro na mão. Na Resolutoo é um painel só, tudo nativo.
            </CmsText>
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Mercado fragmentado */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
            className="uf-glass rounded-2xl p-6"
          >
            <p className="text-xs font-bold text-uf-silver-dim uppercase tracking-wide mb-4">Sem a Resolutoo</p>
            <div className="space-y-3">
              {SYSTEMS.map((s) => (
                <div key={s.name} className="flex items-start gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                  <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                    <s.icon className="w-4 h-4 text-uf-silver-dim" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-xs text-uf-silver-dim">{s.example}</p>
                  </div>
                  <p className="text-sm font-mono text-uf-silver-dim flex-shrink-0">{s.price}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
              <p className="font-bold flex items-center gap-1.5"><X className="w-4 h-4 text-red-400" /> Total (5 painéis separados)</p>
              <p className="font-mono font-bold text-red-400">R$ 707 – 1.898/mês</p>
            </div>
          </motion.div>

          {/* Resolutoo */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="uf-glass rounded-2xl p-6 border border-uf-blue/30"
          >
            <p className="text-xs font-bold text-uf-blue uppercase tracking-wide mb-4">Com a Resolutoo</p>
            <div className="space-y-3">
              {['Loja virtual completa', 'Nota fiscal automática', 'Assistente IA no WhatsApp', 'PDV, comandas e estoque', 'Uber Direct com rastreio ao vivo'].map((s) => (
                <div key={s} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-sm font-semibold">{s}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
              <p className="font-bold">1 painel só, tudo integrado</p>
              <p className="font-mono font-bold text-emerald-400">a partir de R$ 149/mês</p>
            </div>
            <p className="text-xs text-uf-silver-dim mt-3">
              <CmsText contentKey="fiveinone.commission">
                Sem taxa de comissão da Resolutoo — você paga só a mensalidade. A única taxa por fora é a do Mercado
                Pago (Pix/cartão), que é do Mercado Pago, não nossa.
              </CmsText>
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
