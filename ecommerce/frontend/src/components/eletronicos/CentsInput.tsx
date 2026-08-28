import { useRef } from 'react'

// Input de dinheiro "estilo caixa registradora" -- cada dígito digitado
// empurra os dígitos existentes uma casa pra esquerda (sempre 2 casas
// decimais fixas), igual maquininha de cartão: 0,00 -> 0,01 -> 0,10 ->
// 1,00 -> 10,00 -> 100,00... Backspace empurra de volta (10,00 -> 1,00).
// Sem digitação livre de vírgula/ponto -- só dígito 0-9 e backspace fazem
// algo, o resto é ignorado, então não tem estado inconsistente possível.

function formatCents(cents: number): string {
  const v = (cents / 100).toFixed(2).replace('.', ',')
  const [intPart, decPart] = v.split(',')
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${withThousands},${decPart}`
}

export default function CentsInput({
  value,
  onChange,
  className,
  placeholder,
  autoFocus,
}: {
  /** Valor em reais (ex: 12.5 = R$ 12,50). */
  value: number
  onChange: (reais: number) => void
  className?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const cents = Math.round((Number.isFinite(value) ? value : 0) * 100)
  const ref = useRef<HTMLInputElement>(null)

  const emit = (nextCents: number) => onChange(Math.max(0, nextCents) / 100)

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoFocus={autoFocus}
      value={formatCents(cents)}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault()
          // Trava em 999.999.999,99 (9 dígitos inteiros) pra não estourar.
          if (cents < 99_999_999_99) emit(cents * 10 + Number(e.key))
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          emit(Math.floor(cents / 10))
        } else if (
          !['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape'].includes(e.key) &&
          !(e.ctrlKey || e.metaKey)
        ) {
          e.preventDefault()
        }
      }}
      onPaste={(e) => {
        e.preventDefault()
        const digits = e.clipboardData.getData('text').replace(/\D/g, '')
        if (digits) emit(Math.min(Number(digits), 99_999_999_99))
      }}
      onChange={() => {
        /* controlado só via onKeyDown/onPaste -- digitação direta é bloqueada acima */
      }}
      className={className}
    />
  )
}
