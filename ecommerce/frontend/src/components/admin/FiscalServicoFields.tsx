import { Receipt } from 'lucide-react'

/**
 * Cadastro fiscal de serviço (NFS-e) -- só os 2 dados que não existem no
 * NF-e de produto (código de serviço municipal, alíquota ISS). Mesmo
 * espírito de `FiscalFields.tsx`, mas os valores são cadastrados na
 * plataforma (Meu Plano → Integrações → "Emitir nota fiscal de serviço"),
 * não aqui -- este componente só mostra o que já foi configurado lá,
 * mesmo padrão read-only de outras integrações espelhadas no ecommerce.
 * A emissão real da NFS-e (webservice municipal) é módulo futuro, fora
 * de escopo -- isto é só o toggle + cadastro de dados.
 */
export default function FiscalServicoFields({
  codigoServicoMunicipal,
  aliquotaIss,
}: {
  codigoServicoMunicipal: string | null
  aliquotaIss: number | null
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Receipt className="w-4 h-4" /> Dados fiscais de serviço (NFS-e)
      </div>
      <p className="text-xs text-son-silver-dim">
        Código de serviço municipal: <strong>{codigoServicoMunicipal || 'não cadastrado'}</strong>
        {' · '}
        Alíquota ISS: <strong>{aliquotaIss != null ? `${aliquotaIss}%` : 'não cadastrada'}</strong>
      </p>
      <p className="text-[11px] text-son-silver-dim">
        Editado em Meu Plano → Integrações. A emissão da nota de serviço em si ainda não está disponível.
      </p>
    </div>
  )
}
