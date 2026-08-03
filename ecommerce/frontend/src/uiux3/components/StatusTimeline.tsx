import { Check } from 'lucide-react'
import type { DeliveryType, OrderStatus } from '../../types'

const DELIVERY_STEPS: { key: OrderStatus[]; label: string }[] = [
  { key: ['pendente'], label: 'Pedido feito' },
  { key: ['montando_pedido'], label: 'Preparando' },
  { key: ['pedido_pronto', 'aguardando_localizacao'], label: 'Pronto' },
  { key: ['em_rota_de_entrega', 'entregas'], label: 'Saiu para entrega' },
  { key: ['entregue', 'concluido'], label: 'Entregue' },
]
const PICKUP_STEPS: { key: OrderStatus[]; label: string }[] = [
  { key: ['pendente'], label: 'Pedido feito' },
  { key: ['montando_pedido'], label: 'Preparando' },
  { key: ['pedido_pronto', 'retiradas'], label: 'Pronto para retirada' },
  { key: ['concluido', 'entregue'], label: 'Retirado' },
]

export default function StatusTimeline({ status, deliveryType }: { status: OrderStatus; deliveryType: DeliveryType }) {
  const steps = deliveryType === 'retirada' ? PICKUP_STEPS : DELIVERY_STEPS
  const currentIndex = Math.max(0, steps.findIndex((s) => s.key.includes(status)))

  return (
    <ol className="flex items-start mt-3">
      {steps.map((step, i) => {
        const done = i <= currentIndex
        return (
          <li key={step.label} className="flex-1 flex flex-col items-center text-center relative">
            {i > 0 && <span className="absolute top-3 right-1/2 w-full h-0.5" style={{ background: i <= currentIndex ? 'var(--u3-red)' : 'var(--u3-surface-light)' }} />}
            <span
              className="relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
              style={{ background: done ? 'linear-gradient(135deg, var(--u3-red), var(--u3-orange))' : 'var(--u3-surface-light)' }}
            >
              {done && i < currentIndex ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className={`text-[10px] mt-1.5 leading-tight ${done ? 'font-semibold' : 'u3-dim'}`}>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
