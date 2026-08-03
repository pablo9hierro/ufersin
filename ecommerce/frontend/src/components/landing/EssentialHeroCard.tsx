/** Rectangular Essential hero image — template-styled card above the headline. */
export default function EssentialHeroCard({
  imageUrl,
  variant,
  alt = 'Destaque da loja',
}: {
  imageUrl: string | null | undefined
  variant: 'u2' | 'u3' | 'u4'
  alt?: string
}) {
  const src = imageUrl?.trim()
  if (!src) return null

  if (variant === 'u2') {
    return (
      <div className="px-4 sm:px-8 pt-5" data-testid="essential-hero-card">
        <div className="u2-card overflow-hidden !rounded-2xl aspect-[16/9] sm:aspect-[21/9] max-h-56 sm:max-h-64 mx-auto">
          <img src={src} alt={alt} className="w-full h-full object-cover" />
        </div>
      </div>
    )
  }

  if (variant === 'u3') {
    return (
      <div className="px-4 sm:px-8 pt-5" data-testid="essential-hero-card">
        <div
          className="overflow-hidden rounded-3xl aspect-[16/9] sm:aspect-[21/9] max-h-56 sm:max-h-64 mx-auto"
          style={{ background: 'var(--u3-surface)' }}
        >
          <img src={src} alt={alt} className="w-full h-full object-cover" />
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-8 pt-5" data-testid="essential-hero-card">
      <div className="u4-panel overflow-hidden !rounded-none aspect-[16/9] sm:aspect-[21/9] max-h-56 sm:max-h-64 mx-auto">
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </div>
    </div>
  )
}
