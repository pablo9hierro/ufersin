import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Check, Lock, MousePointerClick } from 'lucide-react'
import { CmsText } from '../lib/cms'
import { formatBRL, getPlans, getPlansByVertical, priceForCycle, SEMESTRAL_DISCOUNT } from '../lib/plans'
import type { BillingCycle, PlanoCode, Vertical } from '../lib/api'

export type PlanCardsCta =
  | { kind: 'link'; to: (code: PlanoCode, ciclo: BillingCycle) => string; label?: (name: string) => string }
  | { kind: 'button'; onSelect: (code: PlanoCode, ciclo: BillingCycle) => void; label?: (name: string) => string }

type Props = {
  ciclo: BillingCycle
  cta: PlanCardsCta
  /** Show "Experimentar esse plano" demo links (landing only). */
  showDemo?: boolean
  /** Animate on mount instead of whileInView (logged-in pages). */
  animateOnMount?: boolean
  testId?: string
  /** Mostra só os planos deste ramo. Omitido = todos (compatível com as
   * telas logadas, que já filtram pelo ramo do próprio assinante). */
  vertical?: Vertical
  /** Colunas do grid -- ramo com um plano só não deve esticar em 3 colunas. */
  columns?: 1 | 2 | 3
}

const GRID_COLS: Record<1 | 2 | 3, string> = {
  1: 'md:grid-cols-1 max-w-sm mx-auto',
  2: 'md:grid-cols-2 max-w-3xl mx-auto',
  3: 'md:grid-cols-3',
}

