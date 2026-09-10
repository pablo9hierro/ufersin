import { useEffect, useState } from 'react'
import { CheckCircle2, FileText, Loader2, Save, ShieldCheck, Upload } from 'lucide-react'
import {
  api,
  ApiError,
  type CertificadoStatus,
  type FiscalCityOption,
  type FiscalConfigInput,
  type FiscalStateOption,
} from '../lib/api'

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
  municipio_codigo_ibge: '',
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

  const [states, setStates] = useState<FiscalStateOption[]>([])
  const [cities, setCities] = useState<FiscalCityOption[]>([])
  const [loadingCities, setLoadingCities] = useState(false)
  const [citiesError, setCitiesError] = useState<string | null>(null)

  const [certFile, setCertFile] = useState<File | null>(null)
  const [certSenha, setCertSenha] = useState('')
  const [certUploading, setCertUploading] = useState(false)
  const [certError, setCertError] = useState<string | null>(null)
  const [certStatus, setCertStatus] = useState<CertificadoStatus | null>(null)

  useEffect(() => {
    api.fiscalStates().then(setStates).catch(() => {})
  }, [])

  // Município depende da UF -- carrega só depois de escolher a UF (nunca
  // os ~5.570 municípios do Brasil de uma vez), e limpa a seleção anterior
  // se ela pertencer a outra UF.
  useEffect(() => {
    if (!form.uf) {
      setCities([])
      return
    }
    let cancelled = false
    setLoadingCities(true)
    setCitiesError(null)
    api
      .fiscalCities(form.uf)
      .then((list) => {
        if (cancelled) return
        setCities(list)
        if (!list.some((c) => c.codigo_ibge === form.municipio_codigo_ibge)) {
          setForm((f) => ({ ...f, municipio: '', municipio_codigo_ibge: '' }))
        }
      })
      .catch(() => {
        if (!cancelled) setCitiesError('Não foi possível carregar os municípios. Tente de novo.')
      })
      .finally(() => {
        if (!cancelled) setLoadingCities(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.uf])

  const set = <K extends keyof FiscalConfigInput>(k: K, v: FiscalConfigInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const uploadCertificado = async () => {
    if (!certFile || !certSenha) return
    setCertError(null)
    setCertUploading(true)
    try {
      const status = await api.uploadCertificadoFiscal(certFile, certSenha)
      setCertStatus(status)
      setCertFile(null)
      setCertSenha('')
    } catch (e) {
      setCertError(e instanceof ApiError ? e.message : 'Não foi possível validar o certificado.')
    } finally {
      setCertUploading(false)
    }
  }

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
          <label className="label">UF *</label>
          <select
            className="input-field"
            value={form.uf}
            onChange={(e) => set('uf', e.target.value)}
          >
            <option value="">Selecione a UF</option>
            {states.map((s) => (
              <option key={s.uf} value={s.uf}>
                {s.uf} — {s.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Município *</label>
          <select
            className="input-field"
            value={form.municipio_codigo_ibge}
            disabled={!form.uf || loadingCities}
            onChange={(e) => {
              const codigo = e.target.value
              const city = cities.find((c) => c.codigo_ibge === codigo)
              setForm((f) => ({ ...f, municipio_codigo_ibge: codigo, municipio: city?.nome ?? '' }))
            }}
          >
            <option value="">{!form.uf ? 'Escolha a UF primeiro' : loadingCities ? 'Carregando…' : 'Selecione o município'}</option>
            {cities.map((c) => (
              <option key={c.codigo_ibge} value={c.codigo_ibge}>
                {c.nome}
              </option>
            ))}
          </select>
          {citiesError && <p className="error-msg mt-1">{citiesError}</p>}
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

      {savedId && (
        <div className="border-t border-white/10 pt-4 space-y-3">
          <p className="text-xs text-uf-silver-dim flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Certificado digital A1 (.pfx/.p12) — necessário pra assinar a nota
            fiscal. Nunca fica salvo aqui: é validado e repassado direto pro emissor.
          </p>
          {certStatus?.valido && (
            <p className="text-sm text-uf-silver flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Certificado válido{certStatus.titular ? ` — ${certStatus.titular}` : ''}
              {certStatus.dias_restantes != null && ` — vence em ${certStatus.dias_restantes} dias`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Arquivo (.pfx/.p12) *</label>
              <input
                type="file"
                accept=".pfx,.p12"
                className="input-field"
                onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <label className="label">Senha do certificado *</label>
              <input
                type="password"
                className="input-field"
                value={certSenha}
                onChange={(e) => setCertSenha(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={uploadCertificado}
            disabled={certUploading || !certFile || !certSenha}
            className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
          >
            {certUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Enviar certificado
          </button>
          {certError && <p className="error-msg">{certError}</p>}
        </div>
      )}
    </div>
  )
}
