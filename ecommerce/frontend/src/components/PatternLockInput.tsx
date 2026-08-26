import { useCallback, useRef, useState } from 'react'

// Port 1:1 de src/components/PatternLockInput.tsx do vrtech.

const SIZE = 220
const PAD = 30
const STEP = (SIZE - PAD * 2) / 2
const DOTS = Array.from({ length: 9 }, (_, i) => ({
  id: i,
  x: PAD + (i % 3) * STEP,
  y: PAD + Math.floor(i / 3) * STEP,
}))
const HIT_RADIUS = 26

/**
 * Desenho de padrão estilo Android real (grade 3x3, arrasta ligando os
 * pontos). Cada ponto já visitado mostra a ORDEM em que foi tocado (1, 2,
 * 3...), igual ao gesto real de desbloqueio, pra não ter ambiguidade de
 * qual foi o primeiro/segundo/terceiro elo.
 *
 * `value`: sequência de índices de ponto (0-8) separados por vírgula, ex.
 * "0,4,8" -- é o que fica salvo em service_request_credentials.value.
 */
export default function PatternLockInput({
  value,
  onChange,
  readOnly = false,
}: {
  value: string
  onChange?: (value: string) => void
  /** Só mostra o desenho, sem interação -- usado no resumo "senha já salva". */
  readOnly?: boolean
}) {
  const [path, setPath] = useState<number[]>(() =>
    value ? value.split(',').map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n)) : [],
  )
  const [dragging, setDragging] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const pointFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scale = SIZE / rect.width
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }
  }, [])

  const nearestDot = useCallback((x: number, y: number) => {
    for (const d of DOTS) {
      if (Math.hypot(d.x - x, d.y - y) <= HIT_RADIUS) return d.id
    }
    return null
  }, [])

  const addDot = useCallback((id: number) => {
    setPath((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  const handleStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const p = pointFromEvent(e)
    if (!p) return
    setPath([])
    setDragging(true)
    setCursor(p)
    const hit = nearestDot(p.x, p.y)
    if (hit !== null) addDot(hit)
  }

  const handleMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const p = pointFromEvent(e)
    if (!p) return
    setCursor(p)
    const hit = nearestDot(p.x, p.y)
    if (hit !== null) addDot(hit)
  }

  const finish = () => {
    if (!dragging) return
    setDragging(false)
    setCursor(null)
    setPath((prev) => {
      onChange?.(prev.join(','))
      return prev
    })
  }

  const clear = () => {
    setPath([])
    onChange?.('')
  }

  const pointsOf = (ids: number[]) => ids.map((id) => DOTS[id])

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        style={{ maxWidth: 260, touchAction: 'none' }}
        className={`bg-slate-50 rounded-2xl border border-gray-200 select-none ${readOnly ? '' : 'cursor-pointer'}`}
        onPointerDown={readOnly ? undefined : handleStart}
        onPointerMove={readOnly ? undefined : handleMove}
        onPointerUp={readOnly ? undefined : finish}
        onPointerLeave={readOnly ? undefined : finish}
        onPointerCancel={readOnly ? undefined : finish}
      >
        {path.length > 1 && (
          <polyline
            points={pointsOf(path).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#dc2626"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {dragging && cursor && path.length > 0 && (
          <line
            x1={DOTS[path[path.length - 1]].x}
            y1={DOTS[path[path.length - 1]].y}
            x2={cursor.x}
            y2={cursor.y}
            stroke="#dc2626"
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.5}
          />
        )}

        {DOTS.map((d) => {
          const order = path.indexOf(d.id)
          const active = order !== -1
          return (
            <g key={d.id}>
              <circle
                cx={d.x}
                cy={d.y}
                r={16}
                fill={active ? '#dc2626' : '#fff'}
                stroke={active ? '#dc2626' : '#cbd5e1'}
                strokeWidth={2}
              />
              {active && (
                <text x={d.x} y={d.y} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} fill="#fff">
                  {order + 1}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {!readOnly && (
        <div className="flex items-center justify-between w-full max-w-65">
          <p className="text-xs text-gray-400">{path.length > 0 ? `${path.length} pontos` : 'Arraste ligando os pontos'}</p>
          {path.length > 0 && (
            <button type="button" onClick={clear} className="text-xs text-gray-400 hover:text-red-600 transition-colors">
              Limpar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
