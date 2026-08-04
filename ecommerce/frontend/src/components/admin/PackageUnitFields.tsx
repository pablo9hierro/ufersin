import type { CatalogUnit, PackageContentUnit } from '../../lib/catalogUnit'

const UNIT_OPTIONS: { value: CatalogUnit; label: string }[] = [
  { value: '', label: 'Selecionar…' },
  { value: 'un', label: 'un (unidade)' },
  { value: 'kg', label: 'kg (quilo)' },
  { value: 'mt', label: 'mt (metro)' },
  { value: 'pacote', label: 'pacote' },
]

const PACKAGE_CONTENT_OPTIONS: { value: PackageContentUnit; label: string }[] = [
  { value: 'un', label: 'unidades' },
  { value: 'kg', label: 'kilos' },
  { value: 'mt', label: 'metros' },
]

export type PackageUnitValue = {
  unit: CatalogUnit
  package_qty: string
  package_content_unit: PackageContentUnit
}

type Props = {
  value: PackageUnitValue
  onChange: (patch: Partial<PackageUnitValue>) => void
  disabled?: boolean
  hint?: string
  selectClassName?: string
}

/** Unidade de revenda + conteúdo do pacote (quando unit === pacote). */
export default function PackageUnitFields({
  value,
  onChange,
  disabled,
  hint,
  selectClassName = 'input-field',
}: Props) {
  return (
    <div className="space-y-2">
      <div>
        <label className="label">Unidade</label>
        <select
          className={selectClassName}
          value={value.unit}
          onChange={(e) => onChange({ unit: e.target.value as CatalogUnit })}
          disabled={disabled}
          data-testid="product-unit-select"
        >
          {UNIT_OPTIONS.map((o) => (
            <option key={o.value || 'empty'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint ? <p className="text-[10px] text-son-silver-dim mt-1">{hint}</p> : null}
      </div>
      {value.unit === 'pacote' && (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2"
          data-testid="package-contents-fields"
        >
          <p className="text-xs text-amber-300/90">Quanto vem dentro de um pacote que você revende?</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[100px]">
              <label className="label">Quantidade</label>
              <input
                className="input-field"
                type="number"
                step="any"
                min="0"
                placeholder="Ex: 12"
                value={value.package_qty}
                onChange={(e) => onChange({ package_qty: e.target.value })}
                disabled={disabled}
                data-testid="package-qty-input"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="label">Conteúdo</label>
              <select
                className="input-field"
                value={value.package_content_unit}
                onChange={(e) => onChange({ package_content_unit: e.target.value as PackageContentUnit })}
                disabled={disabled}
                data-testid="package-content-unit-select"
              >
                {PACKAGE_CONTENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
