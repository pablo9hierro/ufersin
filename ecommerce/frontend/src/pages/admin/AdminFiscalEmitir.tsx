import FiscalCard from '../../components/admin/FiscalCard'
import FiscalDocumentsPanel from '../../components/admin/FiscalDocumentsPanel'

export default function AdminFiscalEmitir() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-2">Emitir</h1>
        <p className="text-sm text-son-silver-dim">
          Emissão de NF-e/NFC-e na venda de produtos, via módulo Jubilados. Configure NCM/CFOP em cada produto (aba
          Produtos) e o cadastro da empresa em Meu Plano → Integrações.
        </p>
      </div>
      <FiscalCard className="p-4" />
      <FiscalDocumentsPanel />
    </div>
  )
}
