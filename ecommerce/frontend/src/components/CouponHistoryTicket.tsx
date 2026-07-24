import type { CustomerCouponHistoryEntry } from '../lib/types'
import TicketCardVisual from './coupon/TicketCardVisual'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function headline(h: CustomerCouponHistoryEntry) {
  if (h.discount_amount) return `-${currency(h.discount_amount)}`
  if (h.shipping_discount) return `-${currency(h.shipping_discount)}`
  return 'Usado'
}

// Mesmo TicketCardVisual do CouponTicket — histórico não tem kind/
// validade/usos (o pedido só guarda o código e quanto foi descontado
// naquela compra, não o cadastro do cupom em si), então os campos
// viraram o que dá pra saber de verdade sobre um cupom JÁ USADO.
export default function CouponHistoryTicket({ entry }: { entry: CustomerCouponHistoryEntry }) {
  return (
    <TicketCardVisual
      header={headline(entry)}
      bodyLines={['Cupom Exclusivo', `Usado em: ${new Date(entry.created_at).toLocaleDateString('pt-BR')}`, `Pedido #${entry.order_id.slice(0, 8)}`]}
      footerLabel="Código"
      footerValue={entry.coupon_code}
    />
  )
}
