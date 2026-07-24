import type { CouponKind, DiscountType } from '../lib/types'
import TicketCardVisual from './coupon/TicketCardVisual'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

// "Uso em X" — em que tipo de coisa o cupom se aplica, texto pedido
// explicitamente ao lado do código/validade/usos no card.
const KIND_SCOPE: Record<CouponKind, string> = {
  desconto: 'compras',
  frete: 'frete',
  aniversario: 'aniversário',
  produto: 'produtos',
}

export interface CouponTicketData {
  code: string
  kind: CouponKind
  discount_type: DiscountType | null
  discount_value: number | null
  shipping_discount_type: DiscountType | null
  shipping_discount_value: number | null
  granted_uses: number
  used_count: number
  expires_at: string | null
}

// Só o valor numérico (sem "frete" no fim) -- o header do ticket é
// grande e estreito (~180px), string longa estoura; o alcance já fica
// claro pela linha "Uso em X" do corpo.
function discountHeadline(c: CouponTicketData) {
  if (c.discount_type && c.discount_value != null) {
    return c.discount_type === 'percent' ? `-${c.discount_value}%` : `-${currency(c.discount_value)}`
  }
  if (c.shipping_discount_type && c.shipping_discount_value != null) {
    return c.shipping_discount_type === 'percent' ? `-${c.shipping_discount_value}%` : `-${currency(c.shipping_discount_value)}`
  }
  return 'Cupom'
}

// Uiverse.io by dexter-st (ver TicketCardVisual.tsx pro clone da parte
// visual/holográfica) — campos do ticket viraram campos do cupom:
// header = valor do desconto, corpo = "Cupom Exclusivo" / validade /
// uso+usos, rodapé = código + código de barras decorativo.
export default function CouponTicket({ coupon }: { coupon: CouponTicketData }) {
  return (
    <TicketCardVisual
      header={discountHeadline(coupon)}
      bodyLines={[
        'Cupom Exclusivo',
        `Válido até: ${coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString('pt-BR') : 'Sem validade'}`,
        `Uso em ${KIND_SCOPE[coupon.kind]} · Usos: ${coupon.used_count}/${coupon.granted_uses}`,
      ]}
      footerLabel="Código"
      footerValue={coupon.code}
    />
  )
}
