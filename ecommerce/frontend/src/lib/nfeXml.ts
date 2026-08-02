/**
 * Browser-side NFe / nfeProc XML parser (DOMParser).
 * Handles default namespaces (http://www.portalfiscal.inf.br/nfe).
 */

export type NfeUnit = 'un' | 'kg' | 'mt' | ''

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

/** Map commercial unit from NFe to catalog unit (un/kg/mt). */
export function mapUComToUnit(uCom: string): NfeUnit {
  const u = uCom.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!u) return ''
  if (['UN', 'UND', 'UNID', 'UNIDADE', 'PC', 'PCE', 'PECA'].includes(u)) return 'un'
  if (['KG', 'KGS', 'KILO', 'KILOS', 'QUILO', 'QUILOS'].includes(u)) return 'kg'
  if (['M', 'MT', 'MTR', 'METRO', 'METROS', 'ML', 'M2', 'M²'].includes(u)) return 'mt'
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
export function parseNfeXml(xmlText: string): NfeParseResult {
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
  const idAttr = inf.getAttribute('Id') || ''
  const chFromId = idAttr.replace(/^NFe/i, '')
  const chNFe = findProtChNFe(doc) || chFromId

  const lines: NfeParsedLine[] = []
  for (const child of Array.from(inf.children)) {
    if (localName(child) !== 'det') continue
    const line = parseDet(child)
    if (line) lines.push(line)
  }

  if (lines.length === 0) {
    throw new Error('Nenhum item (det/prod) encontrado na NF-e.')
  }

  return {
    chNFe,
    nNF: ide ? textByLocal(ide, 'nNF') : '',
    emitName: emit ? textByLocal(emit, 'xFant') || textByLocal(emit, 'xNome') : '',
    dhEmi: ide ? textByLocal(ide, 'dhEmi') : '',
    lines,
  }
}

/** Parse multiple XML file contents; accumulates all product lines. */
export async function parseNfeFiles(files: File[]): Promise<{ results: { fileName: string; parsed: NfeParseResult }[]; errors: { fileName: string; message: string }[] }> {
  const results: { fileName: string; parsed: NfeParseResult }[] = []
  const errors: { fileName: string; message: string }[] = []
  for (const file of files) {
    try {
      const text = await file.text()
      results.push({ fileName: file.name, parsed: parseNfeXml(text) })
    } catch (err) {
      errors.push({ fileName: file.name, message: err instanceof Error ? err.message : 'Falha ao ler XML' })
    }
  }
  return { results, errors }
}
