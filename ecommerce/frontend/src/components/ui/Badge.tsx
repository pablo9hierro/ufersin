import type { OrderStatus } from '../../lib/types'
import { STATUS_LABELS } from '../../lib/types'
import clsx from 'clsx'

const STATUS_COLORS: Record<OrderStatus, string> = {
  pendente: 'bg-white/10 text-son-silver',
  montando_pedido: 'bg-son-gold/15 text-son-gold',
  pedido_pronto: 'bg-son-orange/15 text-son-orange',
  aguardando_localizacao: 'bg-son-purple/15 text-son-purple',
  em_rota_de_entrega: 'bg-son-pink/15 text-son-pink',
  entregue: 'bg-emerald-500/15 text-emerald-400',
  retiradas: 'bg-son-gold/15 text-son-gold',
  concluido: 'bg-emerald-500/20 text-emerald-400',
}

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: OrderStatus
  className?: string
  label?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap',
        STATUS_COLORS[status],
        className
      )}
    >
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}

export default function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-son-silver', className)}>
      {children}
    </span>
  )
}
