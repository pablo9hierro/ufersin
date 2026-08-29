import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AtSign, CheckCircle2, CreditCard, Loader2, LogOut, Rocket, Store, Upload } from 'lucide-react'
import { api, ApiError, type MeResponse, type TipoDocumento } from '../lib/api'
import { authStore, useAuthReady, useIsAuthenticated } from '../lib/authStore'
import AddressField from '../components/AddressField'
import { isValidDocumento, onlyDigits } from '../lib/documento'
import { planDisplayName, verticalForPlan } from '../lib/plans'
import { needsOnboardingLock, storeAlreadyExists } from '../lib/postPayRedirect'
import type { StorefrontStyle } from '../lib/storefrontStyles'

// Endereço digitado/selecionado no onboarding se perdia toda vez que o
// lojista saía pra conectar o Mercado Pago (redirect de página inteira) e
// voltava — nada tinha sido salvo no servidor ainda. Guarda um rascunho
// local, restaurado com prioridade sobre o que veio do servidor (que
// nesse momento ainda não tem o endereço de jeito nenhum).
const ADDRESS_DRAFT_KEY = 'resolutoo_onboarding_endereco_draft'

function saveAddressDraft(endereco: string, numero: string) {
  try {
    if (!endereco.trim()) {
      localStorage.removeItem(ADDRESS_DRAFT_KEY)
      return
    }
    localStorage.setItem(ADDRESS_DRAFT_KEY, JSON.stringify({ endereco, numero }))
  } catch {
    /* localStorage indisponível — segue sem persistir */
  }
}

function loadAddressDraft(): { endereco: string; numero: string } | null {
  try {
    const raw = localStorage.getItem(ADDRESS_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.endereco === 'string') {
      return { endereco: parsed.endereco, numero: typeof parsed.numero === 'string' ? parsed.numero : '' }
    }
    return null
  } catch {
    return null
  }
}

