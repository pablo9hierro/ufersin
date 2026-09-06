import MercadoPagoPointCard from '../../components/admin/MercadoPagoPointCard'

export default function AdminMercadoPagoPoint() {
  return (
    <div>
      <h1 className="text-2xl font-black mb-2">Mercado Pago Point</h1>
      <p className="text-sm text-son-silver-dim mb-6">
        Cobrança via maquininha (Point/POS). Configure loja, caixas e terminais aqui; a cobrança em si acontece direto
        do PDV/comanda quando o pedido for pago no cartão físico.
      </p>
      <MercadoPagoPointCard className="p-4" />
    </div>
  )
}
