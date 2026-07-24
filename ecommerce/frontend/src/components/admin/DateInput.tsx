const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function daysInMonth(month: number, year: number): number {
  if (!month) return 31
  return new Date(year || 2000, month, 0).getDate()
}

// Mesma ideia do BirthdateInput (3 selects dia/mês/ano em vez do <input
// type="date"> nativo, que segue o locale do navegador) só que com o range
// de anos configurável — usado em datas de campanha/cupom (passado/futuro
// próximo), não em data de nascimento.
export default function DateInput({
  value,
  onChange,
  yearsBack = 1,
  yearsForward = 5,
}: {
  value: string
  onChange: (value: string) => void
  yearsBack?: number
  yearsForward?: number
}) {
  const [year, month, day] = value ? value.split('-').map(Number) : [undefined, undefined, undefined]

  const thisYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = thisYear - yearsBack; y <= thisYear + yearsForward; y++) years.push(y)

  const maxDay = daysInMonth(month ?? 0, year ?? 0)
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  const emit = (nextDay?: number, nextMonth?: number, nextYear?: number) => {
    const d = nextDay ?? day
    const m = nextMonth ?? month
    const y = nextYear ?? year
    if (!d || !m || !y) {
      onChange('')
      return
    }
    onChange(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }

  const selectClass = 'input-field appearance-none cursor-pointer text-sm'

  return (
    <div className="grid grid-cols-3 gap-1.5">
      <select
        className={selectClass}
        value={day ?? ''}
        onChange={(e) => emit(e.target.value ? Number(e.target.value) : undefined, undefined, undefined)}
        aria-label="Dia"
      >
        <option value="">Dia</option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        value={month ?? ''}
        onChange={(e) => {
          const m = e.target.value ? Number(e.target.value) : undefined
          const clampedDay = day && m ? Math.min(day, daysInMonth(m, year ?? thisYear)) : day
          emit(clampedDay, m, undefined)
        }}
        aria-label="Mês"
      >
        <option value="">Mês</option>
        {MONTHS.map((label, i) => (
          <option key={label} value={i + 1}>
            {label}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        value={year ?? ''}
        onChange={(e) => emit(undefined, undefined, e.target.value ? Number(e.target.value) : undefined)}
        aria-label="Ano"
      >
        <option value="">Ano</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}
