import { useNavigate, useParams } from '../../lib/tenantRouter'
import { ArrowLeft, Loader2, Wrench } from 'lucide-react'
import { useService } from '../../hooks/useServices'
import Shell from '../components/Shell'
import EmptyState from '../components/EmptyState'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function Uiux3ServicoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: service, loading } = useService(id)

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin u3-accent" />
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
        <div className="relative">
          <div className="aspect-square sm:aspect-video flex items-center justify-center overflow-hidden rounded-b-[32px]" style={{ background: 'var(--u3-surface)' }}>
            <Wrench className="w-16 h-16 u3-dim" />
          </div>
          <button onClick={() => navigate(-1)} className="u3-icon-btn absolute top-4 left-4" aria-label="Voltar">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-8 pt-5">
          {service.category_name && <p className="text-xs font-semibold u3-accent uppercase tracking-wide mb-1">{service.category_name}</p>}
          <h1 className="text-2xl font-black">{service.name}</h1>
          {service.price > 0 ? (
            <p className="u3-accent text-2xl font-black mt-2">{currency(service.price)}</p>
          ) : (
            <p className="u3-dim text-sm mt-2">Preço sob avaliação</p>
          )}
          {service.description && <p className="u3-dim mt-4 leading-relaxed text-sm">{service.description}</p>}
          {indisponivel && <p className="text-xs text-red-400 mt-2">Sem peça disponível pra esse serviço no momento.</p>}

          <p className="u3-dim text-sm mt-7">
            Pra contratar esse serviço, fale com a gente pelo WhatsApp da loja — é por lá que o atendimento e a cobrança acontecem.
          </p>
        </div>
      </div>
    </Shell>
  )
}
