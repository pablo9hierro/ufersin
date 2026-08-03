import { useState } from 'react'
import { Clock, X } from 'lucide-react'
import type { StoreHourDay } from '../../types'
import { DAY_LABELS, formatDayHours, sortedStoreHours } from '../../lib/storeHours'

type LayoutVariant = 'u2' | 'u3' | 'u4'

const PANEL_CLASS: Record<LayoutVariant, string> = {
  u2: 'u2-card p-4 text-left',
  u3: 'rounded-3xl p-4 text-left',
  u4: 'u4-panel p-4 text-left',
}

const DIM_CLASS: Record<LayoutVariant, string> = {
  u2: 'u2-dim',
  u3: 'u3-dim',
  u4: 'u4-dim',
}

const TRIGGER_CLASS: Record<LayoutVariant, string> = {
  u2: 'flex items-center justify-center gap-1.5 hover:opacity-80 transition-opacity u2-oncanvas-dim',
  u3: 'flex items-center justify-center gap-1.5 hover:opacity-80 transition-opacity u3-dim',
  u4: 'flex items-center gap-1.5 hover:opacity-80 transition-opacity u4-dim',
}

export default function StoreHoursToggle({
  hours,
  variant,
}: {
  hours: StoreHourDay[] | undefined
  variant: LayoutVariant
}) {
  const [open, setOpen] = useState(false)
  const rows = hours?.length ? sortedStoreHours(hours) : []

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`text-sm ${TRIGGER_CLASS[variant]}`}>
        <Clock className="w-4 h-4 shrink-0" /> Horário de funcionamento
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto">
            <div className={PANEL_CLASS[variant]} style={variant === 'u3' ? { background: 'var(--u3-surface)' } : undefined}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="font-bold text-sm">Horário de funcionamento</p>
                <button type="button" onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full opacity-70 hover:opacity-100" aria-label="Fechar">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {rows.length === 0 ? (
                <p className={`text-sm ${DIM_CLASS[variant]}`}>
                  Horários ainda não configurados. O lojista define em Configurações do painel da loja.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {rows.map((day) => (
                    <li key={day.day_of_week} className="flex justify-between gap-3">
                      <span className="font-medium">{DAY_LABELS[day.day_of_week]}</span>
                      <span className={`text-right ${DIM_CLASS[variant]}`}>{formatDayHours(day)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
