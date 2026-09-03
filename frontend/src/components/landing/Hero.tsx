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
          <CmsText contentKey="landing.hero.badge">Sua loja online no ar em dias, não em meses</CmsText>
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
      </div>
    </section>
  )
}
