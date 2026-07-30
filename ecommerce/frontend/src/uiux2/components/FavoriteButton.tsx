import { Heart } from 'lucide-react'

export default function FavoriteButton({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      aria-label={checked ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      aria-pressed={checked}
      className="u2-fab w-8 h-8 rounded-full flex items-center justify-center"
    >
      <Heart className={`w-4 h-4 ${checked ? 'text-red-500' : 'text-neutral-400'}`} fill={checked ? 'currentColor' : 'none'} />
    </button>
  )
}
