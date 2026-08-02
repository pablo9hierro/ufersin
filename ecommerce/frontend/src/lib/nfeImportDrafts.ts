import { resolveTenantSlug } from './tenantConfig'
import { isDemoModeActive } from './demoMode'
import type { NfeUnit } from './nfeXml'

export type NfeImportForm = {
  name: string
  description: string
  price: string
  quantity: string
  image_url: string
  category_id: string
  barcode: string
  cost_price: string
  low_stock_threshold: string
  /** Supplier SKU from NFe cProd — stored in description on catalog save. */
  supplier_code: string
  ncm: string
  cfop: string
  unit: NfeUnit
  unit_raw: string
}

export type NfeImportDraft = {
  id: string
  status: 'incomplete' | 'saved'
  collapsed: boolean
  createdAt: string
  updatedAt: string
  source: {
    fileName: string
    chNFe: string
    nNF: string
    nItem: number
    emitName: string
  }
  form: NfeImportForm
  catalogProductId?: string
}

const STORAGE_PREFIX = 'resolutoo_nfe_import_drafts_v1_'

function storageKey(tenantOverride?: string): string {
  if (isDemoModeActive()) return `${STORAGE_PREFIX}demo`
  const slug = (tenantOverride ?? resolveTenantSlug() ?? 'unknown').trim().toLowerCase() || 'unknown'
  return `${STORAGE_PREFIX}${slug}`
}

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `nfe_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function emptyNfeForm(): NfeImportForm {
  return {
    name: '',
    description: '',
    price: '',
    quantity: '',
    image_url: '',
    category_id: '',
    barcode: '',
    cost_price: '',
    low_stock_threshold: '',
    supplier_code: '',
    ncm: '',
    cfop: '',
    unit: '',
    unit_raw: '',
  }
}

export function loadNfeImportDrafts(tenantOverride?: string): NfeImportDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(tenantOverride))
    if (!raw) return []
    const parsed = JSON.parse(raw) as NfeImportDraft[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

export function saveNfeImportDrafts(drafts: NfeImportDraft[], tenantOverride?: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(tenantOverride), JSON.stringify(drafts))
  } catch {
    // Quota / private mode — keep in-memory only; caller still has state.
  }
}

export function countIncompleteNfeDrafts(tenantOverride?: string): number {
  return loadNfeImportDrafts(tenantOverride).filter((d) => d.status === 'incomplete').length
}

/** Build catalog description from free text + NFe metadata fields. */
export function composeNfeDescription(form: NfeImportForm): string | null {
  const parts: string[] = []
  if (form.description.trim()) parts.push(form.description.trim())
  const meta: string[] = []
  if (form.supplier_code.trim()) meta.push(`Cód. fornecedor: ${form.supplier_code.trim()}`)
  if (form.ncm.trim()) meta.push(`NCM: ${form.ncm.trim()}`)
  if (form.cfop.trim()) meta.push(`CFOP: ${form.cfop.trim()}`)
  if (form.unit) meta.push(`Unidade: ${form.unit}`)
  else if (form.unit_raw.trim()) meta.push(`Unidade NF: ${form.unit_raw.trim()}`)
  if (meta.length) parts.push(meta.join('\n'))
  return parts.length ? parts.join('\n\n') : null
}

export function isDraftReadyToSave(form: NfeImportForm): string | null {
  if (!form.name.trim()) return 'Informe o nome do produto.'
  const price = Number(form.price)
  if (!Number.isFinite(price) || price < 0 || form.price.trim() === '') {
    return 'Informe o preço de venda (obrigatório — não vem da NF-e).'
  }
  const qty = Number(form.quantity)
  if (!Number.isFinite(qty) || qty < 0 || form.quantity.trim() === '') {
    return 'Informe a quantidade em estoque.'
  }
  if (form.cost_price.trim() !== '') {
    const c = Number(form.cost_price)
    if (!Number.isFinite(c) || c < 0) return 'Valor de custo inválido.'
  }
  return null
}

export { uid as newNfeDraftId }
