import { motion } from 'framer-motion'
import { ArrowRight, PlayCircle, Sparkles } from 'lucide-react'
import { CmsText } from '../../lib/cms'

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export default function Hero() {
  return (
    <section className="relative pt-40 pb-24 md:pt-52 md:pb-32 px-5 overflow-hidden">
      <div className="uf-mesh">
        <span className="uf-mesh-blob" />
      </div>

      <div className="uf-container text-center">
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0} className="uf-eyebrow mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          Sua loja online no ar em dias, não em meses
        </motion.div>

        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={1}>
          <CmsText
            contentKey="landing.hero.headline"
            as="h1"
            className="text-4xl sm:text-6xl md:text-7xl font-black leading-[1.05] tracking-tight max-w-4xl mx-auto block"
          />
        </motion.div>

        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={2}>
          <CmsText
            contentKey="landing.hero.sub"
            as="p"
            className="mt-6 text-base sm:text-lg text-uf-silver-dim max-w-2xl mx-auto block"
          />
        </motion.div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={3}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a href="#planos" className="btn-primary px-7 py-3.5 text-sm w-full sm:w-auto">
            Assinar agora
            <ArrowRight className="w-4 h-4" />
          </a>
          <a href="#demonstracao" className="btn-secondary px-7 py-3.5 text-sm w-full sm:w-auto">
            <PlayCircle className="w-4 h-4" />
            Ver demonstração
          </a>
        </motion.div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-8 flex items-center justify-center gap-2 text-xs text-uf-silver-dim"
        >
          <span className="flex -space-x-2">
            {['🥐', '🍔', '🌇', '🛍️'].map((e, i) => (
              <span
                key={i}
                className="w-7 h-7 rounded-full uf-glass flex items-center justify-center text-sm"
                style={{ zIndex: 4 - i }}
              >
                {e}
              </span>
            ))}
          </span>
          lojistas já rodando com a Resolutoo
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 60 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="uf-container mt-16 md:mt-20"
      >
        <div className="uf-glass rounded-3xl p-2 sm:p-3 shadow-2xl shadow-black/40">
          <div className="rounded-2xl overflow-hidden bg-uf-surface aspect-[16/9] flex items-center justify-center relative">
            <div className="uf-mesh opacity-60" />
            <div className="relative z-10 text-center px-6">
              <p className="text-uf-silver-dim text-xs uppercase tracking-widest mb-2">Painel administrativo</p>
              <p className="text-lg sm:text-2xl font-bold uf-text">Pedidos, catálogo e financeiro em um só lugar</p>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  )
}
