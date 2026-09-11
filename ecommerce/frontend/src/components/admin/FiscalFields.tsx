import { useEffect, useState } from 'react'
import type { ProductFiscalPayload } from '../../types'
import type { ClassificacaoTributariaItem, FiscalProfile, TenantCfop } from '../../lib/api'
import { adminService } from '../../services/adminService'
import CodigoFiscalInput from '../ui/CodigoFiscalInput'
import { isValidCestFormat, isValidNcmFormat } from '../../lib/fiscalValidation'

// Códigos oficiais fixos (Convênio s/n 70/97 Anexo/Ajuste SINIEF 07/05) --
// estáveis há anos, seguros pra hardcode (diferente de CFOP/CEST, que têm
// milhares de linhas e exigem tabela oficial importada pra não arriscar
// inventar código).
export const CST_OPTIONS = [
  { value: '00', label: '00 — Tributada integralmente' },
  { value: '10', label: '10 — Tributada com ST' },
  { value: '20', label: '20 — Com redução de base de cálculo' },
  { value: '30', label: '30 — Isenta/não tributada com ST' },
  { value: '40', label: '40 — Isenta' },
  { value: '41', label: '41 — Não tributada' },
  { value: '50', label: '50 — Suspensão' },
  { value: '51', label: '51 — Diferimento' },
  { value: '60', label: '60 — ICMS cobrado anteriormente por ST' },
  { value: '70', label: '70 — Redução de base + ST' },
  { value: '90', label: '90 — Outras' },
]
export const CSOSN_OPTIONS = [
  { value: '101', label: '101 — Tributada pelo Simples com crédito' },
  { value: '102', label: '102 — Tributada pelo Simples sem crédito' },
  { value: '103', label: '103 — Isenção (faixa de receita bruta)' },
  { value: '201', label: '201 — Tributada pelo Simples com crédito e ST' },
  { value: '202', label: '202 — Tributada pelo Simples sem crédito e ST' },
  { value: '203', label: '203 — Isenção (faixa de receita bruta) e ST' },
  { value: '300', label: '300 — Imune' },
  { value: '400', label: '400 — Não tributada pelo Simples' },
  { value: '500', label: '500 — ICMS cobrado anteriormente por ST/antecipação' },
  { value: '900', label: '900 — Outros' },
]

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
  fiscal_profile_id: string
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
  fiscal_profile_id: '',
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
    fiscal_profile_id: v.fiscal_profile_id.trim() || null,
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
/** Badge que mostra se um campo está herdando do perfil ou foi sobrescrito
 * no produto -- distinção visual explícita pedida (nunca deixar o lojista
 * na dúvida de onde um valor efetivo está vindo). */
