import { useEffect, useMemo, useState } from 'react'
import { Link } from '../../lib/tenantRouter'
import { Loader2, Wrench } from 'lucide-react'
import { serviceService } from '../../services/serviceService'
import type { PublicService } from '../../services/serviceService'
import Shell from '../components/Shell'
import EmptyState from '../components/EmptyState'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

/** Catálogo de serviços — irmão de /catalogo (produtos), mesmo tema burgerbite. */
export default function Uiux3ServicosCatalogo() {
  const [services, setServices] = useState<PublicService[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('all')

  useEffect(() => {
    serviceService.list().then(setServices).finally(() => setLoading(false))
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const s of services) if (s.category_name) set.add(s.category_name)
    return Array.from(set).sort()
  }, [services])

  const filtered = categoryFilter === 'all' ? services : services.filter((s) => s.category_name === categoryFilter)

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-10">
        <h1 className="text-2xl font-black mb-4">Serviços</h1>

        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setCategoryFilter('all')} className={categoryFilter === 'all' ? 'u3-pill-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u3-pill-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
              Todos
            </button>
            {categories.map((c) => (
              <button key={c} onClick={() => setCategoryFilter(c)} className={categoryFilter === c ? 'u3-pill-primary shrink-0 px-4 py-1.5 text-xs font-semibold' : 'u3-pill-secondary shrink-0 px-4 py-1.5 text-xs font-semibold'}>
                {c}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin u3-accent" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wrench} message="Nenhum serviço encontrado." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((s) => {
              const indisponivel = s.available_quantity != null && s.available_quantity <= 0
              return (
                <Link key={s.id} to={`/servico/${s.id}`} className="rounded-2xl overflow-hidden block" style={{ background: 'var(--u3-surface)' }}>
                  <div className="aspect-video flex items-center justify-center">
                    <Wrench className="w-8 h-8 u3-dim" />
                  </div>
                  <div className="p-3">
                    {s.category_name && <p className="text-[10px] font-semibold u3-accent uppercase tracking-wide mb-1">{s.category_name}</p>}
                    <p className="text-sm font-semibold truncate">{s.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      {s.price > 0 ? <span className="u3-accent font-bold text-sm">{currency(s.price)}</span> : <span className="text-xs u3-dim">Sob avaliação</span>}
                      {indisponivel && <span className="text-[10px] font-bold text-red-400">indisponível</span>}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </Shell>
  )
}
