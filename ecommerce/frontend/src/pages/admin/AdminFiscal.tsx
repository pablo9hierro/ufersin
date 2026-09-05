import FiscalCard from '../../components/admin/FiscalCard'

export default function AdminFiscal() {
  return (
    <div>
      <h1 className="text-2xl font-black mb-2">Fiscal</h1>
      <p className="text-sm text-son-silver-dim mb-6">
        Emissão de NF-e/NFC-e na venda de produtos, via módulo Jubilados. Configure NCM/CFOP em cada produto (aba
        Produtos) e o cadastro da empresa em Meu Plano → Financeiro → Fiscal.
      </p>
      <FiscalCard className="p-4" />
    </div>
  )
}
