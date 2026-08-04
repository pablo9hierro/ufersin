/**
 * Browser-side NFe / nfeProc XML parser (DOMParser).
 * Handles default namespaces (http://www.portalfiscal.inf.br/nfe).
 * Only accepts NF-e de entrada / compra (estoque). Rejects saída/emissão própria.
 */

import type { CatalogUnit } from './catalogUnit'
import { resolveTenantSlug } from './tenantConfig'
import { isDemoModeActive } from './demoMode'

export type NfeUnit = CatalogUnit

export type NfeParsedLine = {
  nItem: number
  cProd: string
  xProd: string
  cEAN: string
  ncm: string
  cfop: string
  uCom: string
  qCom: number | null
  vUnCom: number | null
  vProd: number | null
  uTrib: string
  /** Mapped catalog unit when uCom is recognizable; else ''. */
  unit: NfeUnit
  /** Usable barcode, or '' when SEM GTIN / empty. */
  barcode: string
}

export type NfeParseResult = {
  chNFe: string
  nNF: string
  emitName: string
  dhEmi: string
  tpNF: string
  emitCnpj: string
  destCnpj: string
  lines: NfeParsedLine[]
}

function localName(el: Element): string {
  return (el.localName || el.nodeName || '').replace(/^.*:/, '')
}

function childByLocal(parent: Element, name: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (localName(child) === name) return child
  }
  return null
}

function textByLocal(parent: Element, name: string): string {
  const el = childByLocal(parent, name)
  return el?.textContent?.trim() ?? ''
}

function parseNum(raw: string): number | null {
  if (!raw.trim()) return null
  const n = Number(raw.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '')
}

/** Map commercial unit from NFe to catalog unit (un/kg/mt/pacote). */
export function mapUComToUnit(uCom: string): NfeUnit {
  const u = uCom.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!u) return ''
  if (['UN', 'UND', 'UNID', 'UNIDADE', 'PC', 'PCE', 'PECA'].includes(u)) return 'un'
  if (['KG', 'KGS', 'KILO', 'KILOS', 'QUILO', 'QUILOS'].includes(u)) return 'kg'
  if (['M', 'MT', 'MTR', 'METRO', 'METROS', 'ML', 'M2', 'M²'].includes(u)) return 'mt'
  if (['PCT', 'PCTE', 'PACOTE', 'PKG', 'PACK', 'CX', 'CXA', 'BOX'].includes(u)) return 'pacote'
  return ''
}

export function sanitizeEan(cEAN: string): string {
  const v = cEAN.trim()
  if (!v) return ''
  const upper = v.toUpperCase()
  if (upper === 'SEM GTIN' || upper === 'SEMGTIN' || upper === 'N/A' || upper === 'NA') return ''
  return v
}

function findInfNFe(doc: Document): Element | null {
  const all = doc.getElementsByTagName('*')
  for (const el of Array.from(all)) {
    if (localName(el as Element) === 'infNFe') return el as Element
  }
  return null
}

function findProtChNFe(doc: Document): string {
  const all = doc.getElementsByTagName('*')
  for (const el of Array.from(all)) {
    if (localName(el as Element) === 'chNFe') {
      const t = el.textContent?.trim()
      if (t) return t
    }
  }
  return ''
}

function storeCnpjKey(tenantOverride?: string): string {
  if (isDemoModeActive()) return 'resolutoo_nfe_store_cnpj_demo'
  const slug = (tenantOverride ?? resolveTenantSlug() ?? 'unknown').trim().toLowerCase() || 'unknown'
  return `resolutoo_nfe_store_cnpj_${slug}`
}

export function rememberStoreCnpjFromDest(destCnpj: string, tenantOverride?: string): void {
  const d = digitsOnly(destCnpj)
  if (d.length < 11 || typeof window === 'undefined') return
  try {
    localStorage.setItem(storeCnpjKey(tenantOverride), d)
  } catch {
    // ignore
  }
}

export function getRememberedStoreCnpj(tenantOverride?: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return digitsOnly(localStorage.getItem(storeCnpjKey(tenantOverride)) ?? '')
  } catch {
    return ''
  }
}

/**
 * Aceita NF-e de entrada/compra (estoque do lojista).
 * - tpNF=0 → entrada explícita
 * - tpNF=1 (saída do emitente) → só se for compra do distribuidor (dest ≠ emit;
 *   e emit não é o CNPJ da própria loja já memorizado via dest de imports anteriores)
 * - NFC-e (mod 65) → rejeita (emissão ao consumidor)
 */
