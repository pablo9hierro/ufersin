import { useEffect, useState } from 'react'
import { Link } from '../lib/tenantRouter'
import { Loader2, Wrench } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import { serviceService } from '../services/serviceService'

type PublicService = {
  id: string
  name: string
  description: string
  category_name: string | null
  price: number
  available_quantity: number | null
}

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

/** Catálogo público de serviços (reparo/manutenção) — irmão de /catalogo (produtos). */
export default function ServicosCatalogo() {
  const [services, setServices] = useState<PublicService[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    serviceService
      .list()
      .then(setServices)
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen text-white">
      <SiteHeader />
      <div className="max-w-5xl mx-auto px-5 sm:px-10 pb-20 pt-6">
        <h1 className="text-2xl sm:text-3xl font-black mb-6">Serviços</h1>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
          </div>
        ) : services.length === 0 ? (
          <div className="text-center py-20 text-son-silver-dim">
            <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum serviço cadastrado ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => {
              const indisponivel = s.available_quantity != null && s.available_quantity <= 0
              return (
                <Link
                  key={s.id}
                  to={`/servico/${s.id}`}
                  className="bg-son-surface border border-white/5 rounded-2xl p-4 hover:border-son-pink/30 transition-colors block"
                >
                  <div className="aspect-video bg-son-surface-light rounded-xl flex items-center justify-center mb-3">
                    <Wrench className="w-8 h-8 text-son-silver-dim/30" />
                  </div>
                  {s.category_name && <p className="text-[10px] font-semibold text-son-gold uppercase tracking-wide mb-1">{s.category_name}</p>}
                  <p className="font-semibold text-white">{s.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    {s.price > 0 ? <span className="sunset-text font-bold">{currency(s.price)}</span> : <span className="text-xs text-son-silver-dim">Sob avaliação</span>}
                    {indisponivel && <span className="text-[10px] font-bold text-red-400">indisponível</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
