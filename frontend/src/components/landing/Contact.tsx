import { motion } from 'framer-motion'
import { Mail, MessageCircle } from 'lucide-react'
import { CONTENT_DEFAULTS, useCms } from '../../lib/cms'

export default function Contact() {
  const cms = useCms()
  const WHATSAPP = cms?.get('contato.whatsapp') || CONTENT_DEFAULTS['contato.whatsapp']
  const EMAIL = cms?.get('contato.email') || CONTENT_DEFAULTS['contato.email']

  return (
    <section id="contato" className="uf-section">
      <div className="uf-container max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="uf-glass rounded-3xl p-8 sm:p-12 text-center relative overflow-hidden"
        >
          <div className="uf-mesh opacity-40" />
          <div className="relative z-10">
            <h2 className="text-2xl sm:text-3xl font-black mb-3">
              Ficou com <span className="uf-text">alguma dúvida</span>?
            </h2>
            <p className="text-uf-silver-dim mb-8 max-w-md mx-auto text-sm">
              Fala com a gente — respondemos rápido pelo WhatsApp ou e-mail.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={`https://api.whatsapp.com/send/?phone=${WHATSAPP}&text=Oi! Tenho uma dúvida sobre a Resolutoo.`}
                target="_blank"
                rel="noreferrer"
                className="btn-primary px-6 py-3 text-sm w-full sm:w-auto"
              >
                <MessageCircle className="w-4 h-4" />
                Falar no WhatsApp
              </a>
              <a href={`mailto:${EMAIL}`} className="btn-secondary px-6 py-3 text-sm w-full sm:w-auto">
                <Mail className="w-4 h-4" />
                {EMAIL}
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