export function assertNfeEntrada(opts: {
  tpNF: string
  mod: string
  emitCnpj: string
  destCnpj: string
  rememberedStoreCnpj?: string
}): void {
  const mod = opts.mod.trim() || '55'
  const tp = opts.tpNF.trim()
  const emit = digitsOnly(opts.emitCnpj)
  const dest = digitsOnly(opts.destCnpj)
  const store = digitsOnly(opts.rememberedStoreCnpj ?? '')

  if (mod === '65') {
    throw new Error(
      'XML de NFC-e (saída/emissão ao consumidor) não é suportado. Envie a NF-e de entrada/compra do distribuidor.'
    )
  }

  if (store && emit && emit === store) {
    throw new Error(
      'Este XML parece ser de saída/emissão da própria loja. Importe apenas NF-e de entrada (compra do distribuidor).'
    )
  }

  if (tp === '0') return

  if (tp === '1') {
    if (!dest) {
      throw new Error(
        'XML de saída sem destinatário — não é uma nota de entrada/compra. Envie a NF-e de entrada do distribuidor.'
      )
    }
    if (emit && dest && emit === dest) {
      throw new Error(
        'XML de saída/emissão inválido para importação de estoque. Use a NF-e de entrada do distribuidor.'
      )
    }
    return
  }

  // tpNF ausente: exige destinatário (padrão de NF-e de compra recebida)
  if (!dest) {
    throw new Error(
      'Não foi possível confirmar nota de entrada (destinatário ausente). Envie a NF-e de compra do distribuidor.'
    )
  }
}

function parseDet(det: Element): NfeParsedLine | null {
  const prod = childByLocal(det, 'prod')
  if (!prod) return null
  const nItemAttr = det.getAttribute('nItem')
  const nItem = nItemAttr ? Number(nItemAttr) : 0
  const cProd = textByLocal(prod, 'cProd')
  const xProd = textByLocal(prod, 'xProd')
  if (!xProd && !cProd) return null
  const cEAN = textByLocal(prod, 'cEAN') || textByLocal(prod, 'cEANTrib')
  const uCom = textByLocal(prod, 'uCom')
  return {
    nItem: Number.isFinite(nItem) ? nItem : 0,
    cProd,
    xProd,
    cEAN,
    ncm: textByLocal(prod, 'NCM'),
    cfop: textByLocal(prod, 'CFOP'),
    uCom,
    qCom: parseNum(textByLocal(prod, 'qCom')),
    vUnCom: parseNum(textByLocal(prod, 'vUnCom')),
    vProd: parseNum(textByLocal(prod, 'vProd')),
    uTrib: textByLocal(prod, 'uTrib'),
    unit: mapUComToUnit(uCom),
    barcode: sanitizeEan(cEAN),
  }
}

/** Parse one NFe XML string into header + product lines. */
export function parseNfeXml(xmlText: string, tenantOverride?: string): NfeParseResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('XML inválido ou corrompido.')
  }

  const inf = findInfNFe(doc)
  if (!inf) {
    throw new Error('Arquivo não parece ser uma NF-e (infNFe ausente).')
  }

  const ide = childByLocal(inf, 'ide')
  const emit = childByLocal(inf, 'emit')
  const dest = childByLocal(inf, 'dest')
  const idAttr = inf.getAttribute('Id') || ''
  const chFromId = idAttr.replace(/^NFe/i, '')
  const chNFe = findProtChNFe(doc) || chFromId

  const tpNF = ide ? textByLocal(ide, 'tpNF') : ''
  const mod = ide ? textByLocal(ide, 'mod') : ''
  const emitCnpj = emit ? textByLocal(emit, 'CNPJ') || textByLocal(emit, 'CPF') : ''
  const destCnpj = dest ? textByLocal(dest, 'CNPJ') || textByLocal(dest, 'CPF') : ''

  assertNfeEntrada({
    tpNF,
    mod,
    emitCnpj,
    destCnpj,
    rememberedStoreCnpj: getRememberedStoreCnpj(tenantOverride),
  })

  const lines: NfeParsedLine[] = []
  for (const child of Array.from(inf.children)) {
    if (localName(child) !== 'det') continue
    const line = parseDet(child)
    if (line) lines.push(line)
  }

  if (lines.length === 0) {
    throw new Error('Nenhum item (det/prod) encontrado na NF-e.')
  }

  if (destCnpj) rememberStoreCnpjFromDest(destCnpj, tenantOverride)

  return {
    chNFe,
    nNF: ide ? textByLocal(ide, 'nNF') : '',
    emitName: emit ? textByLocal(emit, 'xFant') || textByLocal(emit, 'xNome') : '',
    dhEmi: ide ? textByLocal(ide, 'dhEmi') : '',
    tpNF,
    emitCnpj,
    destCnpj,
    lines,
  }
}

/** Parse multiple XML file contents; accumulates all product lines. */
export async function parseNfeFiles(
  files: File[],
  tenantOverride?: string
): Promise<{ results: { fileName: string; parsed: NfeParseResult }[]; errors: { fileName: string; message: string }[] }> {
  const results: { fileName: string; parsed: NfeParseResult }[] = []
  const errors: { fileName: string; message: string }[] = []
  for (const file of files) {
    try {
      const text = await file.text()
      results.push({ fileName: file.name, parsed: parseNfeXml(text, tenantOverride) })
    } catch (err) {
      errors.push({ fileName: file.name, message: err instanceof Error ? err.message : 'Falha ao ler XML' })
    }
  }
  return { results, errors }
}
