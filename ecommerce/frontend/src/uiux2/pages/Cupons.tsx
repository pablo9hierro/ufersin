import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2, Tag } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { couponService } from '../../services/couponService'
import type { ClaimedCoupon, CustomerCoupons } from '../../types'
import { useCustomerAuth } from '../../store/customerAuth'
import Shell from '../components/Shell'
import EmptyState from '../components/EmptyState'
import CouponSlot from '../../components/coupon/CouponSlot'
import CouponTicket from '../../components/CouponTicket'
import CouponHistoryTicket from '../../components/CouponHistoryTicket'

type Tab = 'ativos' | 'inativos' | 'historico'
// idle: nada acontecendo, slot em loop (quando existe cupom pendente).
// pulling: acabou de arrastar até o fim, buscando o cupom (peek — só
// espia, não gasta nada). revealed: cupom carregado há 2s, botão de
// confirmar já apareceu. claiming: confirmou, chamando o resgate de
// verdade (gasta a concessão) antes de fechar e ir pra aba Ativos.
type RevealStage = 'idle' | 'pulling' | 'revealed' | 'claiming'

export default function Uiux2Cupons() {
  const { token } = useCustomerAuth()
  const [tab, setTab] = useState<Tab>('ativos')
  const [data, setData] = useState<CustomerCoupons | null>(null)
  const [loading, setLoading] = useState(true)

  const [hasClaimable, setHasClaimable] = useState(false)
  const [revealStage, setRevealStage] = useState<RevealStage>('idle')
  const [preview, setPreview] = useState<ClaimedCoupon | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    couponService.listMine(token).then(setData).finally(() => setLoading(false))
  }, [token])

  const checkHasClaimable = () => {
    if (!token) return
    couponService.hasClaimable(token).then(setHasClaimable).catch(() => setHasClaimable(false))
  }
  useEffect(checkHasClaimable, [token])

  // Disparado pelo CouponSlot ao completar o gesto de arrastar (>=85% do
  // curso) — não pelo clique num botão comum.
  const handleSlotReveal = () => {
    if (!token || revealStage !== 'idle') return
    setRevealError(null)
    setPreview(null)
    setRevealStage('pulling')
    couponService
      .peekClaimable(token)
      .then((c) => {
        setPreview(c)
        window.setTimeout(() => setRevealStage('revealed'), 2000)
      })
      .catch((err) => {
        setRevealError(err instanceof ApiError ? err.message : 'Não foi possível carregar o cupom.')
        setRevealStage('idle')
      })
  }

  const confirmClaim = () => {
    if (!token || revealStage !== 'revealed') return
    setRevealStage('claiming')
    couponService
      .claim(token)
      .then((claimed) => {
        setData((d) => (d ? { ...d, active: [{ ...claimed, created_at: new Date().toISOString() }, ...d.active] } : d))
        setTab('ativos')
        setRevealStage('idle')
        setPreview(null)
        setHasClaimable(false)
        checkHasClaimable()
      })
      .catch((err) => {
        setRevealError(err instanceof ApiError ? err.message : 'Não foi possível resgatar o cupom.')
        setRevealStage('revealed')
      })
  }

  // Trilho horizontal com scroll-snap — o card mais perto do centro
  // visual vira o "ativo" (sunset-coupon-card-active, só ele anima),
  // recalculado a cada frame de scroll via requestAnimationFrame.
  // Mesma dinâmica exata do carrossel de cupons do Sunset original.
  const [activeCardIndex, setActiveCardIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const cardRefs = useRef<(HTMLLIElement | null)[]>([])
  const scrollRaf = useRef<number | null>(null)

  const updateActiveCard = () => {
    const list = listRef.current
    if (!list) return
    const center = list.scrollLeft + list.clientWidth / 2
    let closest = 0
    let closestDist = Infinity
    cardRefs.current.forEach((el, i) => {
      if (!el) return
      const itemCenter = el.offsetLeft + el.offsetWidth / 2
      const dist = Math.abs(itemCenter - center)
      if (dist < closestDist) {
        closestDist = dist
        closest = i
      }
    })
    setActiveCardIndex(closest)
  }

  const handleCarouselScroll = () => {
    if (scrollRaf.current != null) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null
      updateActiveCard()
    })
  }

  useEffect(() => {
    updateActiveCard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data])

  if (!token) return <Navigate to="/catalogo" replace />

  const items = data
    ? tab === 'historico'
      ? data.history.map((h) => ({ key: h.order_id, node: <CouponHistoryTicket entry={h} /> }))
      : (tab === 'ativos' ? data.active : data.inactive).map((c) => ({ key: c.grant_id, node: <CouponTicket coupon={c} /> }))
    : []
  const emptyMessage = tab === 'historico' ? 'Nenhum cupom usado ainda.' : tab === 'ativos' ? 'Nenhum cupom ativo no momento.' : 'Nenhum cupom inativo.'
  const revealOpen = revealStage !== 'idle'

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-5 pb-16 max-w-xl mx-auto">
        <h1 className="text-lg font-black mb-4">Cupons</h1>

        {hasClaimable && (
          <div className="flex justify-center mb-6">
            <CouponSlot
              size="lg"
              onReveal={handleSlotReveal}
              disabled={revealStage !== 'idle'}
              ariaLabel="Resgatar cupom"
              header="CUPOM"
              bodyLines={['Cupom Exclusivo', 'Disponível agora']}
              footerLabel=""
              footerValue="Arraste o cupom para baixo para resgatar"
            />
          </div>
        )}

        <div className="flex gap-2 mb-4">
          {(['ativos', 'inativos', 'historico'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={tab === t ? 'u2-btn-primary flex-1 py-2 text-xs font-semibold capitalize' : 'u2-btn-secondary flex-1 py-2 text-xs font-semibold capitalize'}>
              {t}
            </button>
          ))}
        </div>

        <div className="u2-card p-4 sm:p-6">
          {loading || !data ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin u2-oncanvas-accent" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Tag} message={emptyMessage} />
          ) : (
            <ul
              ref={listRef}
              onScroll={handleCarouselScroll}
              className="flex gap-10 overflow-x-auto scrollbar-hide snap-x snap-mandatory -mx-4 sm:-mx-6 px-12 sm:px-16 py-1"
            >
              {items.map((item, i) => (
                <li
                  key={item.key}
                  ref={(el) => {
                    cardRefs.current[i] = el
                  }}
                  className={`flex-shrink-0 snap-center sunset-coupon-card ${i === activeCardIndex ? 'sunset-coupon-card-active' : ''} ${tab === 'inativos' ? 'grayscale' : ''}`}
                >
                  {item.node}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cupom "saindo do buraco" em tela cheia — abre assim que o slot
            acima é arrastado até o fim, já buscando os dados (peek); 2s
            depois de visível, mostra o botão que de fato gasta o resgate. */}
        {revealOpen && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-6">
            {!preview ? <Loader2 className="w-8 h-8 animate-spin u2-accent" /> : <CouponTicket coupon={preview} />}

            {revealStage === 'revealed' && preview && (
              <button type="button" onClick={confirmClaim} className="u2-btn-primary px-8 py-3 text-sm">
                Resgatar cupom
              </button>
            )}
            {revealStage === 'claiming' && (
              <p className="flex items-center gap-2 text-sm u2-dim">
                <Loader2 className="w-4 h-4 animate-spin" /> Resgatando…
              </p>
            )}
            {revealError && <p className="text-sm text-red-400">{revealError}</p>}
          </div>
        )}
      </div>
    </Shell>
  )
}
