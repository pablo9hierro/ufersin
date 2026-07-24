// Chave-mestra de on/off — pill com bolinha deslizante (ON: texto + bolinha
// à direita; OFF: bolinha + texto à esquerda), em vez de um badge de texto
// "Ativo/Inativo". Compartilhado por todo formulário/lista admin que liga
// e desliga algo (campanha, cupom, promoção...).
export default function ToggleSwitch({ checked, onClick }: { checked: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center w-[4.5rem] h-7 px-1 rounded-full border transition-colors duration-200 flex-shrink-0 ${
        checked ? 'justify-end bg-emerald-500/15 border-emerald-400/60' : 'justify-start bg-white/5 border-white/20'
      }`}
    >
      <span className={`flex items-center gap-1.5 ${checked ? 'flex-row-reverse' : ''}`}>
        <span className={`w-5 h-5 rounded-full flex-shrink-0 ${checked ? 'bg-emerald-400' : 'bg-son-silver-dim'}`} />
        <span className={`text-[10px] font-bold ${checked ? 'text-emerald-300' : 'text-son-silver-dim'}`}>{checked ? 'ON' : 'OFF'}</span>
      </span>
    </button>
  )
}