function SourceBadge({ overridden }: { overridden: boolean }) {
  return (
    <span
      className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full align-middle ${
        overridden ? 'bg-son-pink/20 text-son-pink' : 'bg-white/10 text-son-silver-dim'
      }`}
    >
      {overridden ? 'sobrescrito' : 'veio do perfil'}
    </span>
  )
}

export default function FiscalFields({ value, onChange, disabled }: Props) {
  const [cfops, setCfops] = useState<TenantCfop[]>([])
  const [profiles, setProfiles] = useState<FiscalProfile[]>([])
  const [classTribList, setClassTribList] = useState<ClassificacaoTributariaItem[]>([])
  const [classTribQuery, setClassTribQuery] = useState('')

  useEffect(() => {
    adminService.fiscal.cfops
      .list()
      .then(setCfops)
      .catch(() => {})
    adminService.fiscal.profiles
      .list()
      .then(setProfiles)
      .catch(() => {})
    adminService.fiscal
      .classificacaoTributaria()
      .then((r) => setClassTribList(r.itens))
      .catch(() => {})
  }, [])

  const selectedProfile = profiles.find((p) => p.id === value.fiscal_profile_id) ?? profiles.find((p) => p.is_default)
  const defaultCfop = cfops.find((c) => c.is_default)
  const classTribSelected = classTribList.find((c) => c.codigo === value.cclass_trib)
  const classTribMatches =
    classTribQuery.trim().length < 2
      ? []
      : classTribList
          .filter(
            (c) =>
              c.codigo.includes(classTribQuery.trim()) ||
              c.descricao.toLowerCase().includes(classTribQuery.trim().toLowerCase())
          )
          .slice(0, 30)

  return (
    <div className="rounded-xl border border-son-silver-dim/20 bg-black/20 p-3 space-y-2" data-testid="fiscal-fields">
      <p className="text-xs text-son-silver-dim">
        Fiscal (NF-e/NFC-e) — sem isso preenchido, o produto não pode ser incluído numa nota.
      </p>
      <div>
        <label className="label">Perfil fiscal</label>
        <select
          className="input-field"
          value={value.fiscal_profile_id}
          onChange={(e) => onChange({ fiscal_profile_id: e.target.value })}
          disabled={disabled}
        >
          <option value="">
            {profiles.find((p) => p.is_default) ? `${profiles.find((p) => p.is_default)!.nome} (padrão)` : 'Sem perfil padrão cadastrado'}
          </option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}{p.is_default ? ' (padrão)' : ''}
            </option>
          ))}
        </select>
        {profiles.length === 0 && (
          <p className="text-[10px] text-son-silver-dim mt-1">
            Cadastre perfis fiscais em Fiscal → Perfis fiscais pra escolher aqui.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CodigoFiscalInput
          label="NCM"
          value={value.ncm}
          onChange={(v) => onChange({ ncm: v })}
          validate={isValidNcmFormat}
          formatHint="8 dígitos"
          placeholder="Ex: 61091000"
          disabled={disabled}
        />
        <div>
          <label className="label">
            CFOP de saída <SourceBadge overridden={!!value.cfop} />
          </label>
          <select
            className="input-field"
            value={value.cfop}
            onChange={(e) => onChange({ cfop: e.target.value })}
            disabled={disabled}
          >
            <option value="">
              {selectedProfile?.cfop
                ? `${selectedProfile.cfop} — do perfil "${selectedProfile.nome}"`
                : defaultCfop
                  ? `${defaultCfop.codigo} — padrão da empresa`
                  : 'Sem CFOP no perfil nem padrão da empresa'}
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
          <label className="label">
            CST (regime normal) <SourceBadge overridden={!!value.cst} />
          </label>
          <select
            className="input-field"
            value={value.cst}
            onChange={(e) => onChange({ cst: e.target.value })}
            disabled={disabled}
          >
            <option value="">{selectedProfile?.cst ? `${selectedProfile.cst} — do perfil` : 'Usar do perfil / padrão da empresa'}</option>
            {CST_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">
            CSOSN (Simples Nacional) <SourceBadge overridden={!!value.csosn} />
          </label>
          <select
            className="input-field"
            value={value.csosn}
            onChange={(e) => onChange({ csosn: e.target.value })}
            disabled={disabled}
          >
            <option value="">{selectedProfile?.csosn ? `${selectedProfile.csosn} — do perfil` : 'Usar do perfil / padrão da empresa'}</option>
            {CSOSN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <CodigoFiscalInput
          label="CEST"
          value={value.cest}
          onChange={(v) => onChange({ cest: v })}
          validate={isValidCestFormat}
          formatHint="7 dígitos, vazio usa o padrão da empresa"
          placeholder="Vazio usa o padrão da empresa"
          disabled={disabled}
        />
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
        <div className="col-span-2 relative">
          <label className="label">
            Classificação Tributária (IBS/CBS) <SourceBadge overridden={!!value.cclass_trib} />
          </label>
          <input
            className="input-field"
            value={classTribSelected ? `${classTribSelected.codigo} — ${classTribSelected.descricao}` : classTribQuery}
            onChange={(e) => {
              setClassTribQuery(e.target.value)
              if (value.cclass_trib) onChange({ cclass_trib: '' })
            }}
            onFocus={() => {
              if (classTribSelected) {
                setClassTribQuery('')
                onChange({ cclass_trib: '' })
              }
            }}
            disabled={disabled}
            placeholder={
              selectedProfile?.cclass_trib
                ? `Vazio usa "${selectedProfile.cclass_trib}" do perfil — pesquise por código ou descrição pra sobrescrever`
                : 'Vazio usa o padrão da empresa — pesquise por código ou descrição pra escolher outro'
            }
          />
          {classTribMatches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-son-surface border border-white/10 rounded-lg shadow-xl">
              {classTribMatches.map((c) => (
                <li key={c.codigo}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ cclass_trib: c.codigo })
                      setClassTribQuery('')
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2"
                  >
                    <span className="font-mono text-xs text-son-silver-dim shrink-0">{c.codigo}</span>
                    <span className="truncate">{c.descricao}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
