import { Link, Navigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  isPoliticaSlug,
  POLITICA_PATHS,
  POLITICAS_BY_SLUG,
  type PoliticaSlug,
} from '../content/politicas'

const NAV: { slug: PoliticaSlug; label: string }[] = [
  { slug: 'compra', label: 'Compra (cliente)' },
  { slug: 'compra-mais-18', label: 'Compra 18+' },
  { slug: 'lojista', label: 'Lojista' },
  { slug: 'plano-essential', label: 'Plano Essential' },
]

export default function PoliticasPrivacidade() {
  const { slug = '' } = useParams<{ slug: string }>()
  if (!isPoliticaSlug(slug)) {
    return <Navigate to={POLITICA_PATHS.compra} replace />
  }

  const doc = POLITICAS_BY_SLUG[slug]

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-12 relative">
      <div className="uf-mesh" />
      <div className="uf-container relative z-10 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Link to="/" className="text-xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-xs text-uf-silver-dim mt-3 uppercase tracking-wide">
            Políticas e consentimentos
          </p>
          <h1 className="text-2xl sm:text-3xl font-black mt-2">{doc.title}</h1>
          <p className="mt-3 text-uf-silver-dim text-sm leading-relaxed">{doc.subtitle}</p>
          <p className="mt-2 text-xs text-uf-silver-dim/80">{doc.updatedLabel}</p>

          <nav className="flex flex-wrap gap-2 mt-6" aria-label="Outras políticas">
            {NAV.map((item) => {
              const active = item.slug === slug
              return (
                <Link
                  key={item.slug}
                  to={POLITICA_PATHS[item.slug]}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    active
                      ? 'border-uf-blue bg-white/5 text-uf-silver'
                      : 'border-white/10 text-uf-silver-dim hover:border-white/25'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="mt-10 space-y-8">
            {doc.sections.map((section) => (
              <section
                key={section.id ?? section.title}
                id={section.id}
                className="uf-glass rounded-2xl p-5 sm:p-6 space-y-3"
              >
                <h2 className="text-lg font-bold text-uf-silver">{section.title}</h2>
                {section.paragraphs.map((p) => (
                  <p key={p.slice(0, 48)} className="text-sm text-uf-silver-dim leading-relaxed">
                    {p}
                  </p>
                ))}
                {section.bullets && section.bullets.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1.5 text-sm text-uf-silver-dim">
                    {section.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <p className="mt-10 text-xs text-uf-silver-dim">
            Dúvidas sobre a plataforma:{' '}
            <a href="mailto:contato@resolutoo.com" className="text-uf-blue hover:underline">
              contato@resolutoo.com
            </a>
            . Questões de conta Mercado Pago da loja: suporte Mercado Pago.
          </p>
        </motion.div>
      </div>
    </main>
  )
}
