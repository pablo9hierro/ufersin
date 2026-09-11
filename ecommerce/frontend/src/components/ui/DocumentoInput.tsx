import { isValidDocumento } from '../../lib/fiscalValidation'

type Tipo = 'cpf' | 'cnpj'

type Props = {
  tipo: Tipo
  onTipoChange: (t: Tipo) => void
  valor: string
  onValorChange: (v: string) => void
  disabled?: boolean
  className?: string
}

/** Toggle CPF/CNPJ + input com validação de dígito verificador inline --
 * reaproveitado no checkout da vitrine, no PDV e em qualquer outro lugar
 * que precise identificar o comprador pra nota fiscal. */
export default function DocumentoInput({ tipo, onTipoChange, valor, onValorChange, disabled, className }: Props) {
  const invalido = !!valor.trim() && !isValidDocumento(tipo, valor)
  return (
    <div className={className}>
      <div className="flex rounded-lg bg-white/10 p-0.5 text-xs font-semibold w-fit mb-2">
        <button
          type="button"
          onClick={() => onTipoChange('cpf')}
          disabled={disabled}
          className={`px-3 py-1 rounded-md transition ${tipo === 'cpf' ? 'bg-son-pink text-white' : 'text-son-silver-dim'}`}
        >
          CPF
        </button>
        <button
          type="button"
          onClick={() => onTipoChange('cnpj')}
          disabled={disabled}
          className={`px-3 py-1 rounded-md transition ${tipo === 'cnpj' ? 'bg-son-pink text-white' : 'text-son-silver-dim'}`}
        >
          CNPJ
        </button>
      </div>
      <input
        className={`input-field ${invalido ? 'border-red-500 focus:border-red-500' : ''}`}
        value={valor}
        onChange={(e) => onValorChange(e.target.value)}
        placeholder={tipo === 'cpf' ? 'CPF (só números)' : 'CNPJ (só números)'}
        disabled={disabled}
        inputMode="numeric"
        aria-invalid={invalido}
      />
      {invalido && <p className="text-[10px] text-red-400 mt-1">{tipo.toUpperCase()} inválido -- confira os números.</p>}
    </div>
  )
}
