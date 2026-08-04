import { describe, expect, it, beforeEach } from 'vitest'
import { assertNfeEntrada, mapUComToUnit, parseNfeXml, sanitizeEan } from '../../../lib/nfeXml'
import { composeNfeDescription, isDraftReadyToSave, emptyNfeForm } from '../../../lib/nfeImportDrafts'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="NFe25260535428312000185550010002115501237221230">
      <ide><nNF>211550</nNF><tpNF>1</tpNF><mod>55</mod><dhEmi>2026-05-07T04:05:00-03:00</dhEmi></ide>
      <emit><CNPJ>35428312000185</CNPJ><xNome>EMITENTE TESTE</xNome><xFant>MR DIST</xFant></emit>
      <dest><CNPJ>12345678000199</CNPJ><xNome>LOJA COMPRADORA</xNome></dest>
      <det nItem="1">
        <prod>
          <cProd>167412</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>EMENDA P/CALHA PLUVIAL 125MM UNIDADE</xProd>
          <NCM>39259090</NCM>
          <CFOP>5403</CFOP>
          <uCom>UN</uCom>
          <qCom>2.0000</qCom>
          <vUnCom>15.4150000000</vUnCom>
          <vProd>30.83</vProd>
          <uTrib>UN</uTrib>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>99</cProd>
          <cEAN>7891234567890</cEAN>
          <xProd>PRODUTO KG</xProd>
          <NCM>12345678</NCM>
          <CFOP>5102</CFOP>
          <uCom>KG</uCom>
          <qCom>1.5000</qCom>
          <vUnCom>10.00</vUnCom>
          <vProd>15.00</vProd>
        </prod>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`

const SAIDA_PROPRIA = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe1">
    <ide><nNF>1</nNF><tpNF>1</tpNF><mod>55</mod></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>MINHA LOJA</xNome></emit>
    <dest><CNPJ>99999999000191</CNPJ><xNome>CLIENTE</xNome></dest>
    <det nItem="1"><prod><cProd>1</cProd><xProd>Item</xProd><NCM>1</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>1</vUnCom></prod></det>
  </infNFe>
</NFe>`

describe('nfeXml', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('parseNfeXml extrai linhas det/prod com namespace', () => {
    const r = parseNfeXml(SAMPLE)
    expect(r.nNF).toBe('211550')
    expect(r.emitName).toBe('MR DIST')
    expect(r.lines).toHaveLength(2)
    expect(r.lines[0].xProd).toContain('EMENDA')
    expect(r.lines[0].cProd).toBe('167412')
    expect(r.lines[0].ncm).toBe('39259090')
    expect(r.lines[0].qCom).toBe(2)
    expect(r.lines[0].vUnCom).toBeCloseTo(15.415)
    expect(r.lines[0].unit).toBe('un')
    expect(r.lines[0].barcode).toBe('')
    expect(r.lines[1].unit).toBe('kg')
    expect(r.lines[1].barcode).toBe('7891234567890')
  })

  it('mapUComToUnit e sanitizeEan', () => {
    expect(mapUComToUnit('UN')).toBe('un')
    expect(mapUComToUnit('mt')).toBe('mt')
    expect(mapUComToUnit('PCT')).toBe('pacote')
    expect(mapUComToUnit('XYZ')).toBe('')
    expect(sanitizeEan('SEM GTIN')).toBe('')
    expect(sanitizeEan('123')).toBe('123')
  })

  it('rejeita XML de saída/emissão da própria loja', () => {
    // Compra: dest = loja → memoriza CNPJ da loja
    const compra = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe2">
    <ide><nNF>2</nNF><tpNF>1</tpNF><mod>55</mod></ide>
    <emit><CNPJ>35428312000185</CNPJ><xNome>DIST</xNome></emit>
    <dest><CNPJ>12345678000199</CNPJ><xNome>LOJA</xNome></dest>
    <det nItem="1"><prod><cProd>1</cProd><xProd>Item</xProd><NCM>1</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>1</vUnCom></prod></det>
  </infNFe>
</NFe>`
    expect(() => parseNfeXml(compra, 'loja-teste')).not.toThrow()
    expect(() => parseNfeXml(SAIDA_PROPRIA, 'loja-teste')).toThrow(/saída|emissão/i)
  })

  it('assertNfeEntrada rejeita NFC-e', () => {
    expect(() =>
      assertNfeEntrada({ tpNF: '1', mod: '65', emitCnpj: '1', destCnpj: '2' })
    ).toThrow(/NFC-e|saída/i)
  })

  it('assertNfeEntrada aceita tpNF=0', () => {
    expect(() =>
      assertNfeEntrada({ tpNF: '0', mod: '55', emitCnpj: '1', destCnpj: '' })
    ).not.toThrow()
  })
})

describe('nfeImportDrafts helpers', () => {
  it('isDraftReadyToSave exige preço de venda', () => {
    const f = emptyNfeForm()
    f.name = 'X'
    f.quantity = '2'
    expect(isDraftReadyToSave(f)).toMatch(/preço/i)
    f.price = '19.9'
    expect(isDraftReadyToSave(f)).toBeNull()
  })

  it('isDraftReadyToSave exige conteúdo do pacote', () => {
    const f = emptyNfeForm()
    f.name = 'X'
    f.quantity = '2'
    f.price = '10'
    f.unit = 'pacote'
    expect(isDraftReadyToSave(f)).toMatch(/pacote/i)
    f.package_qty = '12'
    f.package_content_unit = 'un'
    expect(isDraftReadyToSave(f)).toBeNull()
  })

  it('composeNfeDescription inclui metadados', () => {
    const f = emptyNfeForm()
    f.description = 'Obs'
    f.supplier_code = '167412'
    f.ncm = '39259090'
    f.unit = 'un'
    const d = composeNfeDescription(f)!
    expect(d).toContain('Obs')
    expect(d).toContain('167412')
    expect(d).toContain('39259090')
    expect(d).toContain('Unidade: un')
  })
})
