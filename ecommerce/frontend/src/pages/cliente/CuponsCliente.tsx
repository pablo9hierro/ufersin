import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Tag } from 'lucide-react'
import SiteHeader from '../../components/layout/SiteHeader'
import PageTransition from '../../components/layout/PageTransition'
import CartFab from '../../components/CartFab'
import CouponTicket from '../../components/CouponTicket'
import CouponHistoryTicket from '../../components/CouponHistoryTicket'
import CouponSlot from '../../components/coupon/CouponSlot'
import { api, ApiError } from '../../lib/api'
import type { ClaimedCoupon, CustomerCoupons } from '../../lib/types'
import { useCustomerAuth } from '../../store/customerAuth'

type Tab = 'ativos' | 'inativos' | 'historico'
// idle: botão em loop esperando toque. pulling: acabou de tocar, modal
// tela cheia já aberto buscando o cupom (peek, não gasta nada ainda).
// revealed: cupom carregado há 2s, botão de confirmar apareceu.
// claiming: confirmou, chamando o resgate de verdade (RPC que gasta o
// cupom) antes de fechar e jogar o card pro carrossel.
type RevealStage = 'idle' | 'pulling' | 'revealed' | 'claiming'

export default function CuponsCliente() {
  const { token } = useCustomerAuth()
  const [tab, setTab] = useState<Tab>('ativos')
  const [data, setData] = useState<CustomerCoupons | null>(null)
  const [loading, setLoading] = useState(true)

  const [hasClaimable, setHasClaimable] = useState<boolean | null>(null)
  const [revealStage, setRevealStage] = useState<RevealStage>('idle')
  const [previewCoupon, setPreviewCoupon] = useState<ClaimedCoupon | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.customerAuth
      .listCoupons(token)
      .then(setData)
      .finally(() => setLoading(false))
  }, [token])

  const checkHasClaimable = () => {
    if (!token) return
    api.customerAuth
      .hasClaimableCoupon(token)
      .then(setHasClaimable)
      .catch(() => setHasClaimable(false))
  }
  useEffect(checkHasClaimable, [token])

  // Uiverse.io by dovatgabriel — na referência era o card sob :hover que
  // crescia (flex:2); celular não tem hover, e o CouponTicket tem
  // largura própria (não é um flex item sem conteúdo), então em vez de
  // flex-grow o card mais perto do centro do scroll vira o "principal"
  // via transform:scale + opacity, recalculado a cada scroll. Só ESSE
  // card anima (flutuação + brilho) -- os outros ficam parados, senão
  // muitos tickets animando ao mesmo tempo pesa demais (reportado).
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

  // Toque no slot: abre a tela cheia na hora (o cupom "sai do buraco" e
  // aparece grande) já buscando os dados (peek -- só espia, não gasta
  // nada). 2s depois de o cupom estar visível, mostra o botão de
  // confirmar. Só ali, ao confirmar, é que o resgate de verdade acontece.
  const handleSlotClick = () => {
    if (!token || revealStage !== 'idle') return
    setRevealError(null)
    setPreviewCoupon(null)
    setRevealStage('pulling')
    api.customerAuth
      .peekClaimableCoupon(token)
      .then((c) => {
        setPreviewCoupon(c)
        window.setTimeout(() => setRevealStage('revealed'), 2000)
      })
      .catch((err) => {
        setRevealError(err instanceof ApiError ? err.message : 'Não foi possível carregar o cupom.')
        setRevealStage('idle')
      })
  }

  const handleConfirmClaim = () => {
    if (!token || revealStage !== 'revealed') return
    setRevealStage('claiming')
    api.customerAuth
      .claimCoupon(token)
      .then((claimed) => {
        // ClaimedCoupon não tem created_at (o RPC não devolve) -- os
        // outros itens de "active" têm, então sintetiza com "agora"
        // (acabou de ser resgatado mesmo).
        setData((d) => (d ? { ...d, active: [{ ...claimed, created_at: new Date().toISOString() }, ...d.active] } : d))
        setTab('ativos')
        setRevealStage('idle')
        setPreviewCoupon(null)
        // Esconde o botão na hora (sem esperar o round-trip abaixo) --
        // some assim que a modal fecha; se ainda sobrar outro cupom pra
        // resgatar, checkHasClaimable() traz ele de volta em seguida.
        setHasClaimable(false)
        checkHasClaimable()
      })
      .catch((err) => {
        setRevealError(err instanceof ApiError ? err.message : 'Não foi possível resgatar o cupom.')
        setRevealStage('revealed')
      })
  }

  if (!token) return <Navigate to="/" replace />

  // Os 3 tabs (ativos/inativos/histórico) agora compartilham o mesmo
  // carrossel horizontal com card central em destaque — só troca a
  // fonte dos dados e o componente de ticket usado por item (histórico
  // não tem kind/discount_type/validade/usos, só o que o pedido guardou
  // na hora da compra, ver CouponHistoryTicket.tsx).
  const items = data
    ? tab === 'historico'
      ? data.history.map((h) => ({ key: h.order_id, node: <CouponHistoryTicket entry={h} /> }))
      : (tab === 'ativos' ? data.active : data.inactive).map((c) => ({
          key: c.grant_id,
          node: <CouponTicket coupon={c} />,
        }))
    : []
  const emptyMessage =
    tab === 'historico' ? 'Nenhum cupom usado ainda.' : tab === 'ativos' ? 'Nenhum cupom ativo no momento.' : 'Nenhum cupom inativo.'

  const revealOpen = revealStage !== 'idle'

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} />
      <CartFab />

      {/* Só aparece quando o cliente TEM cupom exclusivo pra resgatar --
          nada de botão morto sem função nenhuma. Fica entre o navbar e
          as abas (ver print de referência), centralizado. pb reduzido
          de propósito pra ficar rente às abas -- o card puxado durante
          o arrasto pode sim sobrepor as abas logo abaixo, faz parte da
          animação (z-index do .sunset-cs-wrapper garante que ele
          desenha por cima). */}
      {hasClaimable && (
        <div className="flex justify-center px-5 sm:px-10" style={{ paddingBottom: 42 }}>
          <CouponSlot
            size="lg"
            onReveal={handleSlotClick}
            disabled={revealStage !== 'idle'}
            ariaLabel="Resgatar cupom"
            header="CUPOM"
            bodyLines={['Cupom Exclusivo', 'Disponível agora']}
            footerLabel=""
            footerValue="Arraste o cupom para baixo para resgatar"
          />
        </div>
      )}

      <PageTransition className="max-w-2xl mx-auto px-5 sm:px-10 pt-6 pb-16">
        <div className="sunset-tabs overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setTab('ativos')}
            className={`sunset-tab flex-1 ${tab === 'ativos' ? 'sunset-tab-active text-white' : 'text-son-silver hover:text-white'}`}
          >
            Ativos
          </button>
          <button
            onClick={() => setTab('inativos')}
            className={`sunset-tab flex-1 ${tab === 'inativos' ? 'sunset-tab-active text-white' : 'text-son-silver hover:text-white'}`}
          >
            Inativos
          </button>
          <button
            onClick={() => setTab('historico')}
            className={`sunset-tab flex-1 ${tab === 'historico' ? 'sunset-tab-active text-white' : 'text-son-silver hover:text-white'}`}
          >
            Histórico
          </button>
        </div>

        <div className="glass rounded-b-3xl p-4 sm:p-6">
          {loading || !data ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-son-silver-dim">
              <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>{emptyMessage}</p>
            </div>
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
      </PageTransition>

      {/* Cupom "saindo do buraco" em tela cheia -- abre na hora do toque
          (já buscando os dados), espera 2s com o cupom visível, então
          mostra o botão de confirmar o resgate de verdade. */}
      <AnimatePresence>
        {revealOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {!previewCoupon ? (
              <Loader2 className="w-8 h-8 animate-spin text-son-pink" />
            ) : (
              <motion.div
                initial={{ scale: 0.3, opacity: 0, y: 60 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.2, opacity: 0, x: -130, y: 280 }}
                transition={{ type: 'spring', stiffness: 240, damping: 22 }}
              >
                <CouponTicket coupon={previewCoupon} />
              </motion.div>
            )}

            {revealStage === 'revealed' && previewCoupon && (
              <motion.button
                type="button"
                onClick={handleConfirmClaim}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="btn-primary px-8 py-3 text-base"
              >
                Resgatar cupom
              </motion.button>
            )}
            {revealStage === 'claiming' && (
              <p className="flex items-center gap-2 text-sm text-son-silver-dim">
                <Loader2 className="w-4 h-4 animate-spin" /> Resgatando…
              </p>
            )}
            {revealError && <p className="error-msg">{revealError}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}
