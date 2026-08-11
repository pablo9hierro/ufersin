import { motion } from 'framer-motion'
import { MousePointerClick } from 'lucide-react'

export default function Demo() {
  return (
    <section id="demonstracao" className="uf-section">
      <div className="uf-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="uf-eyebrow mb-4">Demonstração</span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mt-4">
            Veja a <span className="uf-text">Resolutoo</span> por dentro
          </h2>
          <p className="mt-4 text-uf-silver-dim max-w-xl mx-auto">
            Quer mexer de verdade? Testa o painel mockado e vê o que cada plano libera.
          </p>
          <a href="/demo" className="btn-primary px-6 py-3 text-sm mt-6 inline-flex">
            <MousePointerClick className="w-4 h-4" />
            Testar demo
          </a>
        </motion.div>
      </div>
    </section>
  )
}
