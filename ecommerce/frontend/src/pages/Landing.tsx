import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import BrandHeader from '../components/landing/BrandHeader'
import CustomerAuthModal from '../components/CustomerAuthModal'
import { useCustomerAuth } from '../store/customerAuth'
import LiveTrackingMapMock from '../components/landing/LiveTrackingMapMock'
import CouponTicketCard from '../components/landing/CouponTicketCard'
import LandingWhatsAppCard from '../components/landing/LandingWhatsAppCard'
import { api } from '../lib/api'
import type { BadgesLayout, CarouselStyle, LandingBadge, Promotion, StoreStatus } from '../lib/types'
import { getStoreOpenState } from '../lib/storeHours'

// Limiar de arrasto (px) pra contar como swipe de navegação em vez de tap
// ou rolagem vertical da página — usado nos dois estilos de carrossel.
const SWIPE_THRESHOLD = 40

const DEFAULT_BADGES: LandingBadge[] = [
  { id: '1', text: 'SUNSET • Desde 2023', bold: true },
  { id: '2', text: '🔥 Experiência, vibe e essência', bold: false },
  { id: '3', text: '👇 A vibe começa aqui', bold: false },
]

function BannerCarousel() {
  const navigate = useNavigate()
  const [heroUrl, setHeroUrl] = useState<string | null>(null)
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [carouselStyle, setCarouselStyle] = useState<CarouselStyle>('atual')

  useEffect(() => {
    api.siteSettings
      .get()
      .then((s) => {
        setHeroUrl(s.hero_image_url)
        setCarouselStyle(s.carousel_style)
      })
      .catch(() => setHeroUrl(null))
    api.promotions.listActive().then(setPromotions).catch(() => setPromotions([]))
  }, [])

  const firstPromo = promotions[0]
  const bannerImage = firstPromo?.image_url ?? heroUrl
  const restPromos = firstPromo ? promotions.slice(1) : promotions

  const items = [
    {
      key: 'hero',
      image: bannerImage,
      label: firstPromo ? firstPromo.title : 'Sunset Tabas',
      subtitle: (firstPromo?.subtitle || 'Promoções'),
      onClick: firstPromo ? () => navigate(`/banner?promocao=${firstPromo.id}`) : undefined,
    },
    ...restPromos.map((p) => ({ key: p.id, image: p.image_url, label: p.title, subtitle: p.subtitle || 'Promoções', onClick: () => navigate(`/banner?promocao=${p.id}`) })),
  ].filter((it) => it.image)

  // No modo 'atual': um card só que AGRUPA todos os banners/promoções —
  // troca o conteúdo (imagem/título) sozinho a cada 4.5s. No modo 'cards':
  // uma faixa com TODOS os cards lado a lado, um por vez em tela, que
  // desliza pra esquerda a cada 3s. Nos dois, activeIndex também responde
  // a arrastar manualmente (loop pros dois lados).
  const [activeIndex, setActiveIndex] = useState(0)
  const goNext = () => setActiveIndex((i) => (i + 1) % items.length)
  const goPrev = () => setActiveIndex((i) => (i - 1 + items.length) % items.length)

  useEffect(() => {
    if (items.length < 2) return
    const delay = carouselStyle === 'cards' ? 3000 : 4500
    const timer = setInterval(goNext, delay)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, carouselStyle])

  // Detecção de swipe por pointer events (mouse + touch num só código) —
  // só refs, sem re-render a cada movimento. Um arrasto horizontal maior
  // que SWIPE_THRESHOLD conta como navegação e cancela o clique/tap que
  // viria em seguida; um toque curto sem arrasto conta como clique normal.
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
  const swipeHandlers = { onPointerDown, onPointerMove, onPointerUp }

  const active = items[activeIndex] ?? items[0]

  if (!active) return null

  if (carouselStyle === 'cards') {
    return (
      <div className="sunset-book-row">
        <div className="sunset-slide-wrap">
          {/* Card inspirado em Uiverse.io by 05akalan57 (halo borrado no
              canto + rodapé), recolorido pro tema — aqui a faixa inteira
              (todos os itens) desliza, mostrando um card por vez, 3s cada. */}
          <div className="sunset-slide-carousel" {...swipeHandlers}>
            <div className="sunset-slide-track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
              {items.map((it) => (
                <div
                  key={it.key}
                  className="sunset-slide-card"
                  role={it.onClick ? 'button' : undefined}
                  tabIndex={it.onClick ? 0 : undefined}
                  aria-label={it.label}
                  onClick={() => {
                    if (swiped.current) {
                      swiped.current = false
                      return
                    }
                    it.onClick?.()
                  }}
                >
                  <div className="sunset-slide-card-halo" />
                  <div className="sunset-slide-card-inner" style={{ backgroundImage: `url(${it.image})` }}>
                    <div className="sunset-slide-card-footer">
                      <p>{it.label}</p>
                      <p>{it.subtitle}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {items.length > 1 && (
            <div className="sunset-slide-dots">
              {items.map((it, i) => (
                <span key={it.key} className={`sunset-slide-dot ${i === activeIndex ? 'sunset-slide-dot-active' : ''}`} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="sunset-book-row">
      {/* Uiverse.io by Javierrocadev — card com halo borrado atrás, tela
          branca com brilho passando de raspão (era só no :hover; aqui
          é loop contínuo) e rodapé título+seta. O carrossel continua
          sendo UM card só que troca de conteúdo sozinho (activeIndex
          acima) — clique leva pro item que está em tela no momento, e
          arrastar pra esquerda/direita também navega manualmente. */}
      <div
        key={active.key}
        className="sunset-jcard"
        role={active.onClick ? 'button' : undefined}
        tabIndex={active.onClick ? 0 : undefined}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false
            return
          }
          active.onClick?.()
        }}
        aria-label={active.label}
        {...swipeHandlers}
      >
        <div className="sunset-jcard-glow" />
        <div className="sunset-jcard-inner">
          <div className="sunset-jcard-screen" style={{ backgroundImage: `url(${active.image})` }} />
          <div className="sunset-jcard-footer">
            <div className="sunset-jcard-footer-text">
              <p>{active.label}</p>
              <p>{active.subtitle}</p>
            </div>
            <svg
              className="sunset-jcard-arrow"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5 12l14 0" />
              <path d="M13 18l6 -6" />
              <path d="M13 6l6 6" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const customerAuth = useCustomerAuth()
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null)
  const [badges, setBadges] = useState<LandingBadge[]>(DEFAULT_BADGES)
  const [badgesLayout, setBadgesLayout] = useState<BadgesLayout>('row')
  const [badgesGap, setBadgesGap] = useState(8)
  const [badgesOffsetY, setBadgesOffsetY] = useState(0)
  // "Acompanhar meu pedido" exige login — sem sessão, abre o toggle de
  // entrar/criar conta em vez de ir direto pra /consultar.
  const [showAuthModal, setShowAuthModal] = useState(false)

  useEffect(() => {
    api.storeStatus.get().then(setStoreStatus).catch(() => setStoreStatus(null))
    api.siteSettings
      .get()
      .then((s) => {
        if (s.badges.length > 0) setBadges(s.badges)
        setBadgesLayout(s.badges_layout)
        setBadgesGap(s.badges_gap)
        setBadgesOffsetY(s.badges_offset_y)
      })
      .catch(() => {})
  }, [])

  const openState = storeStatus ? getStoreOpenState(storeStatus) : null
  const closed = !!openState && !openState.open

  return (
    <>
      {closed && (
        <div className="relative z-20 bg-red-500/15 border-b border-red-500/40 text-red-200 text-sm text-center px-4 py-3">
          <span className="font-semibold">Loja fechada no momento.</span>{' '}
          {openState?.reason || 'Fora do nosso horário de funcionamento — volte mais tarde!'}
        </div>
      )}
      <main className={`min-h-screen text-white overflow-hidden relative ${closed ? 'grayscale' : ''}`}>
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-son-orange/20 blur-[120px]" />
      <div className="absolute top-20 -right-40 w-96 h-96 rounded-full bg-son-purple/25 blur-[120px]" />
      <div className="absolute bottom-0 left-1/3 w-80 h-80 rounded-full bg-son-pink/15 blur-[120px]" />

      <BrandHeader />

      {/* Banner scrolls with the page (not fixed).
          Sem promoção ativa cadastrada, cai no banner estático de sempre; com
          promoção(ões), vira um carrossel que troca a cada 2s e leva direto pro
          checkout com o desconto já aplicado. */}
      <BannerCarousel />

      <section className="relative z-10 max-w-4xl mx-auto px-6 sm:px-10 pt-2 pb-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          {/* "Continue" button — reproduzido fiel à referência (mesmo
              pill + círculo com seta), recolorido pro dourado do site
              (era branco/preto). Só na referência a seta desliza no
              :hover; aqui virou loop automático e contínuo (pedido
              explícito). */}
          <Link to="/catalogo" className="sunset-continue-btn sunset-glow-btn w-full sm:w-auto">
            <span>Ver catálogo</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 74 74" height={34} width={34}>
              <circle strokeWidth={3} stroke="currentColor" r="35.5" cy={37} cx={37} />
              <path
                fill="currentColor"
                d="M25 35.5C24.1716 35.5 23.5 36.1716 23.5 37C23.5 37.8284 24.1716 38.5 25 38.5V35.5ZM49.0607 38.0607C49.6464 37.4749 49.6464 36.5251 49.0607 35.9393L39.5147 26.3934C38.9289 25.8076 37.9792 25.8076 37.3934 26.3934C36.8076 26.9792 36.8076 27.9289 37.3934 28.5147L45.8787 37L37.3934 45.4853C36.8076 46.0711 36.8076 47.0208 37.3934 47.6066C37.9792 48.1924 38.9289 48.1924 39.5147 47.6066L49.0607 38.0607ZM25 38.5L48 38.5V35.5L25 35.5V38.5Z"
              />
            </svg>
          </Link>
          <button
            type="button"
            onClick={() => (customerAuth.token ? navigate('/consultar') : setShowAuthModal(true))}
            className="btn-secondary sunset-glow-btn text-base px-8 py-4 w-full sm:w-auto"
          >
            Acompanhar entrega
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 + badgesOffsetY }}
          animate={{ opacity: 1, y: badgesOffsetY }}
          transition={{ duration: 0.6 }}
          className="flex flex-wrap justify-center items-center mt-10"
          style={{ flexDirection: badgesLayout === 'column' ? 'column' : 'row', gap: `${badgesGap}px` }}
        >
          {/* Lista de badges editável em /admin/conta (texto + negrito +
              layout lado-a-lado/empilhado + espaçamento + posição
              vertical). Fica embaixo dos botões de catálogo/consulta. */}
          {badges.map((b) => (
            <span key={b.id} className="sunset-shine-badge">
              <span
                className={`sunset-shine-badge-inner px-4 py-2 text-xs sm:text-sm ${b.bold ? 'font-bold' : 'font-medium'} text-son-gold`}
              >
                {b.text}
              </span>
            </span>
          ))}
        </motion.div>

        {/* Botão do Maps — fora da lista de badges, sempre embaixo de
            tudo (é link de verdade, não item editável). */}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            'Rua Rosa de Paula Barbosa, 16 - José Américo de Almeida, João Pessoa - PB'
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="sunset-maps-btn text-xs sm:text-sm mt-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="arr-2" viewBox="0 0 24 24">
            <path d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z" />
          </svg>
          <span className="text">📍 R. Rosa de Paula Barbosa, 16 - José Américo de Almeida. João Pessoa - PB</span>
          <span className="circle" />
          <svg xmlns="http://www.w3.org/2000/svg" className="arr-1" viewBox="0 0 24 24">
            <path d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z" />
          </svg>
        </a>
      </section>

      <section className="relative z-10 max-w-2xl mx-auto px-6 sm:px-10 pb-16 flex flex-col gap-2">
        {[
          {
            title: 'Atualizações direto no seu WhatsApp',
            desc: 'Confirmado, pronto, saiu pra entrega — você acompanha cada etapa sem precisar ficar recarregando a tela.',
            graphic: <LandingWhatsAppCard />,
          },
          {
            title: 'Acompanhe a entrega em tempo real',
            desc: 'Assim que seu pedido sai, você vê o trajeto do motoboy no mapa, ao vivo, até chegar na sua porta.',
            graphic: <LiveTrackingMapMock />,
            solid: true,
          },
          {
            title: 'Cupons exclusivos de fidelidade',
            desc: 'Participe das campanhas e ganhe cupons de desconto e de frete grátis só pra quem já é nosso cliente.',
            graphic: <CouponTicketCard />,
          },
        ].map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className={`glass rounded-2xl p-3 text-left flex items-center gap-3 shadow-[8px_10px_20px_-6px_rgba(0,0,0,0.6)] ${f.solid ? 'sunset-feature-card-solid' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-white mb-0.5">{f.title}</h3>
              <p className="text-xs text-son-silver-dim leading-snug">{f.desc}</p>
            </div>
            {f.graphic}
          </motion.div>
        ))}
      </section>
      </main>
      {showAuthModal && (
        <CustomerAuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false)
            navigate('/consultar')
          }}
        />
      )}
    </>
  )
}
