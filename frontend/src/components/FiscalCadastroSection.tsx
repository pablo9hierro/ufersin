import { useEffect, useState } from 'react'
import { CheckCircle2, FileText, Layers, Loader2, Plus, Save, ShieldCheck, Star, Trash2, Upload, X } from 'lucide-react'
import {
  api,
  ApiError,
  FISCAL_ESCOPOS,
  FISCAL_ESCOPOS_OBRIGATORIOS,
  type CertificadoStatus,
  type CfopOption,
  type ClassificacaoTributariaItem,
  type FiscalCityOption,
  type FiscalConfigInput,
  type FiscalDefaults,
  type FiscalEscopo,
  type FiscalProfile,
  type FiscalProfileInput,
  type FiscalStateOption,
  type FiscalTogglesConfig,
} from '../lib/api'

const EMPTY_TOGGLES: FiscalTogglesConfig = {
  emitir_produto: false,
  emitir_servico: false,
  codigo_servico_municipal: '',
  aliquota_iss: null,
  regime_especial_tributacao: '',
}

// Mesma regra de formato de ecommerce/backend fiscal/validation.rs --
// duplicada aqui pra UX (backend sempre revalida).
function isValidCfopFormat(v: string): boolean {
  const d = v.replace(/\D/g, '')
  return d.length === 4 && d !== '0000'
}