export default function PlanCardsGrid({
  ciclo,
  cta,
  showDemo = false,
  animateOnMount = false,
  testId = 'planos-assinar-cards',
  vertical,
  columns = 3,
}: Props) {
  const plans = vertical ? getPlansByVertical(vertical) : getPlans()
  const ctaLabel = (name: string) =>
    (cta.kind === 'link' ? cta.label?.(name) : cta.label?.(name)) ?? `Assinar ${name}`
  // Menos planos ativos do que colunas pedidas (ex: só Essential ativo
  // numa grade de 3) não pode ficar grudado à esquerda -- usa o layout
  // (com mx-auto) do número real de cards, nunca mais do que foi pedido.
  const effectiveColumns = Math.max(1, Math.min(columns, plans.length || 1)) as 1 | 2 | 3

  return (
    <div className={`grid ${GRID_COLS[effectiveColumns]} gap-5`} data-testid={testId}>
      {plans.map((plan, i) => {
        const charged = priceForCycle(plan.price, ciclo)
        return (
          <motion.div
            key={plan.code}
            initial={{ opacity: 0, y: 30 }}
            {...(animateOnMount
              ? { animate: { opacity: 1, y: 0 } }
              : { whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' } })}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className={`relative rounded-3xl p-7 flex flex-col ${
              plan.highlight
                ? 'uf-bg shadow-2xl shadow-[color:var(--color-uf-purple)]/20 md:-translate-y-3'
                : 'uf-glass uf-glass-hover'
            }`}
          >
            {plan.highlight && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-uf-black text-[11px] font-bold px-3 py-1 rounded-full">
                MAIS ESCOLHIDO
              </span>
            )}
            {ciclo === 'semestral' && (
              <span
                className={`absolute top-4 right-4 text-[10px] font-bold px-2 py-1 rounded-md ${
                  plan.highlight ? 'bg-white/20 text-white' : 'bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {Math.round(SEMESTRAL_DISCOUNT * 100)}% OFF
              </span>
            )}
            <h3 className={`font-black text-xl ${plan.highlight ? 'text-white' : ''}`}>{plan.name}</h3>
            <p className={`text-sm mt-1 ${plan.highlight ? 'text-white/80' : 'text-uf-silver-dim'}`}>{plan.tagline}</p>

            <div className="mt-6 mb-2">
              {plan.normalPrice != null && (
                <p className={`text-sm line-through ${plan.highlight ? 'text-white/50' : 'text-uf-silver-dim/60'}`}>
                  de R$ {formatBRL(ciclo === 'mensal' ? plan.normalPrice : priceForCycle(plan.normalPrice, ciclo))}
                </p>
              )}
              {ciclo === 'mensal' ? (
                <>
                  <span className={`text-4xl font-black ${plan.highlight ? 'text-white' : ''}`}>
                    R$ {formatBRL(plan.price)}
                  </span>
                  <span className={`text-sm ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>/mês</span>
                  {plan.normalPrice != null && (
                    <span className="ml-2 text-[11px] font-bold px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 align-middle">
                      <CmsText contentKey="plans.launch_badge">INAUGURAÇÃO</CmsText>
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className={`text-4xl font-black ${plan.highlight ? 'text-white' : ''}`}>
                    R$ {formatBRL(charged)}
                  </span>
                  <span className={`text-sm ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>
                    /semestre
                  </span>
                  <p className={`text-xs mt-1 ${plan.highlight ? 'text-white/70' : 'text-uf-silver-dim'}`}>
                    equiv. R$ {formatBRL(charged / 6)}/mês · de R$ {formatBRL(plan.price * 6)}
                  </p>
                </>
              )}
            </div>

            {plan.normalPrice != null && (
              <p
                className={`flex items-center gap-1.5 text-[11px] font-medium mb-4 ${
                  plan.highlight ? 'text-white/80' : 'text-uf-silver-dim'
                }`}
              >
                <Lock className="w-3 h-3 shrink-0" />
                <CmsText contentKey="plans.launch_lockin_note">
                  Assine agora e o valor fica vitalício — nunca sobe, mesmo se o preço de inauguração mudar depois.
                </CmsText>
              </p>
            )}

            <ul className="mt-6 space-y-3 flex-1">
              {plan.features.map((f) => (
                <li
                  key={f}
                  className={`flex items-center gap-2.5 text-sm ${plan.highlight ? 'text-white/95' : 'text-uf-silver'}`}
                >
                  <Check className={`w-4 h-4 shrink-0 ${plan.highlight ? 'text-white' : 'text-uf-blue'}`} />
                  {f}
                </li>
              ))}
            </ul>

            {cta.kind === 'link' ? (
              <Link
                to={cta.to(plan.code, ciclo)}
                className={`mt-8 w-full py-3 text-sm text-center ${
                  plan.highlight
                    ? 'btn-secondary !bg-white !text-uf-black hover:!bg-white/90'
                    : 'btn-primary'
                }`}
                data-testid={`plan-cta-${plan.code}`}
              >
                {ctaLabel(plan.name)}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => cta.onSelect(plan.code, ciclo)}
                className={`mt-8 w-full py-3 text-sm ${
                  plan.highlight
                    ? 'btn-secondary !bg-white !text-uf-black hover:!bg-white/90'
                    : 'btn-primary'
                }`}
                data-testid={`plan-cta-${plan.code}`}
              >
                {ctaLabel(plan.name)}
              </button>
            )}

            {showDemo && (
              <a
                href={`/demo/${plan.code}`}
                target="_blank"
                rel="noreferrer"
                className={`mt-2 w-full py-2.5 text-xs flex items-center justify-center gap-1.5 ${
                  plan.highlight ? 'text-white/80 hover:text-white' : 'text-uf-silver-dim hover:text-uf-silver'
                }`}
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                Experimentar esse plano
              </a>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

export function BillingCycleToggle({
  ciclo,
  onChange,
}: {
  ciclo: BillingCycle
  onChange: (c: BillingCycle) => void
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 p-1 bg-white/5">
      <button
        type="button"
        onClick={() => onChange('mensal')}
        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
          ciclo === 'mensal' ? 'bg-white text-uf-black font-semibold' : 'text-uf-silver-dim hover:text-uf-silver'
        }`}
      >
        Mensal
      </button>
      <button
        type="button"
        onClick={() => onChange('semestral')}
        className={`px-4 py-2 text-sm rounded-lg transition-colors ${
          ciclo === 'semestral' ? 'bg-white text-uf-black font-semibold' : 'text-uf-silver-dim hover:text-uf-silver'
        }`}
      >
        Semestral
        <span className="ml-1.5 text-[11px] font-bold text-emerald-600">
          −{Math.round(SEMESTRAL_DISCOUNT * 100)}%
        </span>
      </button>
    </div>
  )
}
