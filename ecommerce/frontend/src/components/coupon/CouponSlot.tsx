import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import TicketCardVisual from './TicketCardVisual'

// Tamanhos em número (não só CSS var) porque o arrasto (abaixo) precisa
// calcular limites em px de verdade -- 'sm' (card decorativo da
// landing) fica só com o loop automático (sem onReveal, não é
// interativo); 'lg' (botão "Resgatar cupom") é arrastável.
const SIZE = {
  sm: { width: 110, paperHeight: 190, rest: 50 },
  lg: { width: 190, paperHeight: 220, rest: 70 },
}

// Uiverse.io by dexter-st — "papel" espiando pra fora de um corte na
// parede (3D real via perspective, não só sombra). Sem `onReveal`, fica
// só o loop de "espiando" contínuo (decorativo, card da landing). Com
// `onReveal`: o loop também roda até o cliente TOCAR o papel -- a partir
// daí quem manda é o dedo (pointerdown/move/up abaixo, animation:none e
// transform inline seguindo o arrasto em tempo real). Soltar antes de
// puxar tudo pra fora faz o papel voltar deslizando (CSS transition) e
// o loop retoma; puxar até o fim dispara onReveal() (a partir daí quem
// mostra o cupom em tela cheia é CuponsCliente.tsx).
export default function CouponSlot({
  header,
  bodyLines,
  footerLabel,
  footerValue,
  onReveal,
  disabled,
  size = 'lg',
  ariaLabel,
}: {
  header: ReactNode
  bodyLines: ReactNode[]
  footerLabel: string
  footerValue: string
  onReveal?: () => void
  disabled?: boolean
  size?: 'sm' | 'lg'
  ariaLabel?: string
}) {
  const preset = SIZE[size]
  const restY = -(preset.paperHeight - preset.rest)
  const interactive = !!onReveal

  const [dragY, setDragY] = useState<number | null>(null)
  const [snapping, setSnapping] = useState(false)
  const dragStartClientY = useRef<number | null>(null)
  const triggered = useRef(false)

  const vars = {
    '--cs-width': `${preset.width}px`,
    '--cs-paper-height': `${preset.paperHeight}px`,
  } as CSSProperties

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!interactive || disabled) return
    dragStartClientY.current = e.clientY
    triggered.current = false
    setSnapping(false)
    setDragY(restY)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragStartClientY.current == null) return
    const delta = e.clientY - dragStartClientY.current
    setDragY(Math.min(0, Math.max(restY, restY + delta)))
  }
  const onPointerUp = () => {
    if (dragStartClientY.current == null) return
    dragStartClientY.current = null
    const finalY = dragY ?? restY
    const progress = (finalY - restY) / (0 - restY)
    // Puxou quase tudo pra fora (85%+) -- conta como "resgatado", não
    // precisa soltar bem em cima do zero exato.
    if (progress >= 0.85 && !triggered.current) {
      triggered.current = true
      setDragY(0)
      onReveal?.()
    } else {
      setSnapping(true)
      setDragY(restY)
    }
  }

  const secStyle: CSSProperties | undefined =
    dragY != null
      ? { transform: `translateY(${dragY}px)`, transition: snapping ? 'transform 0.3s ease' : 'none', animation: 'none' }
      : undefined

  return (
    <div className="sunset-cs-wrapper" style={vars}>
      {interactive && (
        <div className="sunset-cs-bubble-wrap">
          <span className="sunset-cs-bubble sunset-cs-bubble-top" aria-hidden="true" />
          <span className="sunset-cs-bubble sunset-cs-bubble-bottom" aria-hidden="true" />
        </div>
      )}
      <div className="sunset-cs-cutout-wrapper">
        <div className="sunset-cs-cutout" />
      </div>
      <div className="sunset-cs-paper-wrapper">
        <div
          className={`sunset-cs-sec ${size === 'sm' ? 'sunset-cs-sec-sm' : ''}`}
          style={secStyle}
          onTransitionEnd={() => {
            if (snapping) {
              setSnapping(false)
              setDragY(null)
            }
          }}
        >
          <button
            type="button"
            className="sunset-cs-paper"
            disabled={disabled}
            aria-label={ariaLabel}
            tabIndex={interactive ? 0 : -1}
            aria-hidden={!interactive}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              pointerEvents: interactive ? 'all' : 'none',
              cursor: interactive ? 'grab' : 'default',
              touchAction: interactive ? 'none' : undefined,
            }}
          >
            <TicketCardVisual header={header} bodyLines={bodyLines} footerLabel={footerLabel} footerValue={footerValue} />
          </button>
        </div>
      </div>
      <div className="sunset-cs-shadow-wrapper">
        <div className="sunset-cs-shadow" />
      </div>
      <div className="sunset-cs-cutter-wrapper">
        <div className="sunset-cs-cutter" />
      </div>
    </div>
  )
}
