import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordFieldProps {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  autoComplete?: string
}

/** Campo de senha com botão de olho pra mostrar/ocultar o que está digitando. */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder = '••••••••',
  hint,
  autoComplete = 'current-password',
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="input-field pr-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-uf-silver-dim hover:text-uf-silver transition-colors"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          tabIndex={0}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {hint && <p className="text-[11px] text-uf-silver-dim mt-1">{hint}</p>}
    </div>
  )
}
