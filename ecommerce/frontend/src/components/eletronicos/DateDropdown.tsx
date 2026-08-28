// Componente de data padrão do tema eletrônica (vrtech) -- 3 selects
// estilizados (dia/mês/ano, nessa ordem) em vez do <input type="date">
// nativo do navegador, que renderiza fora do tema (calendário claro do SO,
// sem estilização possível). Extraído de EletronicaAdminAgenda.tsx /
// EletronicaNovoServicoDialog.tsx (eram cópias idênticas) pra virar
// componente único reaproveitado em qualquer campo de data do módulo.

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const DATE_SELECT_CLASS =
  'bg-[#0a0a0b] border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-[#e0211a] transition-colors'

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

export default function DateDropdown({
  value,
  onChange,
  yearsBack = 1,
  yearsForward = 1,
  className,
}: {
  /** Data no formato YYYY-MM-DD (mesmo formato de <input type="date">). */
  value: string
  onChange: (v: string) => void
  /** Quantos anos antes do atual entram na lista (ex: filtro de histórico precisa de mais). */
  yearsBack?: number
  yearsForward?: number
  className?: string
}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const today = new Date()
  const year = m ? Number(m[1]) : today.getFullYear()
  const month = m ? Number(m[2]) : today.getMonth() + 1
  const day = m ? Number(m[3]) : today.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const emit = (y: number, mo: number, d: number) => onChange(`${y}-${pad(mo)}-${pad(Math.min(d, daysInMonth(y, mo)))}`)
  const anos = Array.from({ length: yearsBack + yearsForward + 1 }, (_, i) => today.getFullYear() - yearsBack + i)
  const dias = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1)
  const cls = className ?? DATE_SELECT_CLASS
  return (
    <div className="flex gap-2">
      <select aria-label="Dia" value={day} onChange={(e) => emit(year, month, Number(e.target.value))} className={cls}>
        {dias.map((d) => (
          <option key={d} value={d}>{pad(d)}</option>
        ))}
      </select>
      <select aria-label="Mês" value={month} onChange={(e) => emit(year, Number(e.target.value), day)} className={`${cls} flex-1`}>
        {MESES.map((nome, i) => (
          <option key={nome} value={i + 1}>{nome}</option>
        ))}
      </select>
      <select aria-label="Ano" value={year} onChange={(e) => emit(Number(e.target.value), month, day)} className={cls}>
        {anos.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
    </div>
  )
}
