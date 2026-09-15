// Port 1:1 de src/components/ui/Logo.tsx do vrtech -- primeira palavra do
// nome da loja ganha gradiente vermelho, resto fica branco/preto.

const SIZES = {
  sm: { word: 'text-lg', tag: 'text-[9px]', img: 'h-7' },
  md: { word: 'text-2xl', tag: 'text-[10px]', img: 'h-9' },
  lg: { word: 'text-4xl sm:text-5xl', tag: 'text-xs', img: 'h-14' },
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
  // Item 5 da auditoria de demo: sem nome customizado (demo/tenant que
  // ainda não passou pelo onboarding), usa a marca real em SVG
  // (assets/brand/logo-eletronica.svg, commit 3a91589) em vez do texto
  // genérico "RESOLUTOO" -- lojista com nome próprio continua vendo o
  // texto com o nome dele (gradiente), sem imagem fixa "Resolutoo".
  if (!name?.trim()) {
    return (
      <div className={`flex flex-col leading-none ${className}`}>
        <img src="/brand/logo-eletronica.svg" alt="Resolutoo Assistência" className={`${s.img} w-auto object-contain`} />
        {showTagline && (
          <span className={`${s.tag} font-medium tracking-[0.25em] uppercase mt-1 ${light ? 'text-[#8b8b94]' : 'text-[#d4d4d8]/60'}`}>
            Assistência Técnica Especializada
          </span>
        )}
      </div>
    )
  }
  const [first, ...rest] = (name?.trim() || 'RESOLUTOO').split(/\s+/)
  const restLabel = rest.length > 0 ? ` ${rest.join(' ')}` : ''
  return (
    <div className={`flex flex-col leading-none ${className}`}>
      <span className={`font-black tracking-tight ${s.word}`}>
        <span className="bg-gradient-to-br from-[#FF3D9A] to-[#7C3AED] bg-clip-text text-transparent">{first}</span>
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
