import type { CSSProperties } from 'react'
import type { PageDecorationElement } from '../../lib/types'

// Baseado em Uiverse.io by SelfMadeSystem (ver fire-element.html) — a
// referência usa a função CSS mod() pra derivar --b/--bmod6 de --n
// (posição/atraso de cada bolinha), mas mod() ainda não tem suporte
// confiável em todo navegador de cliente. Pré-calculamos os dois valores
// aqui em JS a partir da mesma constante (--a) e injetamos prontos —
// visualmente idêntico, sem depender de CSS recente.
const FIRE_A = 32.02135
const FIRE_N_VALUES = [
  0.8865, 0.1355, 0.7449, 0.8842, 0.9783, 0.2639, 0.8008, 0.0349, 0.816, 0.4397, 0.7457, 0.0481, 0.41, 0.1041, 0.9967,
  0.3815, 0.452, 0.2286, 0.8291, 0.9617, 0.3374, 0.7277, 0.8969, 0.3096, 0.386, 0.2347, 0.4591, 0.045, 0.0815, 0.91,
  0.9737, 0.4185, 0.1508, 0.9323, 0.0341, 0.8304, 0.3449, 0.3398, 0.0458, 0.0326, 0.5843, 0.1483, 0.3297, 0.2765,
  0.1764, 0.9811, 0.8625, 0.9378, 0.4417, 0.0425, 0.144, 0.2503, 0.605, 0.7947, 0.3677, 0.5063, 0.0301, 0.3217,
  0.1559, 0.9862, 0.0212, 0.9632, 0.2334, 0.0241, 0.9374, 0.2286, 0.6427, 0.6731, 0.8664, 0.7627, 0.7768, 0.6954,
  0.3915, 0.9714, 0.3935, 0.4859, 0.1976, 0.5246, 0.643, 0.3265, 0.6532, 0.7922, 0.8988, 0.9969, 0.2227, 0.8205,
  0.293, 0.1042, 0.3598, 0.2926, 0.7555, 0.1403, 0.5981, 0.6467, 0.9956, 0.6911, 0.4679, 0.1181, 0.347, 0.6709,
]

function mod1(v: number) {
  const r = v % 1
  return r < 0 ? r + 1 : r
}

export default function FireDecor({ el }: { el: PageDecorationElement }) {
  const anchorStyle: CSSProperties = {
    left: `${el.x}%`,
    top: `${el.y}%`,
    opacity: el.opacity,
  }
  const fireStyle = {
    '--fire-w': `${el.width}px`,
    '--fire-h': `${el.height}px`,
    '--fire-speed': el.speed,
    '--fire-ball-blur': `${el.blur}px`,
  } as CSSProperties
  const balls = FIRE_N_VALUES.slice(0, Math.max(1, Math.min(el.count, FIRE_N_VALUES.length)))

  return (
    <div className="sunset-decor-anchor" style={anchorStyle} aria-hidden="true">
      <div className="sunset-decor-fire" style={fireStyle}>
        {balls.map((n, i) => (
          <span
            key={i}
            className="sunset-decor-fire-ball"
            style={{ '--n': n, '--b': mod1(n * FIRE_A), '--bmod6': mod1(n * 6) } as CSSProperties}
          />
        ))}
      </div>
    </div>
  )
}
