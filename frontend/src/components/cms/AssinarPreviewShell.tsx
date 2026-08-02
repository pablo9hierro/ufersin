import { useEffect, useState } from 'react'
import { CreditCard, Loader2, QrCode, Tag } from 'lucide-react'
import { CmsText } from '../../lib/cms'
import { fetchPlans, formatBRL, getPlans, priceForCycle, SEMESTRAL_DISCOUNT } from '../../lib/plans'
import type { BillingCycle } from '../../lib/api'

/** Checkout shell for Visual CMS — same copy/prices as /assinar, no auth/charge. */
export default function AssinarPreviewShell() {
  const [ready, setReady] = useState(false)
  const [ciclo, setCiclo] = useState<BillingCycle>('mensal')

  useEffect(() => {
    fetchPlans().finally(() => setReady(true))
  }, [])

  const plans = getPlans()
  const plan = plans.find((p) => p.highlight) ?? plans[0]
  const monthly = plan?.price ?? 0
  const charged = priceForCycle(monthly, ciclo)

  return (
    <main className="min-h-full bg-uf-black text-uf-silver flex items-start justify-center px-5 py-12 relative">
      <div className="uf-mesh" />
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <p className="text-2xl font-black uf-text">Resolutoo</p>
          <CmsText contentKey="assinar.title" as="p" className="text-uf-silver-dim text-sm mt-2 block" />
          <CmsText contentKey="assinar.sub" as="p" className="text-[11px] text-uf-silver-dim/80 mt-1 block" />
        </div>

        {!ready || !plan ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
          </div>
        ) : (
          <>
            <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
              <p className="text-xs text-uf-silver-dim mb-1">Plano {plan.name}</p>
              {ciclo === 'mensal' ? (
                <p className="text-3xl font-black uf-text">R$ {formatBRL(monthly)}/mês</p>
              ) : (
                <>
                  <p className="text-3xl font-black uf-text">R$ {formatBRL(charged)}/semestre</p>
                  <p className="text-xs text-emerald-400 mt-1">
                    {Math.round(SEMESTRAL_DISCOUNT * 100)}% de desconto · equiv. R$ {formatBRL(charged / 6)}/mês
                  </p>
                </>
              )}
            </div>

            <div className="uf-glass rounded-2xl p-6 space-y-4">
              <div>
                <label className="label flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Cupom (opcional)
                </label>
                <input className="input-field uppercase" placeholder="CODIGO" readOnly />
              </div>
              <div>
                <label className="label">Ciclo de cobrança</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCiclo('mensal')}
                    className={`rounded-xl py-3 text-sm border transition-colors ${ciclo === 'mensal' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'}`}
                  >
                    Mensal
                  </button>
                  <button
                    type="button"
                    onClick={() => setCiclo('semestral')}
                    className={`rounded-xl py-3 text-sm border transition-colors ${ciclo === 'semestral' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'}`}
                  >
                    Semestral
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Forma de pagamento</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm border border-uf-blue bg-white/5">
                    <CreditCard className="w-4 h-4" /> Cartão
                  </div>
                  <div className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm border border-white/10 text-uf-silver-dim">
                    <QrCode className="w-4 h-4" /> Pix
                  </div>
                </div>
              </div>
              <button type="button" className="btn-primary w-full py-3.5 opacity-80 cursor-default">
                Assinar e configurar pagamento
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
