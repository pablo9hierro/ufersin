import { useState } from 'react'
import { CheckCircle2, FileText, Loader2, Save } from 'lucide-react'
import { api, ApiError, type FiscalConfigInput } from '../lib/api'

const EMPTY: FiscalConfigInput = {
  cnpj: '',
  razao_social: '',
  nome_fantasia: '',
  inscricao_estadual: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  uf: '',
  cep: '',
  regime_tributario: 'simples_nacional',
  crt: 1,
  ambiente: 'homologacao',
}

/** Meu Plano -> Financeiro -> Fiscal: cadastro da empresa pra emissão de
 * NF-e/NFC-e (módulo Jubilados). Sem GET de leitura ainda -- primeira
 * versão só grava; reabrir a tela pede pra preencher de novo (nunca perde o
 * já salvo no banco, só não pré-popula o formulário). */
export default function FiscalCadastroSection() {
  const [form, setForm] = useState<FiscalConfigInput>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const set = <K extends keyof FiscalConfigInput>(k: K, v: FiscalConfigInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const result = await api.salvarFiscal(form)
      setSavedId(result.jubilados_empresa_id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar os dados fiscais.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="uf-glass rounded-2xl p-6 space-y-4">
      <p className="text-xs text-uf-silver-dim flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Fiscal (NF-e/NFC-e) — cadastro da empresa pra emissão de nota nas vendas.
      </p>
      {savedId && (
        <p className="text-sm text-uf-silver flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Dados fiscais salvos.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">CNPJ *</label>
          <input className="input-field" value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} />
        </div>
        <div>
          <label className="label">Inscrição Estadual</label>
          <input
            className="input-field"
            value={form.inscricao_estadual}
            onChange={(e) => set('inscricao_estadual', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Razão Social *</label>
          <input
            className="input-field"
            value={form.razao_social}
            onChange={(e) => set('razao_social', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Nome Fantasia</label>
          <input
            className="input-field"
            value={form.nome_fantasia}
            onChange={(e) => set('nome_fantasia', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Logradouro *</label>
          <input className="input-field" value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
        </div>
        <div>
          <label className="label">Número *</label>
          <input className="input-field" value={form.numero} onChange={(e) => set('numero', e.target.value)} />
        </div>
        <div>
          <label className="label">Complemento</label>
          <input className="input-field" value={form.complemento} onChange={(e) => set('complemento', e.target.value)} />
        </div>
        <div>
          <label className="label">Bairro *</label>
          <input className="input-field" value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
        </div>
        <div>
          <label className="label">Município *</label>
          <input className="input-field" value={form.municipio} onChange={(e) => set('municipio', e.target.value)} />
        </div>
        <div>
          <label className="label">UF *</label>
          <input
            className="input-field"
            maxLength={2}
            value={form.uf}
            onChange={(e) => set('uf', e.target.value.toUpperCase())}
            placeholder="PB"
          />
        </div>
        <div>
          <label className="label">CEP *</label>
          <input className="input-field" value={form.cep} onChange={(e) => set('cep', e.target.value)} />
        </div>
        <div>
          <label className="label">Regime tributário *</label>
          <select
            className="input-field"
            value={form.regime_tributario}
            onChange={(e) => set('regime_tributario', e.target.value as FiscalConfigInput['regime_tributario'])}
          >
            <option value="simples_nacional">Simples Nacional</option>
            <option value="lucro_presumido">Lucro Presumido</option>
            <option value="lucro_real">Lucro Real</option>
          </select>
        </div>
        <div>
          <label className="label">Ambiente *</label>
          <select
            className="input-field"
            value={form.ambiente}
            onChange={(e) => set('ambiente', e.target.value as FiscalConfigInput['ambiente'])}
          >
            <option value="homologacao">Homologação</option>
            <option value="producao">Produção</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar dados fiscais
      </button>
      {error && <p className="error-msg">{error}</p>}
    </div>
  )
}
