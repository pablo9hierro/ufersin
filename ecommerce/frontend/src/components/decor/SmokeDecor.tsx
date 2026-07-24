import type { CSSProperties } from 'react'
import type { PageDecorationElement } from '../../lib/types'

// Baseado em Uiverse.io by esraaabdel-kareem (ver smoke-element.html) —
// a referência tinha só 3 baforadas fixas; aqui o admin controla a
// quantidade (até 15) e cada baforada recebe seu próprio atraso de
// animação (0.8s * índice, na mesma cadência da referência).
export default function SmokeDecor({ el }: { el: PageDecorationElement }) {
  const anchorStyle: CSSProperties = {
    left: `${el.x}%`,
    top: `${el.y}%`,
    opacity: el.opacity,
  }
  const loaderStyle = {
    '--smoke-speed': el.speed,
    '--smoke-puff-w': `${el.width}px`,
    '--smoke-puff-h': `${el.height}px`,
    '--smoke-blur': `${el.blur}px`,
  } as CSSProperties

  return (
    <div className="sunset-decor-anchor" style={anchorStyle} aria-hidden="true">
      <div className="sunset-decor-smoke-loader" style={loaderStyle}>
        {Array.from({ length: el.count }, (_, i) => (
          <span
            key={i}
            className="sunset-decor-smoke"
            style={{ animationDelay: `calc(${i * 0.8}s / var(--smoke-speed, 1))` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  )
}
