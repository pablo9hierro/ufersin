// Port 1:1 de src/components/ui/Logo.tsx do vrtech -- primeira palavra do
// nome da loja ganha gradiente vermelho, resto fica branco/preto.

const SIZES = {
  sm: { word: 'text-lg', tag: 'text-[9px]' },
  md: { word: 'text-2xl', tag: 'text-[10px]' },
  lg: { word: 'text-4xl sm:text-5xl', tag: 'text-xs' },
} as const

export default function EletronicaLogo({
  size = 'md',
  showTagline = false,
  light = false,
  className = '',
  name,
}: {
  size?: keyof typeof SIZES
  showTagline?: boolean
  light?: boolean
  className?: string
  name?: string | null
}) {
  const s = SIZES[size]
  const [first, ...rest] = (name?.trim() || 'VR TECH').split(/\s+/)
  const restLabel = rest.length > 0 ? ` ${rest.join(' ')}` : ''
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span className={`font-black tracking-tight ${s.word}`}>
        <span className="bg-gradient-to-br from-[#ff4d42] to-[#e0211a] bg-clip-text text-transparent">{first}</span>
        <span className={light ? 'text-[#0a0a0b]' : 'text-white'}>{restLabel}</span>
      </span>
      {showTagline && (
        <span className={`${s.tag} font-medium tracking-[0.25em] uppercase mt-1 ${light ? 'text-[#8b8b94]' : 'text-[#d4d4d8]/60'}`}>
          Assistência Técnica Especializada
        </span>
      )}
    </div>
  )
}
