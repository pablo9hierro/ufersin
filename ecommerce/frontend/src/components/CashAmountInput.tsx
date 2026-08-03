import { formatCashMask, appendCashDigit, backspaceCashDigit, digitsToCashCents, computeTroco, formatTrocoLabel } from '../lib/cashMask'

type Props = {
  orderTotal: number
  valueCents: number
  onChange: (cents: number) => void
  /** Default: "Quanto você pagará em dinheiro" */
  label?: string
  className?: string
  inputClassName?: string
  trocoClassName?: string
  id?: string
}

/**
 * Terminal-style cash amount entry + Troco label.
 * Digits shift left from centavos: 00,00 → 5 → 00,05 → 0 → 00,50 → …
 */
export default function CashAmountInput({
  orderTotal,
  valueCents,
  onChange,
  label = 'Quanto você pagará em dinheiro',
  className,
  inputClassName,
  trocoClassName,
  id = 'cash-amount',
}: Props) {
  const display = formatCashMask(valueCents)
  const troco = computeTroco(valueCents, orderTotal)
  const short = troco < 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault()
      onChange(appendCashDigit(valueCents, Number(e.key)))
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      onChange(backspaceCashDigit(valueCents))
      return
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      onChange(0)
      return
    }
    // Allow Tab / arrows / shortcuts; block other printable keys
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Mobile numeric keyboards / paste: take digit stream as new buffer
    onChange(digitsToCashCents(e.target.value))
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[8rem]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-70 pointer-events-none">R$</span>
          <input
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={display}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className={inputClassName ?? 'input-field pl-10 font-mono tabular-nums tracking-wide'}
            aria-describedby={`${id}-troco`}
          />
        </div>
        <p
          id={`${id}-troco`}
          className={
            trocoClassName ??
            `text-sm font-semibold whitespace-nowrap ${short ? 'text-amber-400' : 'text-emerald-400'}`
          }
        >
          {formatTrocoLabel(troco)}
        </p>
      </div>
    </div>
  )
}
