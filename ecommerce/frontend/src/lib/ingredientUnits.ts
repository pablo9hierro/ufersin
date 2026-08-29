import type { Ingredient } from '../types'

/** Mesmas famílias/fatores de `formulation::convert()` no backend — usado só
 * pra preview ao vivo e pra restringir o `<select>` de unidade às unidades
 * compatíveis com o insumo escolhido. O backend recalcula/valida de novo ao
 * salvar; é sempre a fonte da verdade. */
export const UNIT_FAMILY: Record<Ingredient['unit'], string> = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  un: 'unit',
  mm: 'length',
  cm: 'length',
  m: 'length',
  km: 'length',
}

export const UNIT_FACTOR: Record<Ingredient['unit'], number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  un: 1,
  mm: 1,
  cm: 10,
  m: 1000,
  km: 1_000_000,
}

export const INGREDIENT_UNITS: { value: Ingredient['unit']; label: string }[] = [
  { value: 'g', label: 'g (grama)' },
  { value: 'kg', label: 'kg (quilo)' },
  { value: 'ml', label: 'ml (mililitro)' },
  { value: 'l', label: 'l (litro)' },
  { value: 'un', label: 'un (unidade)' },
  { value: 'mm', label: 'mm (milímetro)' },
  { value: 'cm', label: 'cm (centímetro)' },
  { value: 'm', label: 'm (metro)' },
  { value: 'km', label: 'km (quilômetro)' },
]

export function unitsForFamily(unit: Ingredient['unit']): { value: Ingredient['unit']; label: string }[] {
  const family = UNIT_FAMILY[unit]
  return INGREDIENT_UNITS.filter((u) => UNIT_FAMILY[u.value] === family)
}

export function convertUnit(qty: number, from: Ingredient['unit'], to: Ingredient['unit']): number | null {
  if (UNIT_FAMILY[from] !== UNIT_FAMILY[to]) return null
  return (qty * UNIT_FACTOR[from]) / UNIT_FACTOR[to]
}
