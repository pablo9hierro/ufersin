import { Link, useParams } from '../lib/tenantRouter'
import { Loader2, Wrench } from 'lucide-react'
import { motion } from 'framer-motion'
import SiteHeader from '../components/layout/SiteHeader'
import { useService } from '../hooks/useServices'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

/** Detalhe público de um serviço — link que o Assistente IA manda na prévia do carrinho. */
export default function ServicoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const { data: service, loading } = useService(id)

  if (loading) {
    return (
      <main className="min-h-screen text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
      </main>
    )
  }

  if (!service) {
    return (
      <main className="min-h-screen text-white">
        <SiteHeader />
        <div className="text-center py-24 text-son-silver-dim">
          <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Serviço não encontrado.</p>
          <Link to="/" className="btn-secondary mt-6 inline-flex">
            Voltar pra loja
          </Link>
        </div>
      </main>
    )
  }

  const indisponivel = service.available_quantity != null && service.available_quantity <= 0

  return (
    <main className="min-h-screen text-white">
      <SiteHeader />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-3xl mx-auto px-5 sm:px-10 pb-20"
      >
        <div className="aspect-square sm:aspect-video bg-son-surface border border-white/5 rounded-2xl flex items-center justify-center overflow-hidden mb-6">
          <Wrench className="w-16 h-16 text-son-silver-dim/30" />
        </div>

        {service.category_name && (
          <p className="text-xs font-semibold text-son-gold uppercase tracking-wide mb-1">{service.category_name}</p>
        )}
        <h1 className="text-2xl sm:text-3xl font-black">{service.name}</h1>
        {service.price > 0 && <p className="sunset-text text-2xl font-bold mt-2">{currency(service.price)}</p>}
        {service.description && <p className="text-son-silver mt-4 leading-relaxed">{service.description}</p>}

        {indisponivel && (
          <p className="text-sm text-son-silver-dim mt-4">Sem peça disponível pra esse serviço no momento.</p>
        )}

        <div className="mt-8">
          <p className="text-sm text-son-silver-dim">
            Pra contratar esse serviço, fale com a gente pelo WhatsApp da loja — é por lá que o atendimento e a cobrança acontecem.
          </p>
        </div>
      </motion.div>
    </main>
  )
}
