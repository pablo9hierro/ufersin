import { useState } from 'react'
import type { FinanceiroTimeseriesPoint } from '../../lib/types'

function formatDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// Gráfico leve em SVG (sem dependência externa): barras = quantidade
// vendida por dia, linhas sobrepostas (percentual da mesma escala) pra
// uso de cupom/promoção por dia — liga/desliga cada série com checkbox.
export default function UsageChart({ points }: { points: FinanceiroTimeseriesPoint[] }) {
  const [showCoupon, setShowCoupon] = useState(true)
  const [showPromotion, setShowPromotion] = useState(true)

  if (points.length === 0) return null

  const maxQty = Math.max(1, ...points.map((p) => p.quantity_sold))
  const maxUsage = Math.max(1, ...points.map((p) => Math.max(p.coupon_orders, p.promotion_orders)))

  const n = points.length
  const x = (i: number) => ((i + 0.5) / n) * 100
  const couponLine = points.map((p, i) => `${x(i)},${100 - (p.coupon_orders / maxUsage) * 100}`).join(' ')
  const promotionLine = points.map((p, i) => `${x(i)},${100 - (p.promotion_orders / maxUsage) * 100}`).join(' ')

  const labelEvery = Math.ceil(n / 8)

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="label">Quantidade vendida x uso de cupom/promoção (últimos {n} dias)</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-son-silver cursor-pointer">
            <input type="checkbox" className="w-3.5 h-3.5 accent-orange-400" checked={showCoupon} onChange={(e) => setShowCoupon(e.target.checked)} />
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" /> Cupom
          </label>
          <label className="flex items-center gap-1.5 text-xs text-son-silver cursor-pointer">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-fuchsia-400"
              checked={showPromotion}
              onChange={(e) => setShowPromotion(e.target.checked)}
            />
            <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-400 inline-block" /> Promoção
          </label>
        </div>
      </div>

      <div className="relative h-48 flex items-end gap-[2px] bg-son-surface-light/40 rounded-xl px-2 pt-3">
        {points.map((p) => (
          <div key={p.date} className="flex-1 h-full flex items-end" title={`${formatDay(p.date)} — ${p.quantity_sold} vendido(s)`}>
            <div
              className="w-full bg-son-pink/50 rounded-t-sm min-h-[1px]"
              style={{ height: `${(p.quantity_sold / maxQty) * 100}%` }}
            />
          </div>
        ))}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {showCoupon && (
            <polyline points={couponLine} fill="none" stroke="#fb923c" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          )}
          {showPromotion && (
            <polyline points={promotionLine} fill="none" stroke="#e879f9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      <div className="flex justify-between mt-1.5 px-2">
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <span key={p.date} className="text-[10px] text-son-silver-dim">
              {formatDay(p.date)}
            </span>
          ) : null
        )}
      </div>
      <p className="text-xs text-son-silver-dim mt-2">
        Barras rosa: quantidade de itens vendidos por dia. Linhas: quantidade de pedidos com cupom (laranja) e com promoção (rosa-roxo) no mesmo dia.
      </p>
    </div>
  )
}
