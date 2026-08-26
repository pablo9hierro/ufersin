import { Construction } from 'lucide-react'

// Telas do sidebar real do vrtech que ainda não foram portadas pro motor
// novo (Chat ao vivo, Serviço de deslocamento, Relatórios, Conta) --
// mostra honestamente "ainda não migrado" em vez de fingir uma tela vazia
// com dado fake.
export default function EletronicaAdminEmBreve({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 text-[#d4d4d8]/40">
      <Construction className="w-10 h-10 mb-3 opacity-40" />
      <p className="font-semibold text-white/70">{title}</p>
      <p className="text-sm mt-1">Essa tela ainda não foi migrada pro painel nativo.</p>
    </div>
  )
}
