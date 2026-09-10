import { useEffect, useState } from 'react'
import type { ProductFiscalPayload } from '../../types'
import type { TenantCfop } from '../../lib/api'
import { adminService } from '../../services/adminService'

export type FiscalValue = {
  ncm: string
  cfop: string
  cst: string
  csosn: string
  cest: string
  origem: string
  unidade_fiscal: string
  ean: string
  cclass_trib: string
}

/** Sem enum oficial rígido pra unidade comercial na NF-e (texto livre até
 * 6 chars) — lista curada com os códigos mais comuns só pra evitar erro de
 * digitação, sempre editável se o lojista precisar de outro código. */
export const UNIDADE_FISCAL_OPTIONS = ['UN', 'KG', 'G', 'M', 'M2', 'M3', 'L', 'ML', 'CX', 'PC', 'PAR', 'DZ']

export const EMPTY_FISCAL: FiscalValue = {
  ncm: '',
  cfop: '',
  cst: '',
  csosn: '',
  cest: '',
  origem: '0',
  unidade_fiscal: '',
  ean: '',
  cclass_trib: '',
}

export function fiscalPayload(v: FiscalValue): ProductFiscalPayload {
  return {
    ncm: v.ncm.trim() || null,
    cfop: v.cfop.trim() || null,
    cst: v.cst.trim() || null,
    csosn: v.csosn.trim() || null,
    cest: v.cest.trim() || null,
    origem: v.origem.trim() || null,
    unidade_fiscal: v.unidade_fiscal.trim() || null,
    ean: v.ean.trim() || null,
    cclass_trib: v.cclass_trib.trim() || null,
  }
}

type Props = {
  value: FiscalValue
  onChange: (patch: Partial<FiscalValue>) => void
  disabled?: boolean
}

/** Dados fiscais do produto (NF-e/NFC-e via módulo Jubilados) -- tudo
 * opcional aqui: produto sem isso configurado simplesmente não pode ser
 * emitido (bloqueado na hora da emissão, com o motivo exato), nunca
 * preenchido com valor inventado. */
export default function FiscalFields({ value, onChange, disabled }: Props) {
  const [cfops, setCfops] = useState<TenantCfop[]>([])

  useEffect(() => {
    adminService.fiscal.cfops
      .list()
      .then(setCfops)
      .catch(() => {})
  }, [])

  const defaultCfop = cfops.find((c) => c.is_default)

  return (
    <div className="rounded-xl border border-son-silver-dim/20 bg-black/20 p-3 space-y-2" data-testid="fiscal-fields">
      <p className="text-xs text-son-silver-dim">
        Fiscal (NF-e/NFC-e) — sem isso preenchido, o produto não pode ser incluído numa nota.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">NCM</label>
          <input
            className="input-field"
            value={value.ncm}
            onChange={(e) => onChange({ ncm: e.target.value })}
            disabled={disabled}
            placeholder="Ex: 61091000"
          />
        </div>
        <div>
          <label className="label">CFOP de saída</label>
          <select
            className="input-field"
            value={value.cfop}
            onChange={(e) => onChange({ cfop: e.target.value })}
            disabled={disabled}
          >
            <option value="">
              {defaultCfop ? `${defaultCfop.codigo} — padrão da empresa` : 'Sem CFOP padrão cadastrado'}
            </option>
            {cfops.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.codigo} — {c.descricao}
              </option>
            ))}
          </select>
          {cfops.length === 0 && (
            <p className="text-[10px] text-son-silver-dim mt-1">
              Cadastre CFOPs em Fiscal → Configuração pra poder escolher aqui.
            </p>
          )}
        </div>
        <div>
          <label className="label">CST</label>
          <input
            className="input-field"
            value={value.cst}
            onChange={(e) => onChange({ cst: e.target.value })}
            disabled={disabled}
            placeholder="Regime normal"
          />
        </div>
        <div>
          <label className="label">CSOSN</label>
          <input
            className="input-field"
            value={value.csosn}
            onChange={(e) => onChange({ csosn: e.target.value })}
            disabled={disabled}
            placeholder="Simples Nacional"
          />
        </div>
        <div>
          <label className="label">CEST</label>
          <input
            className="input-field"
            value={value.cest}
            onChange={(e) => onChange({ cest: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label">Origem (ICMS)</label>
          <select
            className="input-field"
            value={value.origem}
            onChange={(e) => onChange({ origem: e.target.value })}
            disabled={disabled}
          >
            {['0', '1', '2', '3', '4', '5', '6', '7', '8'].map((o) => (
              <option key={o} value={o}>
                {o} {o === '0' ? '(Nacional)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">
            Unidade fiscal <span className="text-amber-400">*</span>
          </label>
          <select
            className="input-field"
            value={value.unidade_fiscal}
            onChange={(e) => onChange({ unidade_fiscal: e.target.value })}
            disabled={disabled}
          >
            <option value="">Selecionar…</option>
            {UNIDADE_FISCAL_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">EAN/GTIN</label>
          <input
            className="input-field"
            value={value.ean}
            onChange={(e) => onChange({ ean: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Classificação Tributária (IBS/CBS)</label>
          <input
            className="input-field"
            value={value.cclass_trib}
            onChange={(e) => onChange({ cclass_trib: e.target.value })}
            disabled={disabled}
            placeholder="Código da tabela oficial"
          />
        </div>
      </div>
    </div>
  )
}
