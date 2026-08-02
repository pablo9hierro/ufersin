import { describe, expect, it } from 'vitest'
import { mapUComToUnit, parseNfeXml, sanitizeEan } from '../../../lib/nfeXml'
import { composeNfeDescription, isDraftReadyToSave, emptyNfeForm } from '../../../lib/nfeImportDrafts'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="NFe25260535428312000185550010002115501237221230">
      <ide><nNF>211550</nNF><dhEmi>2026-05-07T04:05:00-03:00</dhEmi></ide>
      <emit><xNome>EMITENTE TESTE</xNome><xFant>MR DIST</xFant></emit>
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

describe('nfeXml', () => {
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
    expect(mapUComToUnit('CX')).toBe('')
    expect(sanitizeEan('SEM GTIN')).toBe('')
    expect(sanitizeEan('123')).toBe('123')
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
