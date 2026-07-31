import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CreditCard,
  ExternalLink,
  Globe,
  Loader2,
  LogOut,
  Mail,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { api, ApiError, type MeResponse, type PlanoCode } from '../lib/api'
import { authStore, useAuthReady, useEmailConfirmed, useIsAuthenticated } from '../lib/authStore'
import { PLAN_MAP } from '../lib/plans'
import { ecommerceFrontendUrl } from '../lib/ecommerceUrl'

const PLAN_ORDER: PlanoCode[] = ['essential', 'management', 'premium']

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ativo: { label: 'Ativo', className: 'bg-emerald-400/15 text-emerald-300' },
  pendente: { label: 'Pagamento pendente', className: 'bg-amber-400/15 text-amber-300' },
  pausado: { label: 'Pausado', className: 'bg-amber-400/15 text-amber-300' },
  cancelado: { label: 'Cancelado', className: 'bg-red-400/15 text-red-300' },
  sem_assinatura: { label: 'Sem plano', className: 'bg-white/10 text-uf-silver-dim' },
}

export default function Dashboard() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const emailConfirmed = useEmailConfirmed()
  const navigate = useNavigate()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    api
      .me()
      .then(setMe)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar seus dados.'))
      .finally(() => setLoading(false))
  }, [isAuthenticated])

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const handleLogout = async () => {
    await authStore.signOut()
    navigate('/')
  }

  const handleMudarPlano = async (novo: PlanoCode) => {
    if (!me || busy) return
    setBusy(true)
    try {
      await api.mudarPlano(novo)
      setMe((prev) => (prev ? { ...prev, plano: novo } : prev))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível trocar de plano.')
    } finally {
      setBusy(false)
    }
  }

  const handleCancelar = async () => {
    if (!me || busy) return
    if (!confirm('Tem certeza que quer cancelar sua assinatura?')) return
    setBusy(true)
    try {
      await api.cancelar()
      setMe((prev) => (prev ? { ...prev, status: 'cancelado' } : prev))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível cancelar.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }

  if (!me) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-uf-silver-dim">{error || 'Não foi possível carregar seu painel.'}</p>
        </div>
      </main>
    )
  }

  const status = STATUS_LABEL[me.status] ?? { label: me.status, className: 'bg-white/10 text-uf-silver-dim' }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver">
      <header className="border-b border-white/5 px-5 py-5">
        <div className="uf-container flex items-center justify-between">
          <Link to="/" className="text-lg font-black uf-text">
            Rodoletas
          </Link>
          <div className="flex items-center gap-4">
            {me.plano && (
              <Link to="/meu-plano" className="btn-ghost text-sm">
                Meu plano
              </Link>
            )}
            <button onClick={handleLogout} className="btn-ghost text-sm">
              <LogOut className="w-4 h-4" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="uf-container px-5 py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h1 className="text-2xl sm:text-3xl font-black">{me.loja_nome}</h1>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.className}`}>{status.label}</span>
          </div>
          <p className="text-sm text-uf-silver-dim mb-8">
            Assinante desde {new Date(me.assinante_desde).toLocaleDateString('pt-BR')}
          </p>

          {emailConfirmed === false && (
            <div className="uf-glass rounded-2xl p-4 mb-6 flex items-center gap-3 border-amber-400/20">
              <ShieldAlert className="w-5 h-5 text-amber-300 shrink-0" />
              <p className="text-sm flex-1">Confirme seu e-mail pra manter sua conta segura.</p>
              <Link to="/verificar-email" className="btn-secondary text-xs px-3 py-2 shrink-0">
                Verificar
              </Link>
            </div>
          )}

          {!me.plano && (
            <div className="uf-glass rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4 border-uf-blue/30">
              <Sparkles className="w-6 h-6 text-uf-blue shrink-0" />
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold text-sm">Sua conta está pronta! Falta só escolher um plano.</p>
                <p className="text-xs text-uf-silver-dim mt-0.5">Essential, Management ou Premium — leva menos de um minuto.</p>
              </div>
              <Link to="/planos" className="btn-primary px-4 py-2.5 text-sm shrink-0">
                Escolher plano
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          )}

          {me.plano && me.status === 'ativo' && me.onboarding_status !== 'provisionado' && (
            <div className="uf-glass rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-4 border-uf-blue/30">
              <Sparkles className="w-6 h-6 text-uf-blue shrink-0" />
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold text-sm">Falta pouco! Configure sua loja pra começar a vender.</p>
                <p className="text-xs text-uf-silver-dim mt-0.5">Nome, categoria, cor e endereço — leva menos de 2 minutos.</p>
              </div>
              <Link to="/onboarding" className="btn-primary px-4 py-2.5 text-sm shrink-0">
                Continuar configuração
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          )}

          {error && <p className="error-msg mb-4">{error}</p>}

          <div className="grid md:grid-cols-2 gap-4">
            <section className="uf-glass rounded-2xl p-6">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                <Sparkles className="w-4 h-4" /> Plano atual
              </h2>
              {me.plano ? (
                <>
                  <p className="text-2xl font-black mb-1">{PLAN_MAP[me.plano].name}</p>
                  <p className="text-sm text-uf-silver-dim mb-5">R$ {(me.valor_mensal ?? 0).toFixed(2)}/mês</p>
                  <div className="flex flex-wrap gap-2">
                    {PLAN_ORDER.filter((p) => p !== me.plano).map((p) => (
                      <button key={p} onClick={() => handleMudarPlano(p)} disabled={busy} className="btn-secondary text-xs px-3 py-2">
                        Mudar pra {PLAN_MAP[p].name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-uf-silver-dim mt-4">Próxima cobrança: {me.proxima_cobranca ?? 'consulte seu gateway de pagamento'}</p>
                </>
              ) : (
                <p className="text-sm text-uf-silver-dim">Nenhum plano escolhido ainda.</p>
              )}
            </section>

            <section className="uf-glass rounded-2xl p-6">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                <CreditCard className="w-4 h-4" /> Pagamento
              </h2>
              {me.metodo_pagamento ? (
                <>
                  <p className="text-sm mb-1">
                    Método: <span className="font-semibold">{me.metodo_pagamento}</span>
                  </p>
                  <p className="text-sm text-uf-silver-dim mb-5">Gateway: {me.gateway === 'abacatepay' ? 'AbacatePay' : 'Mercado Pago'}</p>
                  {me.status !== 'cancelado' && (
                    <button onClick={handleCancelar} disabled={busy} className="btn-secondary text-xs px-3 py-2 !text-red-300 !border-red-400/20">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Cancelar assinatura
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-uf-silver-dim">Nenhuma cobrança configurada ainda.</p>
              )}
            </section>

            <section className="uf-glass rounded-2xl p-6">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                <Building2 className="w-4 h-4" /> Dados da empresa
              </h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-uf-silver-dim">Responsável</dt>
                  <dd>{me.responsavel_nome}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-uf-silver-dim flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5" /> E-mail
                  </dt>
                  <dd className="truncate">{me.email}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-uf-silver-dim">WhatsApp</dt>
                  <dd>{me.whatsapp}</dd>
                </div>
              </dl>
            </section>

            <section className="uf-glass rounded-2xl p-6">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-sm text-uf-silver-dim uppercase tracking-wide">
                <Globe className="w-4 h-4" /> Domínio &amp; loja
              </h2>
              {me.onboarding_status === 'provisionado' && me.dominio ? (
                <>
                  <p className="text-sm mb-4">
                    Sua loja: <span className="font-semibold">{me.dominio}</span>
                  </p>
                  <a
                    href={`${ecommerceFrontendUrl()}/admin/login?tenant=${me.slug}&email=${encodeURIComponent(me.email)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary text-xs px-3 py-2.5 inline-flex"
                  >
                    Entrar no painel da loja
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <p className="text-[11px] text-uf-silver-dim mt-2">Use o mesmo e-mail e senha da sua conta Rodoletas.</p>
                </>
              ) : (
                <p className="text-sm text-uf-silver-dim">Sua loja ainda não foi configurada — finalize a assinatura e o onboarding primeiro.</p>
              )}
            </section>
          </div>
        </motion.div>
      </div>
    </main>
  )
}
