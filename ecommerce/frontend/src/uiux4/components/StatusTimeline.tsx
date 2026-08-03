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
  if (status === 'cancelado') {
    return <p className="text-xs text-red-500 font-semibold mt-3">Pedido cancelado</p>
  }
  const steps = deliveryType === 'retirada' ? PICKUP_STEPS : DELIVERY_STEPS
  const currentIndex = Math.max(0, steps.findIndex((s) => s.key.includes(status)))

  return (
    <ol className="flex items-start mt-3">
      {steps.map((step, i) => {
        const done = i <= currentIndex
        return (
          <li key={step.label} className="flex-1 flex flex-col items-center text-center relative">
            {i > 0 && <span className="absolute top-3 right-1/2 w-full h-0.5" style={{ background: i <= currentIndex ? 'var(--u4-orange)' : 'var(--u4-surface-light)' }} />}
            <span
              className="relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: done ? 'var(--u4-orange)' : 'var(--u4-surface-light)', color: done ? '#000' : 'var(--u4-white)' }}
            >
              {done && i < currentIndex ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            <span className={`text-[10px] mt-1.5 leading-tight ${done ? 'font-semibold' : 'u4-dim'}`}>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
