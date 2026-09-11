import { useId } from 'react'

type Props = {
  label: React.ReactNode
  value: string
  onChange: (v: string) => void
  /** Formato esperado (regex/dígitos) -- validação de FORMATO apenas, nunca
   * contra um catálogo fechado. `undefined`/vazio nunca é marcado inválido
   * (campo opcional herdando do perfil). */
  validate?: (v: string) => boolean
  formatHint?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

/** Input de código fiscal (CFOP/NCM/CST/CSOSN/CEST) com validação de
 * FORMATO inline -- feedback imediato (borda vermelha + mensagem) sem
 * bloquear digitação, nunca acopla a um catálogo fechado. Reaproveitado no
 * cadastro de perfil fiscal e no cadastro fiscal do produto. */
export default function CodigoFiscalInput({ label, value, onChange, validate, formatHint, placeholder, disabled, className }: Props) {
  const id = useId()
  const invalido = !!value.trim() && validate ? !validate(value) : false
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        className={`input-field ${invalido ? 'border-red-500 focus:border-red-500' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalido}
      />
      {invalido ? (
        <p className="text-[10px] text-red-400 mt-1">Formato inválido{formatHint ? ` -- ${formatHint}` : ''}.</p>
      ) : formatHint ? (
        <p className="text-[10px] text-son-silver-dim mt-1">{formatHint}</p>
      ) : null}
    </div>
  )
}
