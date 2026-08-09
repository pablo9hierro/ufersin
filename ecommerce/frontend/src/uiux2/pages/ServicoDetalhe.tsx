import { useNavigate, useParams } from '../../lib/tenantRouter'
import { ArrowLeft, Loader2, Wrench } from 'lucide-react'
import { useService } from '../../hooks/useServices'
import Shell from '../components/Shell'
import EmptyState from '../components/EmptyState'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

export default function Uiux2ServicoDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: service, loading } = useService(id)

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
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
      <div className="px-4 sm:px-8 pt-5 pb-16 max-w-2xl mx-auto">
        <button onClick={() => navigate(-1)} className="u2-dim flex items-center gap-1.5 text-sm font-semibold mb-4" aria-label="Voltar">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div className="u2-card aspect-square sm:aspect-video flex items-center justify-center overflow-hidden mb-5">
          <Wrench className="w-16 h-16 u2-dim" />
        </div>

        {service.category_name && <p className="text-xs font-semibold u2-oncanvas-accent uppercase tracking-wide mb-1">{service.category_name}</p>}
        <h1 className="u2-oncanvas text-2xl font-black">{service.name}</h1>
        {service.price > 0 ? (
          <p className="u2-oncanvas-accent text-2xl font-bold mt-2">{currency(service.price)}</p>
        ) : (
          <p className="u2-oncanvas-dim text-sm mt-2">Preço sob avaliação</p>
        )}
        {service.description && <p className="u2-oncanvas-dim mt-4 leading-relaxed text-sm">{service.description}</p>}
        {indisponivel && <p className="text-xs text-red-400 mt-2">Sem peça disponível pra esse serviço no momento.</p>}

        <p className="u2-oncanvas-dim text-sm mt-7">
          Pra contratar esse serviço, fale com a gente pelo WhatsApp da loja — é por lá que o atendimento e a cobrança acontecem.
        </p>
      </div>
    </Shell>
  )
}
