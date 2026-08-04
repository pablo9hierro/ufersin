/** Rectangular Essential hero image — template-styled card above the headline.
 * Owns its own bottom spacing (`mb-4`) so it never sits flush against the next
 * element (badge/headline). Same token in uiux2 / uiux3 / uiux4. */
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

  // Outer chrome: horizontal inset + top pad; `mb-4` is the card's own
  // breathing room below (do not rely only on the next section's pt-*).
  const wrap = 'px-4 sm:px-8 pt-5 mb-4'

  if (variant === 'u2') {
    return (
      <div className={wrap} data-testid="essential-hero-card">
        <div className="u2-card overflow-hidden !rounded-2xl aspect-[16/9] sm:aspect-[21/9] max-h-56 sm:max-h-64 mx-auto">
          <img src={src} alt={alt} className="w-full h-full object-cover" />
        </div>
      </div>
    )
  }

  if (variant === 'u3') {
    return (
      <div className={wrap} data-testid="essential-hero-card">
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
    <div className={wrap} data-testid="essential-hero-card">
      <div className="u4-panel overflow-hidden !rounded-none aspect-[16/9] sm:aspect-[21/9] max-h-56 sm:max-h-64 mx-auto">
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </div>
    </div>
  )
}
