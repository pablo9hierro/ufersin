import CouponSlot from '../coupon/CouponSlot'

// Card decorativo da seção "Cupons exclusivos de fidelidade" — mesmo
// mecanismo de papel saindo do corte da parede usado no botão
// "Resgatar cupom" (ver CouponSlot.tsx), só que sem onClick (puramente
// decorativo aqui) e no tamanho pequeno (a versão "sm" nunca puxa o
// papel todo pra fora, só um pico curto — cabe ao lado do texto da
// seção sem precisar de espaço reservado como o botão precisa).
export default function CouponTicketCard() {
  return (
    <CouponSlot
      size="sm"
      header="-10%"
      bodyLines={['Cupom Exclusivo', 'Fidelidade Sunset']}
      footerLabel="Frete"
      footerValue="grátis"
    />
  )
}
