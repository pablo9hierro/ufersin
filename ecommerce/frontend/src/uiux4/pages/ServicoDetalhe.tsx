import { useNavigate, useParams } from '../../lib/tenantRouter'
import { ArrowLeft, Loader2, Wrench } from 'lucide-react'
import { useService } from '../../hooks/useServices'
import Shell from '../components/Shell'
import EmptyState from '../components/EmptyState'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function Uiux4ServicoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: service, loading } = useService(id)

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin u4-accent" />
        </div>
      </Shell>
    )
  }

  if (!service) {
    return (
      <Shell>
        <div className="px-4 sm:px-8 pt-6">
          <EmptyState icon={Wrench} message="Serviço não encontrado." actionLabel="Voltar aos serviços" actionHref="/servicos" />
        </div>
      </Shell>
    )
  }

  const indisponivel = service.available_quantity != null && service.available_quantity <= 0

  return (
    <Shell>
      <div className="max-w-2xl mx-auto pb-16">
        <div className="relative px-4 sm:px-8 pt-4">
          <div className="aspect-square flex items-center justify-center overflow-hidden rounded-2xl" style={{ background: 'var(--u4-surface)' }}>
            <Wrench className="w-16 h-16 u4-dim" />
          </div>
          <button onClick={() => navigate(-1)} className="u4-arrow-btn absolute top-8 left-8" style={{ background: 'rgba(0,0,0,0.5)' }} aria-label="Voltar">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-8 pt-5">
          {service.category_name && <p className="text-xs font-bold u4-dim uppercase tracking-widest mb-1.5">{service.category_name}</p>}
          <h1 className="u4-display text-3xl mb-2">{service.name}</h1>
          {service.price > 0 ? (
            <span className="u4-tag inline-block px-3 py-1 text-sm">{currency(service.price)}</span>
          ) : (
            <p className="u4-dim text-sm">Preço sob avaliação</p>
          )}
          {service.description && <p className="u4-dim mt-4 leading-relaxed text-sm">{service.description}</p>}
          {indisponivel && <p className="text-xs text-red-400 mt-2">Sem peça disponível pra esse serviço no momento.</p>}

          <p className="u4-dim text-sm mt-7">
            Pra contratar esse serviço, fale com a gente pelo WhatsApp da loja — é por lá que o atendimento e a cobrança acontecem.
          </p>
        </div>
      </div>
    </Shell>
  )
}
