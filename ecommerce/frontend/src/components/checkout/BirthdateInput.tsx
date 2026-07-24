import { useEffect, useRef, useState } from 'react'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function daysInMonth(month: number, year: number): number {
  if (!month) return 31
  return new Date(year || 2000, month, 0).getDate()
}

function parse(value: string): [number | undefined, number | undefined, number | undefined] {
  if (!value) return [undefined, undefined, undefined]
  const [y, m, d] = value.split('-').map(Number)
  return [y, m, d]
}

type Option = { value: number; label: string }

// Uiverse.io by 3bdel3ziz-T — na referência a lista abria no :hover e
// tinha só 4 opções fixas (a label do valor escolhido era resolvida
// 100% em CSS via :has()+attr()); aqui são dezenas de opções (31 dias,
// 12 meses, ~80 anos), então abre por clique/toque (mobile não tem
// hover) e a label selecionada vem do estado React — mas o visual
// (caixa escura, seta girando, lista deslizando com opacity+translate)
// é o mesmo, só recolorido pro tema do site.
function Dropdown({
  options,
  value,
  placeholder,
  onChange,
  ariaLabel,
}: {
  options: Option[]
  value: number | undefined
  placeholder: string
  onChange: (value: number) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={`sunset-dd${open ? ' is-open' : ''}`}>
      <button type="button" className="sunset-dd-selected" onClick={() => setOpen((o) => !o)} aria-label={ariaLabel}>
        <span>{selected ? selected.label : placeholder}</span>
        <svg className="sunset-dd-arrow" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z" />
        </svg>
      </button>
      <div className="sunset-dd-options">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`sunset-dd-option${o.value === value ? ' is-selected' : ''}`}
            onClick={() => {
              onChange(o.value)
              setOpen(false)
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Value/onChange sempre em yyyy-mm-dd (formato que o backend espera) — só a
// APRESENTAÇÃO é dia/mês/ano, via 3 dropdowns em vez do <input type="date">
// nativo (cujo formato/calendário segue o locale do navegador, não o
// nosso — ficava em mm/dd/yyyy mesmo com o site em pt-BR).
//
// Dia/mês/ano moram em estado local (não só derivados de `value`): como só
// emitimos onChange pro pai quando os 3 estão preenchidos, se a seleção
// fosse 100% controlada por `value` cada escolha parcial (ex: só o dia)
// disparava onChange('') e o próprio componente re-renderizava com os 3
// dropdowns vazios de novo — a data nunca ficava selecionada. `lastEmitted`
// distingue "o pai ecoou o que eu acabei de mandar" (ignora) de "o pai
// resetou/carregou um valor por fora" (aí sim resincroniza os dropdowns).
export default function BirthdateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const initial = parse(value)
  const [year, setYear] = useState<number | undefined>(initial[0])
  const [month, setMonth] = useState<number | undefined>(initial[1])
  const [day, setDay] = useState<number | undefined>(initial[2])
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    const [y, m, d] = parse(value)
    setYear(y)
    setMonth(m)
    setDay(d)
  }, [value])

  const thisYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = thisYear - 18; y >= thisYear - 100; y--) years.push(y)

  const maxDay = daysInMonth(month ?? 0, year ?? 0)
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  const commit = (nextDay: number | undefined, nextMonth: number | undefined, nextYear: number | undefined) => {
    setDay(nextDay)
    setMonth(nextMonth)
    setYear(nextYear)
    const next =
      nextDay && nextMonth && nextYear
        ? `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
        : ''
    lastEmitted.current = next
    onChange(next)
  }

  return (
    <div className="grid grid-cols-[1fr_1.4fr_1.1fr] gap-2">
      <Dropdown
        ariaLabel="Dia"
        placeholder="Dia"
        value={day}
        options={days.map((d) => ({ value: d, label: String(d) }))}
        onChange={(d) => commit(d, month, year)}
      />
      <Dropdown
        ariaLabel="Mês"
        placeholder="Mês"
        value={month}
        options={MONTHS.map((label, i) => ({ value: i + 1, label }))}
        onChange={(m) => {
          // Se o dia escolhido não existe no novo mês (ex: 31 de fevereiro), ajusta.
          const clampedDay = day ? Math.min(day, daysInMonth(m, year ?? thisYear)) : day
          commit(clampedDay, m, year)
        }}
      />
      <Dropdown
        ariaLabel="Ano"
        placeholder="Ano"
        value={year}
        options={years.map((y) => ({ value: y, label: String(y) }))}
        onChange={(y) => commit(day, month, y)}
      />
    </div>
  )
}
