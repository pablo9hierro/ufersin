import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSiteSettings } from '../../hooks/useSiteSettings'
import { useActivePromotions } from '../../hooks/usePromotions'
import { isDemoModeActive, planoIncludes } from '../../lib/demoMode'

const SWIPE_THRESHOLD = 40

// Equivalente nativo do BannerCarousel do Sunset (pages/Landing.tsx) --
// mesma fonte de dados (hero image + promoções ativas) e mesmo gate de
// plano (Essential não gerencia promoção, então nem busca), visual
// próprio: um card só, flat, sem glow/halo.
export default function PromoCarousel() {
  const navigate = useNavigate()
  const { data: siteSettings } = useSiteSettings()
  const heroUrl = siteSettings?.hero_image_url ?? null
  const { data: activePromotions } = useActivePromotions({ enabled: !isDemoModeActive() || planoIncludes('management') })
  const promotions = activePromotions ?? []

  const firstPromo = promotions[0]
  const bannerImage = firstPromo?.image_url ?? heroUrl
  const restPromos = firstPromo ? promotions.slice(1) : promotions

  const items = [
    {
      key: 'hero',
      image: bannerImage,
      label: firstPromo ? firstPromo.title : 'BurgerBite',
      subtitle: firstPromo?.subtitle || 'Promoções',
      onClick: firstPromo ? () => navigate(`/banner?promocao=${firstPromo.id}`) : undefined,
    },
    ...restPromos.map((p) => ({ key: p.id, image: p.image_url, label: p.title, subtitle: p.subtitle || 'Promoções', onClick: () => navigate(`/banner?promocao=${p.id}`) })),
  ].filter((it) => it.image)

  const [activeIndex, setActiveIndex] = useState(0)
  const goNext = () => setActiveIndex((i) => (i + 1) % items.length)
  const goPrev = () => setActiveIndex((i) => (i - 1 + items.length) % items.length)

  useEffect(() => {
    if (items.length < 2) return
    const timer = setInterval(goNext, 4000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length])

  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (items.length < 2) return
    swipeStart.current = { x: e.clientX, y: e.clientY }
    swiped.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const start = swipeStart.current
    if (!start || swiped.current) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) swiped.current = true
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext()
      else goPrev()
    }
  }

  if (items.length === 0) return null

  const active = items[activeIndex]

  return (
    <div className="px-4 sm:px-8 pt-5">
      <div
        className="u3-feature-card relative aspect-[2/1] max-w-xl mx-auto"
        style={{ cursor: active?.onClick ? 'pointer' : 'default', touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false
            return
          }
          active?.onClick?.()
        }}
        role={active?.onClick ? 'button' : undefined}
        tabIndex={active?.onClick ? 0 : undefined}
        aria-label={active?.label}
      >
        <div className="flex h-full transition-transform duration-500 ease-out" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {items.map((it) => (
            <div key={it.key} className="w-full h-full shrink-0 relative" style={{ backgroundImage: `url(${it.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 text-left text-white">
                <p className="font-bold text-sm leading-tight">{it.label}</p>
                <p className="text-xs opacity-80 mt-0.5">{it.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2.5">
          {items.map((it, i) => (
            <span
              key={it.key}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: i === activeIndex ? 16 : 6, background: i === activeIndex ? 'var(--u3-orange)' : 'color-mix(in srgb, var(--u3-gray) 35%, transparent)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
