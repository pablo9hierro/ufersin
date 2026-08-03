import FreteSettingsCard from '../../components/admin/FreteSettingsCard'

/** Essential-only frete config (R$/km + max km). Staff CRUD stays on Funcionários (Management+). */
export default function AdminFrete() {
  return (
    <div>
      <h1 className="text-2xl font-black mb-2">Frete</h1>
      <p className="text-sm text-son-silver-dim mb-6">
        Defina o valor por quilômetro e até onde a loja entrega. Pedidos de entrega entram na aba Entregas dos
        Pedidos para você dar baixa (pago + entregue).
      </p>
      <FreteSettingsCard className="p-4" />
    </div>
  )
}
