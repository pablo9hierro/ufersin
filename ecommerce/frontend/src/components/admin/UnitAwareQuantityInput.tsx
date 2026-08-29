import type { Ingredient } from '../../types'
import { unitsForFamily } from '../../lib/ingredientUnits'

type Props = {
  /** Insumo escolhido na linha — define a família de unidade permitida. */
  ingredientUnit: Ingredient['unit'] | null
  /** Quantidade em centavos-de-unidade (string "0.00" já formatada por este componente). */
  quantity: string
  unit: Ingredient['unit']
  onChange: (patch: { quantity?: string; unit?: Ingredient['unit'] }) => void
  className?: string
}

/** Teclado estilo caixa registradora: dígito entra pela direita, 2 casas
 * decimais fixas (ex: "1" -> 0,01; depois "0" -> 0,10; depois "1" -> 01,00).
 * Guarda o valor internamente como string de dígitos (sem ponto), formata
 * só na exibição — `quantity` de fora/pra fora é sempre um número decimal
 * em string (ex: "1.00"), pronto pra `Number(...)`. */
export default function UnitAwareQuantityInput({ ingredientUnit, quantity, unit, onChange, className }: Props) {
  const digits = quantity && quantity !== '' ? String(Math.round(Number(quantity) * 100)) : '0'
  const formatted = formatCents(digits)

  const pushDigit = (d: string) => {
    const next = (digits === '0' ? '' : digits) + d
    onChange({ quantity: centsToDecimalString(next) })
  }
  const backspace = () => {
    const next = digits.slice(0, -1)
    onChange({ quantity: centsToDecimalString(next === '' ? '0' : next) })
  }
  const clear = () => onChange({ quantity: '0.00' })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (/^[0-9]$/.test(e.key)) pushDigit(e.key)
    else if (e.key === 'Backspace') backspace()
    else if (e.key === 'Delete' || e.key === 'Escape') clear()
  }

  const compatibleUnits = ingredientUnit ? unitsForFamily(ingredientUnit) : unitsForFamily(unit)

  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      <input
        className="input-field w-24 text-right tabular-nums"
        inputMode="numeric"
        value={formatted}
        onKeyDown={handleKeyDown}
        onChange={() => {}}
        placeholder="0,00"
      />
      <select
        className="input-field w-24"
        value={unit}
        onChange={(e) => onChange({ unit: e.target.value as Ingredient['unit'] })}
      >
        {compatibleUnits.map((u) => (
          <option key={u.value} value={u.value}>
            {u.value}
          </option>
        ))}
      </select>
    </div>
  )
}

function formatCents(digits: string): string {
  const padded = digits.padStart(3, '0')
  const intPart = padded.slice(0, -2).replace(/^0+(?=\d)/, '')
  const decPart = padded.slice(-2)
  return `${intPart},${decPart}`
}

function centsToDecimalString(digits: string): string {
  const padded = digits.padStart(3, '0')
  const intPart = padded.slice(0, -2)
  const decPart = padded.slice(-2)
  return `${intPart}.${decPart}`
}
