/** Catalog / revenda unit used in product forms (XML + manual). */
export type CatalogUnit = 'un' | 'kg' | 'mt' | 'pacote' | ''

export type PackageContentUnit = 'un' | 'kg' | 'mt'

const PACKAGE_LINE_RE = /^Pacote:\s*([\d.,]+)\s+(un|kg|mt)\b/im
const UNIT_LINE_RE = /^Unidade:\s*(un|kg|mt|pacote)\b/im

export function formatPackageMeta(
  unit: CatalogUnit,
  packageQty: string,
  packageContentUnit: PackageContentUnit
): string | null {
  if (unit === 'pacote') {
    const q = packageQty.trim()
    if (!q) return 'Unidade: pacote'
    return `Unidade: pacote\nPacote: ${q} ${packageContentUnit}`
  }
  if (unit) return `Unidade: ${unit}`
  return null
}

/** Merge unit/package lines into a free-text description (idempotent replace). */
export function mergeUnitIntoDescription(
  description: string,
  unit: CatalogUnit,
  packageQty: string,
  packageContentUnit: PackageContentUnit
): string {
  const cleaned = description
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !UNIT_LINE_RE.test(l) && !PACKAGE_LINE_RE.test(l))
    .join('\n')
  const meta = formatPackageMeta(unit, packageQty, packageContentUnit)
  if (!meta) return cleaned
  return cleaned ? `${cleaned}\n\n${meta}` : meta
}

export function parseUnitFromDescription(description: string | null | undefined): {
  unit: CatalogUnit
  package_qty: string
  package_content_unit: PackageContentUnit
} {
  const text = description ?? ''
  const unitMatch = text.match(UNIT_LINE_RE)
  const pkgMatch = text.match(PACKAGE_LINE_RE)
  const unit = (unitMatch?.[1] as CatalogUnit | undefined) ?? (pkgMatch ? 'pacote' : '')
  return {
    unit: unit || '',
    package_qty: pkgMatch?.[1]?.replace(',', '.') ?? '',
    package_content_unit: (pkgMatch?.[2] as PackageContentUnit | undefined) ?? 'un',
  }
}

/** Description free-text without Unidade/Pacote meta lines (for the textarea). */
export function stripUnitFromDescription(description: string | null | undefined): string {
  if (!description) return ''
  return description
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !UNIT_LINE_RE.test(l) && !PACKAGE_LINE_RE.test(l))
    .join('\n')
    .trim()
}
