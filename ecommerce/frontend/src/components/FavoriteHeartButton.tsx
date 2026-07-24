import { useId } from 'react'

// Uiverse.io by barisdogansutcu — checkbox escondido + coração que
// pulsa (scale) ao marcar, recolorido pro rosa/vermelho sunset (era
// vermelho puro). Só o ícone+pulso foi reaproveitado — os rótulos de
// texto "option-1"/"option-2" da referência (que abrem espaço lateral
// pra caber a frase) saíram, aqui é sempre um botão de ícone compacto
// pra caber no canto de um card.
export default function FavoriteHeartButton({
  checked,
  onChange,
  className,
  withLabel,
}: {
  checked: boolean
  onChange: () => void
  className?: string
  // Versão completa da referência (ícone + pílula com texto "Adicionar aos
  // favoritos"/"Adicionado aos favoritos" trocando em crossfade) — usada
  // onde tem espaço horizontal de sobra (dentro do toggle de detalhes do
  // produto). Nos cards (cantinho da imagem) fica só o ícone compacto.
  withLabel?: boolean
}) {
  const id = useId()
  return (
    <span className={`sunset-fav-heart ${withLabel ? 'sunset-fav-heart-labeled' : ''} ${className ?? ''}`}>
      <input
        type="checkbox"
        id={id}
        className="sunset-fav-checkbox"
        checked={checked}
        onChange={onChange}
        onClick={(e) => e.stopPropagation()}
      />
      <label htmlFor={id} onClick={(e) => e.stopPropagation()} aria-label={checked ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        {withLabel && (
          <span className="sunset-fav-action">
            <span className="sunset-fav-option-1">Adicionar aos favoritos</span>
            <span className="sunset-fav-option-2">Adicionado aos favoritos</span>
          </span>
        )}
      </label>
    </span>
  )
}
