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

  const [cepLooking, setCepLooking] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)

  useEffect(() => {
    api.fiscalStates().then(setStates).catch(() => {})
  }, [])

  // Carrega o que já foi salvo antes -- sem isso, reabrir a tela sempre
  // parecia "em branco" mesmo pra quem já tinha cadastrado a empresa, e a
  // seção de certificado (só faz sentido depois que a empresa existe no
  // Jubilados) nunca aparecia de novo depois de um F5.
  useEffect(() => {
    api
      .getFiscal()
      .then((existing) => {
        if (!existing) return
        const { jubilados_empresa_id, ...config } = existing
        setForm(config)
        setSavedId(jubilados_empresa_id)
      })
      .catch(() => {})
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

  // Busca o CEP (ViaCEP, Correios) e preenche rua/bairro/UF/município
  // sozinho -- o `ibge` que o ViaCEP devolve já é o código oficial, então
  // nem precisa esperar o dropdown de município carregar pra achar a
  // combinação certa.
  useEffect(() => {
    const digits = form.cep.replace(/\D/g, '')
    if (digits.length !== 8) {
      setCepError(null)
      return
    }
    let cancelled = false
    setCepLooking(true)
    setCepError(null)
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((r) => r.json())
      .then((data: { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string; ibge?: string; complemento?: string }) => {
        if (cancelled) return
        if (data.erro) {
          setCepError('CEP não encontrado.')
          return
        }
        setForm((f) => ({
          ...f,
          logradouro: data.logradouro || f.logradouro,
          bairro: data.bairro || f.bairro,
          complemento: data.complemento || f.complemento,
          uf: data.uf || f.uf,
          municipio: data.localidade || f.municipio,
          municipio_codigo_ibge: data.ibge || f.municipio_codigo_ibge,
        }))
      })
      .catch(() => {
        if (!cancelled) setCepError('Não foi possível consultar o CEP agora.')
      })
      .finally(() => {
        if (!cancelled) setCepLooking(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cep])

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

  const sectionTitle = (text: string) => (
    <p className="text-[11px] font-bold uppercase tracking-wide text-uf-silver-dim/70 mb-2">{text}</p>
  )

  return (
    <div className="uf-glass rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-uf-silver-dim flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Fiscal (NF-e/NFC-e) — cadastro da empresa pra emissão de nota nas vendas.
        </p>
        {savedId && (
          <p className="text-xs text-emerald-400 flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Salvo
          </p>
        )}
      </div>

      {/* Certificado digital — primeiro porque é o que assina a nota, mas só
       * pode ser enviado depois que a empresa existe no Jubilados (savedId). */}
      <div>
        {sectionTitle('Certificado digital')}
        <div className={!savedId ? 'opacity-50 pointer-events-none' : undefined}>
          {!savedId && (
            <p className="text-xs text-uf-silver-dim mb-2">
              Salve os dados da empresa abaixo pra liberar o envio do certificado.
            </p>
          )}
          {certStatus?.valido && (
            <p className="text-sm text-uf-silver flex items-center gap-1.5 mb-2">
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
            className="btn-secondary w-full py-2.5 mt-2 flex items-center justify-center gap-2"
          >
            {certUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Enviar certificado
          </button>
          {certError && <p className="error-msg mt-1">{certError}</p>}
        </div>
        <p className="text-[10px] text-uf-silver-dim/70 flex items-center gap-1 mt-2">
          <ShieldCheck className="w-3 h-3" /> Nunca fica salvo aqui: é validado e repassado direto pro emissor.
        </p>
      </div>

      <div className="border-t border-white/10" />

      {/* Empresa */}
      <div>
        {sectionTitle('Empresa')}
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
        </div>
      </div>

      {/* Endereço — CEP primeiro de propósito: preenche o resto sozinho. */}
      <div>
        {sectionTitle('Endereço')}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label flex items-center gap-1.5">
              CEP * {cepLooking && <Loader2 className="w-3 h-3 animate-spin" />}
            </label>
            <input
              className="input-field"
              value={form.cep}
              onChange={(e) => set('cep', e.target.value)}
              placeholder="Preenche rua/bairro/UF/município sozinho"
            />
            {cepError && <p className="error-msg mt-1">{cepError}</p>}
          </div>
          <div className="col-span-2">
            <label className="label">Logradouro *</label>
            <input className="input-field" value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
          </div>
          <div>
            <label className="label">Bairro *</label>
            <input className="input-field" value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </div>
          <div>
            <label className="label">UF *</label>
            <select className="input-field" value={form.uf} onChange={(e) => set('uf', e.target.value)}>
              <option value="">Selecione a UF</option>
              {states.map((s) => (
                <option key={s.uf} value={s.uf}>
                  {s.uf} — {s.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Cidade *</label>
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
              <option value="">{!form.uf ? 'Escolha a UF primeiro' : loadingCities ? 'Carregando…' : 'Selecione a cidade'}</option>
              {cities.map((c) => (
                <option key={c.codigo_ibge} value={c.codigo_ibge}>
                  {c.nome}
                </option>
              ))}
            </select>
            {citiesError && <p className="error-msg mt-1">{citiesError}</p>}
          </div>
          <div>
            <label className="label">Complemento</label>
            <input className="input-field" value={form.complemento} onChange={(e) => set('complemento', e.target.value)} />
          </div>
          <div>
            <label className="label">Número *</label>
            <input className="input-field" value={form.numero} onChange={(e) => set('numero', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Configuração fiscal */}
      <div>
        {sectionTitle('Configuração fiscal')}
        <div className="grid grid-cols-2 gap-3">
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
