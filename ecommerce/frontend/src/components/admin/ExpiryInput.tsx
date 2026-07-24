import { useState } from 'react'
import DateInput from './DateInput'

type Mode = 'none' | 'duration' | 'date'
type Unit = 'minutos' | 'horas' | 'dias'

const UNIT_MS: Record<Unit, number> = {
  minutos: 60 * 1000,
  horas: 60 * 60 * 1000,
  dias: 24 * 60 * 60 * 1000,
}

function isoToLocalParts(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { date, time }
}

// Prazo de campanha/cupom: "sem prazo", "por tempo determinado" (minutos/
// horas/dias a partir de agora — pra promoção-relâmpago) ou "até uma data
// específica" (dia/mês/ano + hora, nunca mm/dd/yyyy nativo). Sempre entrega
// um ISO string (ou '' pra sem prazo) pro formulário pai.
export default function ExpiryInput({
  value,
  onChange,
  allowDuration = true,
}: {
  value: string
  onChange: (value: string) => void
  allowDuration?: boolean
}) {
  const [mode, setMode] = useState<Mode>(value ? 'date' : 'none')
  const [durationValue, setDurationValue] = useState('')
  const [durationUnit, setDurationUnit] = useState<Unit>('horas')

  const { date, time } = isoToLocalParts(value)

  const setMonthDate = (nextDate: string) => {
    if (!nextDate) {
      onChange('')
      return
    }
    const [y, m, d] = nextDate.split('-').map(Number)
    const dt = new Date(y, m - 1, d, time ? Number(time.split(':')[0]) : 0, time ? Number(time.split(':')[1]) : 0)
    onChange(dt.toISOString())
  }

  const setTime = (nextTime: string) => {
    if (!date) return
    const [y, m, d] = date.split('-').map(Number)
    const [h, min] = nextTime.split(':').map(Number)
    onChange(new Date(y, m - 1, d, h, min).toISOString())
  }

  const applyDuration = (amount: string, unit: Unit) => {
    setDurationValue(amount)
    setDurationUnit(unit)
    const n = Number(amount)
    if (!n || n <= 0) {
      onChange('')
      return
    }
    onChange(new Date(Date.now() + n * UNIT_MS[unit]).toISOString())
  }

  const modeButtonClass = (m: Mode) =>
    `flex-1 py-2 rounded-xl border text-xs font-medium transition-all ${
      mode === m ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver-dim'
    }`

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMode('none')
            onChange('')
          }}
          className={modeButtonClass('none')}
        >
          Sem prazo
        </button>
        {allowDuration && (
          <button type="button" onClick={() => setMode('duration')} className={modeButtonClass('duration')}>
            Por tempo
          </button>
        )}
        <button type="button" onClick={() => setMode('date')} className={modeButtonClass('date')}>
          Até uma data
        </button>
      </div>

      {mode === 'duration' && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <input
            className="input-field min-w-0"
            type="number"
            min="1"
            placeholder="Quantidade"
            value={durationValue}
            onChange={(e) => applyDuration(e.target.value, durationUnit)}
          />
          <select
            className="input-field appearance-none cursor-pointer w-32"
            value={durationUnit}
            onChange={(e) => applyDuration(durationValue, e.target.value as Unit)}
          >
            <option value="minutos">Minutos</option>
            <option value="horas">Horas</option>
            <option value="dias">Dias</option>
          </select>
        </div>
      )}
      {mode === 'duration' && durationValue && (
        <p className="text-xs text-son-silver-dim">A contagem começa agora, ao salvar.</p>
      )}

      {mode === 'date' && (
        <div className="space-y-1.5">
          <DateInput value={date} onChange={setMonthDate} />
          <input
            className="input-field"
            type="time"
            value={time}
            disabled={!date}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}
