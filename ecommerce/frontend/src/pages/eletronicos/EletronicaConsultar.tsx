import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Loader2, PackageCheck, Search } from 'lucide-react'
import { useTenantConfig } from '../../hooks/useTenantConfig'
import { resolveTenantSlug, withTenantSearch } from '../../lib/tenantConfig'
import { consultarPorTelefone, STATUS_LABEL, type ConsultarResponse } from '../../lib/eletronicosApi'

export default function EletronicaConsultar() {
  const tenantConfig = useTenantConfig()
  const slug = resolveTenantSlug()

  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ConsultarResponse | null>(null)

  async function handleSearch() {
    if (!slug || phone.replace(/\D/g, '').length < 10 || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await consultarPorTelefone(slug, phone)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'não foi possível consultar agora, tente de novo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-5 py-10">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto mb-3">
            <Search className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold">Acompanhar solicitação</h1>
          <p className="text-slate-400 text-sm mt-1">
            {tenantConfig?.loja_nome ? `${tenantConfig.loja_nome} — ` : ''}informe seu WhatsApp pra ver o status.
          </p>
        </div>

        <div className="flex gap-2 mb-6">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="(83) 9....-...."
            className="flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="rounded-xl bg-emerald-500 disabled:bg-slate-800 text-slate-950 font-semibold px-5 flex items-center justify-center hover:bg-emerald-400 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
          </button>
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {data && data.requests.length === 0 && data.appointments.length === 0 && (
          <p className="text-center text-sm text-slate-500">Nenhuma solicitação em aberto pra esse número.</p>
        )}

        <div className="space-y-4">
          {data?.requests.map((r) => (
            <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-semibold text-sm">{r.phone_model || 'Aparelho'}</p>
                  <p className="text-xs text-slate-500">{r.problem_description}</p>
                </div>
                <PackageCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              </div>
              <div className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-medium px-3 py-1 mb-3">
                {STATUS_LABEL[r.status] || r.status}
              </div>
              {(r.quote_value ?? r.estimated_quote_value) != null && (
                <p className="text-sm text-slate-300">
                  Valor {r.quote_value != null ? '' : 'estimado '}
                  <span className="font-semibold text-white">
                    R$ {(r.quote_value ?? r.estimated_quote_value)!.toFixed(2)}
                  </span>
                </p>
              )}
              {r.service_order?.pdf_url && (
                <a
                  href={r.service_order.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-xs text-emerald-400 hover:underline"
                >
                  Ver ordem de serviço (PDF)
                </a>
              )}
            </div>
          ))}

          {data?.appointments.map((a) => (
            <div key={a.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 flex items-start gap-3">
              <CalendarClock className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">{a.service_label || 'Agendamento'}</p>
                <p className="text-xs text-slate-500">
                  {new Date(a.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
                {a.notes && <p className="text-xs text-slate-500 mt-1">{a.notes}</p>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          <Link to={`/${withTenantSearch()}`} className="text-emerald-400 hover:underline">
            Nova solicitação
          </Link>
        </p>
      </div>
    </main>
  )
}
