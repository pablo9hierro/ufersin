import EntregasTerceirizadasCard from '../../components/admin/EntregasTerceirizadasCard'

export default function AdminEntregasTerceirizadas() {
  return (
    <div>
      <h1 className="text-2xl font-black mb-2">Entregas terceirizadas</h1>
      <p className="text-sm text-son-silver-dim mb-6">
        Conecte um provider de entrega (Uber Direct) e despache pedidos prontos direto da aba Pedidos, sem precisar
        ligar pro motoboy/entregador manualmente.
      </p>
      <EntregasTerceirizadasCard className="p-4" />
    </div>
  )
}