function clearAddressDraft() {
  try {
    localStorage.removeItem(ADDRESS_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

const CORES_DEFAULT = '#0f5132'
/** Full = first-time; complementary = upgrade (prefill + delta); skip = already provisioned. */
type OnboardingMode = 'loading' | 'full' | 'complementary' | 'skip'

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function formatDocumento(tipo: TipoDocumento, value: string) {
  const digits = onlyDigits(value)
  if (tipo === 'cpf') {
    return digits
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digits
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

function applyMePrefill(me: MeResponse): {
  nomeLoja: string
  tipoDocumento: TipoDocumento
  documento: string
  endereco: string
  enderecoNumero: string
  instagram: string
  facebook: string
  logoUrl: string
  landingHeroImageUrl: string
  venderExternamente: boolean
  vendeMais18: boolean
  apenasRetirada: boolean
  ofereceServicos: boolean
  pagamentoNaRetirada: boolean
  entregaSomentePix: boolean
  layoutStyle: StorefrontStyle
  hasCreds: boolean
} {
  const tipo = (me.tipo_documento === 'cpf' ? 'cpf' : 'cnpj') as TipoDocumento
  const layout =
    me.layout_style === 'burgerbite' || me.layout_style === 'burgerhouse' || me.layout_style === 'ufersin'
      ? me.layout_style
      : 'ufersin'
  return {
    nomeLoja: me.loja_nome?.trim() || '',
    tipoDocumento: tipo,
    documento: me.documento ? formatDocumento(tipo, me.documento) : '',
    endereco: me.endereco?.trim() || '',
    enderecoNumero: me.endereco_numero?.trim() || '',
    instagram: (me.instagram || '').replace(/^@/, ''),
    facebook: (me.facebook || '').replace(/^@/, ''),
    logoUrl: me.logo_url || '',
    landingHeroImageUrl: me.landing_hero_image_url || '',
    venderExternamente: me.vender_externamente !== false,
    vendeMais18: Boolean(me.vende_mais_18),
    apenasRetirada: Boolean(me.apenas_retirada),
    ofereceServicos: Boolean(me.oferece_servicos),
    pagamentoNaRetirada: Boolean(me.pagamento_na_retirada),
    entregaSomentePix: Boolean(me.entrega_somente_pix),
    layoutStyle: layout,
    hasCreds: Boolean(me.has_plataforma_credenciais),
  }
}

/** Etapa 1 — após pagamento. Never shows blank form when store data already exists. */
export default function Onboarding() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()

  const [mode, setMode] = useState<OnboardingMode>('loading')
  const [planLabel, setPlanLabel] = useState<string | null>(null)
  const [hasCreds, setHasCreds] = useState(false)
  const [connectingMp, setConnectingMp] = useState(false)
  const [disconnectingMp, setDisconnectingMp] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [nomeLoja, setNomeLoja] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('cnpj')
  const [documento, setDocumento] = useState('')
  const [endereco, setEndereco] = useState('')
  const [enderecoNumero, setEnderecoNumero] = useState('')
  const [instagram, setInstagram] = useState('')
  const [facebook, setFacebook] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [landingHeroImageUrl, setLandingHeroImageUrl] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingHero, setUploadingHero] = useState(false)
  const [venderExternamente, setVenderExternamente] = useState(true)
  const [vendeMais18, setVendeMais18] = useState(false)
  const [apenasRetirada, setApenasRetirada] = useState(false)
  const [ofereceServicos, setOfereceServicos] = useState(false)
  const [pagamentoNaRetirada, setPagamentoNaRetirada] = useState(false)
  // Regra fixa do plano essential — entrega só sai com pagamento prévio
  // (Pix/cartão), dinheiro só na retirada/PDV. Sem toggle: sempre true.
  const entregaSomentePix = true
  const [layoutStyle, setLayoutStyle] = useState<StorefrontStyle>('ufersin')
  // Ramo do negócio — decide qual onboarding/site o lojista recebe. null =
  // ainda não escolheu (só pra loja nova; complementary/já provisionado
  // pula direto, o ramo já foi decidido na primeira vez).
  const [vertical, setVertical] = useState<'ecommerce' | 'eletronicos' | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Salva a cada mudança — sobrevive ao redirect de página inteira pra
  // conectar o Mercado Pago (nada foi salvo no servidor até esse ponto).
  useEffect(() => {
    saveAddressDraft(endereco, enderecoNumero)
  }, [endereco, enderecoNumero])

  useEffect(() => {
    if (!ready || !isAuthenticated) return
    let cancelled = false
    setLoadError(null)
    setMode('loading')

    ;(async () => {
      try {
        const me = await api.me()
        if (cancelled) return

        setPlanLabel(me.plano ? planDisplayName(me.plano) : null)
        // Ramo vem do PLANO assinado, nunca de uma escolha solta aqui. O
        // backend resolve de novo server-side (plans::vertical_for) e
        // ignora o que mandarmos -- isto é só pra UI já montar o formulário
        // certo (eletrônicos não usa o seletor de tema de vitrine).
        if (me.plano) setVertical(verticalForPlan(me.plano))
        const pre = applyMePrefill(me)
        setNomeLoja(pre.nomeLoja)
        setTipoDocumento(pre.tipoDocumento)
        setDocumento(pre.documento)
        // Rascunho local (endereço digitado antes de sair pra conectar o
        // Mercado Pago) tem prioridade — o servidor ainda não tem esse dado.
        const draft = loadAddressDraft()
        setEndereco(draft?.endereco || pre.endereco)
        setEnderecoNumero(draft?.numero || pre.enderecoNumero)
        setInstagram(pre.instagram)
        setFacebook(pre.facebook)
        setLogoUrl(pre.logoUrl)
        setLandingHeroImageUrl(pre.landingHeroImageUrl)
        setVenderExternamente(pre.venderExternamente)
        setVendeMais18(pre.vendeMais18)
        setApenasRetirada(pre.apenasRetirada)
        setOfereceServicos(pre.ofereceServicos)
        setPagamentoNaRetirada(pre.pagamentoNaRetirada)
        setLayoutStyle(pre.layoutStyle)
        setHasCreds(pre.hasCreds)

        // Stay on /onboarding until lock clears (provisionado / store ready).
        if (!needsOnboardingLock(me)) {
          setMode('skip')
          if (!cancelled) navigate('/meu-plano', { replace: true })
          return
        }

        // Upgrade complementary (BE set aguardando_onboarding + store exists).
        if (storeAlreadyExists(me) && me.onboarding_status === 'aguardando_onboarding') {
          // Ramo já foi decidido lá na primeira vez — nunca perguntar de novo.
          setVertical(me.vertical)
          setMode('complementary')
          return
        }

        // Brand-new store — full onboarding (may still prefill loja_nome from cadastro).
        setMode('full')
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof ApiError ? e.message : 'Não foi possível carregar os dados da loja.')
        setMode('loading')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, isAuthenticated, navigate, reloadKey])

  if (!ready || mode === 'loading' || mode === 'skip') {
    return (
      <main className="min-h-screen bg-uf-black flex flex-col items-center justify-center gap-4 px-5">
        {loadError ? (
          <>
            <p className="text-sm text-red-400 text-center max-w-md">{loadError}</p>
            <button type="button" className="btn-primary px-6 py-3" onClick={() => setReloadKey((k) => k + 1)}>
              Tentar de novo
            </button>
          </>
        ) : (
          <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
        )}
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const complementary = mode === 'complementary'
  const mpTokenRequired = !hasCreds
  const returning = complementary || Boolean(nomeLoja || documento || endereco)

  const handleLogout = async () => {
    // Não navega na mão — Landing.tsx redireciona usuário logado de volta
    // pra /onboarding, e signOut() ainda não tinha propagado a tempo (corrida),
    // então "sair" só te devolvia pra mesma tela. O próprio isAuthenticated
    // reativo aqui embaixo já joga pra /login assim que a sessão cair.
    await authStore.signOut('lojista')
  }

  const finishOk = () => {
    clearAddressDraft()
    setDone(true)
    setTimeout(() => navigate('/meu-plano'), 1800)
  }

  const handleConnectMp = async () => {
    setError(null)
    setConnectingMp(true)
    try {
      const { authorize_url } = await api.mercadoPagoOAuthStart()
      window.location.href = authorize_url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conectar o Mercado Pago.')
      setConnectingMp(false)
    }
  }

  const handleDisconnectMp = async () => {
    setError(null)
    setDisconnectingMp(true)
    try {
      await api.mercadoPagoOAuthDisconnect()
      setHasCreds(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível desconectar o Mercado Pago.')
    } finally {
      setDisconnectingMp(false)
    }
  }

  const handleLogoUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploadingLogo(true)
    try {
      const { url } = await api.uploadLogo(file)
      setLogoUrl(url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar a logo.')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleHeroUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploadingHero(true)
    try {
      const { url } = await api.uploadLogo(file)
      setLandingHeroImageUrl(url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar a imagem do hero.')
    } finally {
      setUploadingHero(false)
    }
  }

  const handleKeepCurrent = async () => {
    setError(null)
    if (mpTokenRequired) {
      setError('Conecte sua conta Mercado Pago pra continuar.')
      return
    }
    setLoading(true)
    try {
      await api.editarOnboarding({
        facebook: facebook.trim().replace(/^@/, ''),
        logo_url: logoUrl.trim(),
        landing_hero_image_url: landingHeroImageUrl.trim(),
      })
      finishOk()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!nomeLoja.trim()) return setError('Informe o nome da empresa.')
    if (!endereco.trim()) return setError('Informe o endereço da loja.')
    if (mpTokenRequired) {
      return setError('Conecte sua conta Mercado Pago pra concluir o cadastro.')
    }
    if (!isValidDocumento(tipoDocumento, documento)) {
      return setError('Não conseguimos capturar seu CPF/CNPJ do Mercado Pago — desconecte e reconecte sua conta.')
    }

    const slug = slugify(nomeLoja) || `loja-${Date.now().toString(36)}`
    setLoading(true)
    try {
      if (complementary) {
        await api.editarOnboarding({
          nome_loja: nomeLoja.trim(),
          endereco: endereco.trim(),
          endereco_numero: enderecoNumero.trim() || undefined,
          documento: onlyDigits(documento),
          tipo_documento: tipoDocumento,
          instagram: instagram.trim().replace(/^@/, ''),
          facebook: facebook.trim().replace(/^@/, ''),
          logo_url: logoUrl.trim(),
          landing_hero_image_url: landingHeroImageUrl.trim(),
          vender_externamente: venderExternamente,
          vende_mais_18: vendeMais18,
          apenas_retirada: apenasRetirada,
          oferece_servicos: ofereceServicos,
          pagamento_na_retirada: pagamentoNaRetirada,
          entrega_somente_pix: entregaSomentePix,
          whatsapp_habilitado: true,
          layout_style: venderExternamente ? layoutStyle : 'ufersin',
        })
      } else {
        await api.onboarding({
          nome_loja: nomeLoja.trim(),
          categoria: 'Outro',
          whatsapp: '',
          endereco: endereco.trim(),
          endereco_numero: enderecoNumero.trim() || undefined,
          logo_url: logoUrl.trim() || undefined,
          cor_principal: CORES_DEFAULT,
          slug,
          documento: onlyDigits(documento),
          tipo_documento: tipoDocumento,
          instagram: instagram.trim().replace(/^@/, ''),
          facebook: facebook.trim().replace(/^@/, ''),
          vender_externamente: venderExternamente,
          vende_mais_18: vendeMais18,
          apenas_retirada: apenasRetirada,
          oferece_servicos: ofereceServicos,
          pagamento_na_retirada: pagamentoNaRetirada,
          entrega_somente_pix: entregaSomentePix,
          whatsapp_habilitado: true,
          layout_style: venderExternamente ? layoutStyle : 'ufersin',
          vertical: vertical ?? 'ecommerce',
          // O backend valida forma_pagamento no próprio corpo do cadastro
          // inicial (não só o que o callback OAuth já gravou no banco) —
          // sem mandar isso aqui, POST /api/onboarding sempre rejeitava
          // com "informe o Access Token do Mercado Pago", mesmo já
          // conectado (mpTokenRequired garante isso antes de chegar aqui).
          forma_pagamento: 'plataforma',
          plataforma_pagamento: 'mercado_pago',
        })
        // OnboardingInput (criação inicial) não tem landing_hero_image_url —
        // só editar_onboarding aceita, e só depois do tenant provisionado.
        if (landingHeroImageUrl.trim()) {
          await api.editarOnboarding({ landing_hero_image_url: landingHeroImageUrl.trim() })
        }
      }
      finishOk()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível finalizar o onboarding.')
    } finally {
      setLoading(false)
    }
  }

  // O ramo NÃO é mais perguntado aqui: ele vem do plano que o lojista
  // assinou (card exclusivo de assistência técnica na landing), e o backend
  // o resolve de novo server-side. Perguntar de novo permitia assinar um
  // ramo e receber o outro. `vertical` só fica null enquanto /api/me não
  // respondeu -- nesse instante o formulário ainda não deve renderizar.
  if (mode === 'full' && vertical === null) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }

  if (done) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-black mb-2">{complementary ? 'Plano atualizado!' : 'Painel liberado!'}</h1>
          <p className="text-sm text-uf-silver-dim">
            {complementary
              ? 'Sua loja e dados anteriores foram preservados.'
              : 'No primeiro acesso à loja você conclui WhatsApp e horário de funcionamento.'}
          </p>
        </motion.div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mx-auto relative z-10 max-w-2xl"
      >
        <div className="flex justify-end mb-2">
          <button type="button" onClick={handleLogout} className="btn-ghost text-sm">
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>

        <div className="text-center mb-8">
          <span className="uf-eyebrow mb-4">{complementary ? 'Upgrade' : 'Onboarding'}</span>
          <h1 className="text-2xl sm:text-3xl font-black mt-4">
            {complementary
              ? `Complementos do plano ${planLabel ?? 'novo'}`
              : 'Configure sua loja'}
          </h1>
          <p className="text-sm text-uf-silver-dim mt-2">
            {complementary
              ? 'Dados da loja já carregados — confirme ou ajuste só o que mudou. Nada é apagado.'
              : 'Dados essenciais pra liberar o painel. WhatsApp e horários ficam no primeiro acesso à loja.'}
          </p>
        </div>

        {returning && (
          <div className="mb-4 uf-glass rounded-xl px-4 py-3 text-xs text-emerald-300/90 border border-emerald-500/20">
            Dados existentes carregados
            {nomeLoja ? (
              <>
                {' '}
                — <span className="font-semibold text-uf-silver">{nomeLoja}</span>
              </>
            ) : null}
            . Revise antes de continuar.
          </div>
        )}

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 sm:p-8 space-y-4">
          <div>
            <label className="label flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5" /> Nome da empresa *
            </label>
            <input
              className="input-field"
              value={nomeLoja}
              onChange={(e) => setNomeLoja(e.target.value)}
              placeholder="Ex: Minha Loja"
            />
          </div>

          <AddressField
            endereco={endereco}
            numero={enderecoNumero}
            onEnderecoChange={setEndereco}
            onNumeroChange={setEnderecoNumero}
          />

          <div>
            <label className="label flex items-center gap-1.5">
              <AtSign className="w-3.5 h-3.5" /> Rede social — Instagram (opcional)
            </label>
            <div className="flex items-center gap-1 input-field !py-0 !px-3">
              <span className="text-uf-silver-dim text-sm">@</span>
              <input
                className="flex-1 bg-transparent outline-none py-2.5 text-sm"
                value={instagram.replace(/^@/, '')}
                onChange={(e) => setInstagram(e.target.value.replace(/^@/, ''))}
                placeholder="sua_loja"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <AtSign className="w-3.5 h-3.5" /> Rede social — Facebook (opcional)
            </label>
            <input
              className="input-field text-sm"
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              placeholder="usuarioNome"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="label">Logo (opcional)</label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-14 h-14 rounded-xl object-cover border border-white/10" />
              ) : (
                <div className="w-14 h-14 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-[10px] text-uf-silver-dim">
                  sem logo
                </div>
              )}
              <label className="btn-secondary text-xs px-3 py-2 cursor-pointer inline-flex items-center gap-1.5">
                {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {logoUrl ? 'Trocar imagem' : 'Enviar imagem'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingLogo}
                  onChange={(e) => handleLogoUpload(e.target.files?.[0] ?? null)}
                />
              </label>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl('')}
                  disabled={uploadingLogo}
                  className="btn-ghost text-xs px-3 py-1.5 !text-red-300"
                >
                  Remover
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="label">Imagem do hero (opcional)</label>
            <p className="text-[11px] text-uf-silver-dim mb-2 leading-snug">
              No plano Essential, esta imagem retangular aparece acima do título na landing.
            </p>
            <div className="flex items-start gap-3">
              {landingHeroImageUrl ? (
                <img
                  src={landingHeroImageUrl}
                  alt="Hero"
                  className="w-28 h-16 rounded-xl object-cover border border-white/10"
                />
              ) : (
                <div className="w-28 h-16 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-[10px] text-uf-silver-dim text-center px-1">
                  sem imagem
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className="btn-secondary text-xs px-3 py-2 cursor-pointer inline-flex items-center gap-1.5">
                  {uploadingHero ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {landingHeroImageUrl ? 'Trocar imagem' : 'Enviar imagem'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingHero}
                    onChange={(e) => handleHeroUpload(e.target.files?.[0] ?? null)}
                  />
                </label>
                {landingHeroImageUrl && (
                  <button
                    type="button"
                    onClick={() => setLandingHeroImageUrl('')}
                    disabled={uploadingHero}
                    className="btn-ghost text-xs px-3 py-1.5 !text-red-300"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="uf-glass rounded-xl p-4">
            {hasCreds ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-uf-silver flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Mercado Pago conectado.
                </span>
                <div className="flex items-center gap-3 flex-none">
                  <button
                    type="button"
                    onClick={handleConnectMp}
                    disabled={connectingMp || disconnectingMp}
                    className="text-xs text-uf-silver-dim hover:text-uf-silver underline"
                  >
                    Reconectar
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectMp}
                    disabled={connectingMp || disconnectingMp}
                    className="text-xs text-red-400/80 hover:text-red-400 underline flex items-center gap-1"
                  >
                    {disconnectingMp ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Desconectar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="label flex items-center gap-1.5 mb-1">
                  <CreditCard className="w-3.5 h-3.5" /> Conecte sua conta Mercado Pago
                </p>
                <p className="text-[11px] text-uf-silver-dim mb-3">Receba pagamentos automaticamente na sua loja.</p>
                <button
                  type="button"
                  onClick={handleConnectMp}
                  disabled={connectingMp}
                  className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
                >
                  {connectingMp ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Conectar Mercado Pago
                </button>
              </>
            )}
          </div>

          <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={venderExternamente}
              onChange={(e) => setVenderExternamente(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span className="text-xs text-uf-silver-dim">
              <span className="block text-uf-silver font-semibold mb-0.5">Quer vender pro público externo</span>
              Vitrine online (catálogo, carrinho, checkout). Desmarque pra usar só painel/PDV.
            </span>
          </label>

          {venderExternamente && (
            <>
              <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vendeMais18}
                  onChange={(e) => setVendeMais18(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                />
                <span className="text-xs text-uf-silver-dim">
                  <span className="block text-uf-silver font-semibold mb-0.5">Vendo produtos para maiores de 18 anos</span>
                  O cliente só compra logado — cadastro passa a exigir data de nascimento e consentimento de compra +18.
                </span>
              </label>

              <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apenasRetirada}
                  onChange={(e) => setApenasRetirada(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                />
                <span className="text-xs text-uf-silver-dim">
                  <span className="block text-uf-silver font-semibold mb-0.5">Não ofereço serviço de entrega — retirada obrigatória na loja</span>
                  A vitrine não pede endereço de entrega; em vez disso mostra um botão com o endereço da loja no Google Maps.
                </span>
              </label>

              <label className="uf-glass rounded-xl px-3 py-2.5 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ofereceServicos}
                  onChange={(e) => setOfereceServicos(e.target.checked)}
                  className="w-4 h-4 mt-0.5"
                />
                <span className="text-xs text-uf-silver-dim">
                  <span className="block text-uf-silver font-semibold mb-0.5">Ofereço serviços</span>
                  Além de produtos, sua vitrine ganha um botão "Ver serviços" e o painel ganha a aba de cadastro de serviços.
                </span>
              </label>
            </>
          )}


          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {complementary ? 'Salvar e liberar painel' : 'Liberar painel'}
          </button>

          {complementary && (
            <button
              type="button"
              disabled={loading}
              onClick={handleKeepCurrent}
              className="btn-secondary w-full py-3 text-sm"
            >
              Manter dados atuais e continuar
            </button>
          )}
        </form>
      </motion.div>
    </main>
  )
}