// Códigos oficiais fixos (Convênio s/n 70/97 Anexo/Ajuste SINIEF 07/05) --
// não mudam com frequência, seguros pra hardcode (sem tabela de origem
// externa igual CFOP/CEST, que têm milhares de linhas e exigiriam importar
// a base oficial pra não arriscar inventar código).
const CST_OPTIONS = [
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
const CSOSN_OPTIONS = [
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

const EMPTY_PROFILE: FiscalProfileInput = {
  nome: '',
  cfop: null,
  cst: null,
  csosn: null,
  cclass_trib: null,
  allowed_cfops: [],
  escopo: 'outro',
}

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
 * já salvo no banco, só não pré-popula o formulário).
 *
 * `ofereceServicos`: mesmo sinal já usado em MeuPlano.tsx (vertical
 * eletrônicos, ou ecommerce Essential+ que ligou venda de serviço) -- só
 * quando true faz sentido mostrar o checkbox de nota fiscal de serviço
 * (Starter não vende serviço, não faz sentido pra ele). */
export default function FiscalCadastroSection({ ofereceServicos = false }: { ofereceServicos?: boolean }) {
  const [form, setForm] = useState<FiscalConfigInput>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // Toggles reais e independentes -- desligar não apaga nada no banco, só
  // esconde a área correspondente (aqui e no admin da loja/PDV) até religar.
  const [toggles, setToggles] = useState<FiscalTogglesConfig>(EMPTY_TOGGLES)
  const [togglesLoading, setTogglesLoading] = useState(true)
  const [togglesSaving, setTogglesSaving] = useState(false)
  const [togglesSaved, setTogglesSaved] = useState(false)
  const [togglesError, setTogglesError] = useState<string | null>(null)

  const [states, setStates] = useState<FiscalStateOption[]>([])
  const [cities, setCities] = useState<FiscalCityOption[]>([])
  const [loadingCities, setLoadingCities] = useState(false)
  const [citiesError, setCitiesError] = useState<string | null>(null)

  const [certFile, setCertFile] = useState<File | null>(null)
  const [certSenha, setCertSenha] = useState('')
  const [certUploading, setCertUploading] = useState(false)
  const [certError, setCertError] = useState<string | null>(null)
  const [certStatus, setCertStatus] = useState<CertificadoStatus | null>(null)

  // CSC (Código de Segurança do Contribuinte) -- só exigido pra NFC-e
  // (venda de balcão pro consumidor final); diferente do certificado, que
  // vale pra qualquer emissão. Único por empresa/UF, gerado pelo lojista no
  // portal da SEFAZ do próprio estado -- nunca um valor genérico.
  const [cscId, setCscId] = useState('')
  const [cscToken, setCscToken] = useState('')
  const [cscSaving, setCscSaving] = useState(false)
  const [cscError, setCscError] = useState<string | null>(null)
  const [cscSalvo, setCscSalvo] = useState(false)

  const [cepLooking, setCepLooking] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)

  const [cfops, setCfops] = useState<CfopOption[]>([])
  const [cfopQuery, setCfopQuery] = useState('')
  const [cfopResults, setCfopResults] = useState<CfopOption[]>([])
  const [cfopSearching, setCfopSearching] = useState(false)
  const [cfopError, setCfopError] = useState<string | null>(null)

  const [defaults, setDefaults] = useState<FiscalDefaults>({
    cst_padrao: null,
    csosn_padrao: null,
    cest_padrao: null,
    cclass_trib_padrao: null,
  })
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)

  const [classTribList, setClassTribList] = useState<ClassificacaoTributariaItem[]>([])
  const [classTribQuery, setClassTribQuery] = useState('')

  // Perfis fiscais (migration 0056) -- CRUD portado de
  // ecommerce/frontend AdminFiscalPerfis.tsx pra cá (Meu Plano).
  const [profiles, setProfiles] = useState<FiscalProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [profileEditingId, setProfileEditingId] = useState<string | 'new' | null>(null)
  const [profileForm, setProfileForm] = useState<FiscalProfileInput>(EMPTY_PROFILE)
  const [profileSaving, setProfileSaving] = useState(false)
  const [allowedCfopInput, setAllowedCfopInput] = useState('')

  useEffect(() => {
    api.fiscalStates().then(setStates).catch(() => {})
  }, [])

  useEffect(() => {
    api
      .getFiscalToggles()
      .then((t) => setToggles({ ...EMPTY_TOGGLES, ...t }))
      .catch(() => {})
      .finally(() => setTogglesLoading(false))
  }, [])

  const saveToggles = async () => {
    setTogglesError(null)
    setTogglesSaved(false)
    setTogglesSaving(true)
    try {
      await api.salvarFiscalToggles(toggles)
      setTogglesSaved(true)
    } catch (e) {
      setTogglesError(
        e instanceof ApiError ? e.message : 'Não foi possível salvar essa configuração.'
      )
    } finally {
      setTogglesSaving(false)
    }
  }

  // Consulta se a empresa (nova ou já existente no Jubilados, linkada pelo
  // mesmo CNPJ) já tem certificado salvo -- cobre o caso de reaproveitar
  // uma empresa que já tinha certificado configurado antes, sem precisar
  // reenviar o arquivo pra "aparecer" como válido aqui.
  useEffect(() => {
    if (!savedId) return
    api.getCertificadoStatus().then(setCertStatus).catch(() => {})
    api.getCscStatus().then((s) => setCscSalvo(s.salvo)).catch(() => {})
  }, [savedId])

  const salvarCsc = async () => {
    setCscError(null)
    setCscSaving(true)
    try {
      const status = await api.salvarCsc(cscId.trim(), cscToken.trim())
      setCscSalvo(status.salvo)
      setCscId('')
      setCscToken('')
    } catch (e) {
      setCscError(e instanceof ApiError ? e.message : 'Não foi possível salvar o CSC.')
    } finally {
      setCscSaving(false)
    }
  }

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

  useEffect(() => {
    api.cfops.list().then(setCfops).catch(() => {})
  }, [])

  useEffect(() => {
    if (cfopQuery.trim().length < 2) {
      setCfopResults([])
      return
    }
    let cancelled = false
    setCfopSearching(true)
    const t = setTimeout(() => {
      api.cfops
        .search(cfopQuery.trim())
        .then((r) => !cancelled && setCfopResults(r))
        .catch(() => {})
        .finally(() => !cancelled && setCfopSearching(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [cfopQuery])

  const addCfop = async (codigo: string) => {
    setCfopError(null)
    try {
      setCfops(await api.cfops.add(codigo))
      setCfopQuery('')
      setCfopResults([])
    } catch (e) {
      setCfopError(e instanceof ApiError ? e.message : 'Não foi possível adicionar esse CFOP.')
    }
  }

  const removeCfop = async (codigo: string) => {
    try {
      setCfops(await api.cfops.remove(codigo))
    } catch (e) {
      setCfopError(e instanceof ApiError ? e.message : 'Não foi possível remover esse CFOP.')
    }
  }

  const setDefaultCfop = async (codigo: string) => {
    try {
      setCfops(await api.cfops.setDefault(codigo))
    } catch (e) {
      setCfopError(e instanceof ApiError ? e.message : 'Não foi possível definir o padrão.')
    }
  }

  useEffect(() => {
    api.getFiscalDefaults().then(setDefaults).catch(() => {})
    api
      .classificacaoTributaria()
      .then((r) => setClassTribList(r.itens))
      .catch(() => {})
  }, [])

  const saveDefaults = async () => {
    setDefaultsError(null)
    setDefaultsSaved(false)
    setSavingDefaults(true)
    try {
      setDefaults(await api.salvarFiscalDefaults(defaults))
      setDefaultsSaved(true)
    } catch (e) {
      setDefaultsError(e instanceof ApiError ? e.message : 'Não foi possível salvar os padrões fiscais.')
    } finally {
      setSavingDefaults(false)
    }
  }

  const loadProfiles = async () => {
    setProfilesError(null)
    try {
      setProfiles(await api.fiscalProfiles.list())
    } catch (e) {
      setProfilesError(e instanceof ApiError ? e.message : 'Não foi possível carregar os perfis fiscais.')
    } finally {
      setProfilesLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  const startNewProfile = () => {
    setProfileForm(EMPTY_PROFILE)
    setAllowedCfopInput('')
    setProfileEditingId('new')
  }

  const startEditProfile = (p: FiscalProfile) => {
    setProfileForm({
      nome: p.nome,
      cfop: p.cfop,
      cst: p.cst,
      csosn: p.csosn,
      cclass_trib: p.cclass_trib,
      allowed_cfops: p.allowed_cfops,
      escopo: p.escopo,
    })
    setAllowedCfopInput('')
    setProfileEditingId(p.id)
  }

  const cancelEditProfile = () => {
    setProfileEditingId(null)
    setProfileForm(EMPTY_PROFILE)
  }

  const addAllowedCfop = () => {
    const v = allowedCfopInput.trim()
    if (!v || !isValidCfopFormat(v) || profileForm.allowed_cfops.includes(v)) return
    setProfileForm((f) => ({ ...f, allowed_cfops: [...f.allowed_cfops, v] }))
    setAllowedCfopInput('')
  }

  const saveProfile = async () => {
    if (!profileForm.nome.trim()) {
      setProfilesError('Dê um nome pro perfil (ex: "Venda interna PB").')
      return
    }
    setProfileSaving(true)
    setProfilesError(null)
    const payload: FiscalProfileInput = {
      ...profileForm,
      nome: profileForm.nome.trim(),
      cfop: profileForm.cfop?.trim() || null,
      cst: profileForm.cst?.trim() || null,
      csosn: profileForm.csosn?.trim() || null,
      cclass_trib: profileForm.cclass_trib?.trim() || null,
    }
    try {
      const list =
        profileEditingId === 'new'
          ? await api.fiscalProfiles.create(payload)
          : await api.fiscalProfiles.update(profileEditingId as string, payload)
      setProfiles(list)
      cancelEditProfile()
    } catch (e) {
      setProfilesError(e instanceof ApiError ? e.message : 'Não foi possível salvar o perfil fiscal.')
    } finally {
      setProfileSaving(false)
    }
  }

  const removeProfile = async (p: FiscalProfile) => {
    if (!window.confirm(`Excluir o perfil "${p.nome}"? Produtos vinculados a ele deixam de ter CFOP/CST/CSOSN efetivo até você linkar outro perfil.`)) return
    try {
      setProfiles(await api.fiscalProfiles.delete(p.id))
    } catch (e) {
      setProfilesError(e instanceof ApiError ? e.message : 'Não foi possível excluir o perfil.')
    }
  }

  const setDefaultProfile = async (p: FiscalProfile) => {
    try {
      setProfiles(await api.fiscalProfiles.setDefault(p.id))
    } catch (e) {
      setProfilesError(e instanceof ApiError ? e.message : 'Não foi possível definir o perfil padrão.')
    }
  }

  const escoposPresentes = new Set(profiles.map((p) => p.escopo))

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
  const classTribSelected = classTribList.find((c) => c.codigo === defaults.cclass_trib_padrao)

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

  const toggleProduto = async (checked: boolean) => {
    const next = { ...toggles, emitir_produto: checked }
    setToggles(next)
    setTogglesError(null)
    setTogglesSaving(true)
    try {
      await api.salvarFiscalToggles(next)
    } catch (e) {
      setToggles(toggles) // reverte se não salvou
      setTogglesError(e instanceof ApiError ? e.message : 'Não foi possível salvar essa configuração.')
    } finally {
      setTogglesSaving(false)
    }
  }

  const toggleServico = async (checked: boolean) => {
    const next = { ...toggles, emitir_servico: checked }
    setToggles(next)
    setTogglesError(null)
    setTogglesSaving(true)
    try {
      await api.salvarFiscalToggles(next)
    } catch (e) {
      setToggles(toggles)
      setTogglesError(e instanceof ApiError ? e.message : 'Não foi possível salvar essa configuração.')
    } finally {
      setTogglesSaving(false)
    }
  }

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

      <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={toggles.emitir_produto}
          disabled={togglesLoading || togglesSaving}
          onChange={(e) => toggleProduto(e.target.checked)}
          className="w-4 h-4 mt-0.5"
        />
        <span className="text-sm">
          <span className="block font-semibold">Emitir nota fiscal</span>
          <span className="block text-xs text-uf-silver-dim mt-0.5">
            Desligado, sua loja vende sem nota fiscal — nada some do que você já cadastrou aqui, é só desativado.
            Religue quando quiser voltar a emitir.
          </span>
        </span>
      </label>
      {togglesError && <p className="error-msg">{togglesError}</p>}

      {!toggles.emitir_produto && !togglesLoading ? (
        <p className="text-sm text-uf-silver-dim uf-glass rounded-xl p-4">
          Emissão de nota fiscal de produto desligada. Marque a caixa acima pra ver e configurar os dados fiscais da
          empresa.
        </p>
      ) : (
      <>
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

      {/* CSC (Código de Segurança do Contribuinte) -- só exigido pra NFC-e
       * (venda de balcão pro consumidor final), diferente do certificado
       * (exigido pra qualquer emissão). Único por empresa/UF -- o lojista
       * gera no portal da SEFAZ do próprio estado, nunca um valor genérico
       * nem compartilhado entre lojas. Sem isso, NFC-e (mas não NF-e) falha
       * com "Empresa não possui CSC configurado". */}
      <div>
        {sectionTitle('CSC — Código de Segurança do Contribuinte (só pra NFC-e)')}
        <div className={!savedId ? 'opacity-50 pointer-events-none' : undefined}>
          {!savedId && (
            <p className="text-xs text-uf-silver-dim mb-2">
              Salve os dados da empresa acima pra liberar o cadastro do CSC.
            </p>
          )}
          {cscSalvo && (
            <p className="text-sm text-uf-silver flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              CSC já cadastrado — envie de novo só se a SEFAZ gerar um código diferente.
            </p>
          )}
          <p className="text-xs text-uf-silver-dim mb-2">
            Gerado no portal de NFC-e da SEFAZ do seu estado (credenciamento como emissor de NFC-e) — é único pra
            essa empresa, não é um valor genérico.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">CSC ID *</label>
              <input className="input-field" value={cscId} onChange={(e) => setCscId(e.target.value)} placeholder="ex: 1" />
            </div>
            <div>
              <label className="label">CSC Token *</label>
              <input
                type="password"
                className="input-field"
                value={cscToken}
                onChange={(e) => setCscToken(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={salvarCsc}
            disabled={cscSaving || !cscId.trim() || !cscToken.trim()}
            className="btn-secondary w-full py-2.5 mt-2 flex items-center justify-center gap-2"
          >
            {cscSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar CSC
          </button>
          {cscError && <p className="error-msg mt-1">{cscError}</p>}
        </div>
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

      {/* Dados fiscais de emissão -- CFOP de saída, CST/CSOSN, CEST e
       * Classificação Tributária (IBS/CBS) padrão da empresa. Produto sem
       * valor específico herda isso automaticamente (já cadastrados e
       * novos); pra uma exceção, edita o produto e escolhe outro valor por
       * busca lá. Alíquotas/valores de ICMS/IPI são calculados pelo
       * Jubilados por item na hora da emissão, não cadastrados aqui. */}
      <div>
        {sectionTitle('Dados fiscais de emissão')}
        <p className="text-xs text-uf-silver-dim mb-2">
          CFOPs de saída — novos produtos e produtos sem CFOP específico usam o marcado PADRÃO automaticamente. Você
          pode sobrescrever em cada produto, no painel da loja.
        </p>
        {cfops.length > 0 && (
          <ul className="space-y-1.5 mb-2">
            {cfops.map((c) => (
              <li key={c.codigo} className="flex items-center gap-2 text-sm uf-glass rounded-lg px-3 py-2">
                <span className="font-mono text-xs text-uf-silver-dim">{c.codigo}</span>
                <span className="flex-1 truncate">{c.descricao}</span>
                {c.is_default ? (
                  <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                    <Star className="w-3 h-3 fill-emerald-400" /> PADRÃO
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDefaultCfop(c.codigo)}
                    className="text-[10px] text-uf-silver-dim hover:text-emerald-400 shrink-0"
                  >
                    tornar padrão
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeCfop(c.codigo)}
                  className="text-uf-silver-dim hover:text-red-400 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <input
            className="input-field w-full"
            placeholder="Pesquisar CFOP (código ou descrição)…"
            value={cfopQuery}
            onChange={(e) => setCfopQuery(e.target.value)}
          />
          {(cfopSearching || cfopResults.length > 0) && (
            <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto uf-glass rounded-lg shadow-xl">
              {cfopSearching && <li className="px-3 py-2 text-xs text-uf-silver-dim">Buscando…</li>}
              {cfopResults.map((r) => (
                <li key={r.codigo}>
                  <button
                    type="button"
                    onClick={() => addCfop(r.codigo)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5 text-uf-silver-dim shrink-0" />
                    <span className="font-mono text-xs text-uf-silver-dim shrink-0">{r.codigo}</span>
                    <span className="truncate">{r.descricao}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {cfopError && <p className="error-msg mt-1">{cfopError}</p>}

        <div className="grid grid-cols-2 gap-3 mt-4">
          {form.regime_tributario === 'simples_nacional' ? (
            <div>
              <label className="label">CSOSN padrão</label>
              <select
                className="input-field"
                value={defaults.csosn_padrao ?? ''}
                onChange={(e) => setDefaults((d) => ({ ...d, csosn_padrao: e.target.value || null }))}
              >
                <option value="">Selecionar…</option>
                {CSOSN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="label">CST padrão</label>
              <select
                className="input-field"
                value={defaults.cst_padrao ?? ''}
                onChange={(e) => setDefaults((d) => ({ ...d, cst_padrao: e.target.value || null }))}
              >
                <option value="">Selecionar…</option>
                {CST_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">CEST padrão</label>
            <input
              className="input-field"
              value={defaults.cest_padrao ?? ''}
              onChange={(e) => setDefaults((d) => ({ ...d, cest_padrao: e.target.value || null }))}
              placeholder="Sem tabela nacional só de CEST — digite se souber"
            />
          </div>
          <div className="col-span-2 relative">
            <label className="label">Classificação Tributária padrão (IBS/CBS)</label>
            <input
              className="input-field"
              value={classTribSelected ? `${classTribSelected.codigo} — ${classTribSelected.descricao}` : classTribQuery}
              onChange={(e) => {
                setClassTribQuery(e.target.value)
                if (defaults.cclass_trib_padrao) setDefaults((d) => ({ ...d, cclass_trib_padrao: null }))
              }}
              onFocus={() => {
                if (classTribSelected) {
                  setClassTribQuery('')
                  setDefaults((d) => ({ ...d, cclass_trib_padrao: null }))
                }
              }}
              placeholder="Pesquisar por código ou descrição…"
            />
            {classTribMatches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto uf-glass rounded-lg shadow-xl">
                {classTribMatches.map((c) => (
                  <li key={c.codigo}>
                    <button
                      type="button"
                      onClick={() => {
                        setDefaults((d) => ({ ...d, cclass_trib_padrao: c.codigo }))
                        setClassTribQuery('')
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2"
                    >
                      <span className="font-mono text-xs text-uf-silver-dim shrink-0">{c.codigo}</span>
                      <span className="truncate">{c.descricao}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={saveDefaults}
          disabled={savingDefaults}
          className="btn-secondary w-full py-2.5 mt-3 flex items-center justify-center gap-2"
        >
          {savingDefaults ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar padrões fiscais
        </button>
        {defaultsSaved && <p className="text-xs text-emerald-400 mt-1">Padrões salvos.</p>}
        {defaultsError && <p className="error-msg mt-1">{defaultsError}</p>}
      </div>

      <div className="border-t border-white/10" />

      {/* Perfis fiscais (migration 0056) -- portado do admin da loja pra cá.
       * O checklist abaixo mostra de cara se os 4 escopos obrigatórios pra
       * emissão automática (auto_emitir) já existem, sem o lojista ter que
       * adivinhar (ver ecommerce/backend fiscal.rs::update_settings). */}
      <div>
        {sectionTitle('Perfis fiscais')}
        <p className="text-xs text-uf-silver-dim mb-2">
          Cada perfil agrupa CFOP/CST/CSOSN/Classificação Tributária pra um tipo de venda. A venda escolhe o perfil
          automaticamente pelo escopo (ex: cliente de outro estado) — o produto não precisa ser editado.
        </p>

        <div className="uf-glass rounded-lg p-3 mb-3 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-uf-silver-dim/70 mb-1">
            Escopos obrigatórios pra emissão automática
          </p>
          {FISCAL_ESCOPOS_OBRIGATORIOS.map((escopo) => {
            const ok = escoposPresentes.has(escopo)
            const label = FISCAL_ESCOPOS.find((e) => e.value === escopo)?.label ?? escopo
            return (
              <div key={escopo} className="flex items-center gap-1.5 text-sm">
                {ok ? <span className="text-emerald-400">✅</span> : <span className="text-red-400">❌</span>}
                {label}
              </div>
            )
          })}
        </div>

        {profilesError && <p className="error-msg mb-2">{profilesError}</p>}

        {profilesLoading ? (
          <div className="flex items-center gap-2 text-uf-silver-dim text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando perfis fiscais…
          </div>
        ) : profileEditingId ? (
          <div className="uf-glass rounded-lg p-3 space-y-3">
            <div>
              <label className="label">Nome do perfil</label>
              <input
                className="input-field"
                placeholder='ex: "Venda interna PB"'
                value={profileForm.nome}
                onChange={(e) => setProfileForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Escopo</label>
              <select
                className="input-field"
                value={profileForm.escopo}
                onChange={(e) => setProfileForm((f) => ({ ...f, escopo: e.target.value as FiscalEscopo }))}
              >
                {FISCAL_ESCOPOS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">CFOP</label>
                <input
                  className="input-field"
                  placeholder="ex: 5102"
                  value={profileForm.cfop ?? ''}
                  onChange={(e) => setProfileForm((f) => ({ ...f, cfop: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Classificação Tributária (IBS/CBS)</label>
                <input
                  className="input-field"
                  value={profileForm.cclass_trib ?? ''}
                  onChange={(e) => setProfileForm((f) => ({ ...f, cclass_trib: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">CST (regime normal)</label>
                <select
                  className="input-field"
                  value={profileForm.cst ?? ''}
                  onChange={(e) => setProfileForm((f) => ({ ...f, cst: e.target.value }))}
                >
                  <option value="">Não define (usar CSOSN)</option>
                  {CST_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">CSOSN (Simples Nacional)</label>
                <select
                  className="input-field"
                  value={profileForm.csosn ?? ''}
                  onChange={(e) => setProfileForm((f) => ({ ...f, csosn: e.target.value }))}
                >
                  <option value="">Não define (usar CST)</option>
                  {CSOSN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">CFOPs alternativos habilitados neste perfil</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {profileForm.allowed_cfops.map((cfop) => (
                  <span key={cfop} className="inline-flex items-center gap-1 text-xs bg-white/10 rounded-full pl-2.5 pr-1 py-1">
                    {cfop}
                    <button
                      type="button"
                      onClick={() => setProfileForm((f) => ({ ...f, allowed_cfops: f.allowed_cfops.filter((c) => c !== cfop) }))}
                      className="p-0.5 rounded-full hover:bg-white/10"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input-field flex-1"
                  value={allowedCfopInput}
                  onChange={(e) => setAllowedCfopInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAllowedCfop())}
                  placeholder="ex: 5949"
                />
                <button type="button" onClick={addAllowedCfop} disabled={!allowedCfopInput.trim()} className="btn-secondary px-3">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveProfile}
                disabled={profileSaving}
                className="btn-primary flex-1 py-2.5 flex items-center justify-center gap-2"
              >
                {profileSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar perfil
              </button>
              <button type="button" onClick={cancelEditProfile} className="btn-secondary px-4">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={startNewProfile} className="btn-primary py-2 px-4 flex items-center gap-2 mb-3">
            <Plus className="w-4 h-4" /> Novo perfil
          </button>
        )}

        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          {profiles.map((p) => (
            <div key={p.id} className="uf-glass rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-1.5 text-sm">
                  <Layers className="w-3.5 h-3.5" />
                  {p.nome}
                  {p.is_default && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
                </h3>
                <div className="flex gap-1">
                  {!p.is_default && (
                    <button
                      type="button"
                      onClick={() => setDefaultProfile(p)}
                      title="Definir como padrão"
                      className="p-1.5 rounded hover:bg-white/10 text-uf-silver-dim"
                    >
                      <Star className="w-4 h-4" />
                    </button>
                  )}
                  <button type="button" onClick={() => removeProfile(p)} title="Excluir" className="p-1.5 rounded hover:bg-white/10 text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="text-xs text-uf-silver-dim space-y-0.5">
                <div>Escopo: {FISCAL_ESCOPOS.find((e) => e.value === p.escopo)?.label ?? p.escopo}</div>
                <div>CFOP: {p.cfop ?? '—'}{p.allowed_cfops.length > 0 && ` (+${p.allowed_cfops.length} alternativo${p.allowed_cfops.length > 1 ? 's' : ''})`}</div>
                <div>CST/CSOSN: {p.cst ?? p.csosn ?? '—'}</div>
              </div>
              <button type="button" onClick={() => startEditProfile(p)} className="text-xs underline text-uf-silver-dim">
                Editar
              </button>
            </div>
          ))}
          {profiles.length === 0 && !profileEditingId && !profilesLoading && (
            <p className="text-sm text-uf-silver-dim">Nenhum perfil fiscal cadastrado ainda.</p>
          )}
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
      </>
      )}

      {ofereceServicos && (
        <>
          <div className="border-t border-white/10" />
          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={toggles.emitir_servico}
              disabled={togglesLoading || togglesSaving}
              onChange={(e) => toggleServico(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span className="text-sm">
              <span className="block font-semibold">Emitir nota fiscal de serviço</span>
              <span className="block text-xs text-uf-silver-dim mt-0.5">
                Pra ordens de serviço/atendimento (NFS-e) — separado da nota de produto acima. Desligar esconde essa
                área sem apagar nada; religue quando quiser.
              </span>
            </span>
          </label>

          {toggles.emitir_servico && (
            <div className="uf-glass rounded-xl p-4 space-y-3">
              {sectionTitle('Dados fiscais de serviço')}
              <p className="text-xs text-uf-silver-dim">
                Esses dados são específicos de nota de serviço (NFS-e) — CNPJ, endereço e certificado já cadastrados
                acima em "Empresa" são reaproveitados, não precisa repetir.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Código de serviço municipal</label>
                  <input
                    className="input-field"
                    value={toggles.codigo_servico_municipal ?? ''}
                    onChange={(e) => setToggles((t) => ({ ...t, codigo_servico_municipal: e.target.value }))}
                    placeholder="Consulte a prefeitura do seu município"
                  />
                </div>
                <div>
                  <label className="label">Alíquota ISS (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input-field"
                    value={toggles.aliquota_iss ?? ''}
                    onChange={(e) =>
                      setToggles((t) => ({ ...t, aliquota_iss: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Regime especial de tributação</label>
                  <input
                    className="input-field"
                    value={toggles.regime_especial_tributacao ?? ''}
                    onChange={(e) => setToggles((t) => ({ ...t, regime_especial_tributacao: e.target.value }))}
                    placeholder="ex: Simples Nacional, MEI…"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={saveToggles}
                disabled={togglesSaving}
                className="btn-secondary w-full py-2.5 flex items-center justify-center gap-2"
              >
                {togglesSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar dados de serviço
              </button>
              {togglesSaved && <p className="text-xs text-emerald-400">Salvo.</p>}
              <p className="text-[10px] text-uf-silver-dim/70">
                A emissão automática de NFS-e (chamada à prefeitura) ainda não está disponível — por enquanto isso
                guarda o cadastro pra quando esse módulo for lançado.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
