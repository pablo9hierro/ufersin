import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, MailCheck, Rocket, RotateCw } from 'lucide-react'
import { api } from '../lib/api'
import { supabase } from '../lib/supabaseClient'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { translateAuthError } from '../lib/authErrors'
import { clearAuthFailures, getAuthLockMessage, recordAuthFailure } from '../lib/authRateLimit'
import { finishSignupAfterConfirm } from '../lib/finishSignup'
import { PENDING_SIGNUP_KEY } from '../lib/pendingSignup'
import { authRedirectUrl } from '../lib/siteUrl'
import PasswordField from '../components/PasswordField'
import { resolveSessionHome } from '../lib/sessionHome'
import { formatBRL, fetchPlans, getPlanMap, priceForCycle } from '../lib/plans'
import type { BillingCycle, PlanoCode } from '../lib/api'

export { PENDING_SIGNUP_KEY }

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

export default function Cadastro() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const planoParam = searchParams.get('plano') as PlanoCode | null
  const planMap = getPlanMap()
  const plano: PlanoCode | null = planoParam && planoParam in planMap ? planoParam : null
  const cicloParam = searchParams.get('ciclo') as BillingCycle | null
  const ciclo: BillingCycle = cicloParam === 'semestral' ? 'semestral' : 'mensal'
  const planInfo = plano ? planMap[plano] : null

  useEffect(() => {
    void fetchPlans()
  }, [])

  const [lojaNome, setLojaNome] = useState('')
  const [responsavelNome, setResponsavelNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [resending, setResending] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const finishingRef = useRef(false)

  // Se já tem sessão (ex.: F5 depois de confirmar o e-mail no celular),
  // conclui bootstrap e manda pro dashboard / assinar.
  useEffect(() => {
    if (!ready || !isAuthenticated || finishingRef.current) return
    finishingRef.current = true
    setFinishing(true)
    ;(async () => {
      try {
        const dest = await finishSignupAfterConfirm()
        navigate(dest, { replace: true })
      } catch (e) {
        finishingRef.current = false
        setFinishing(false)
        setError(e instanceof Error ? translateAuthError(e.message) : 'Não foi possível continuar.')
        if (awaitingConfirmation) setAwaitingConfirmation(true)
      }
    })()
  }, [ready, isAuthenticated, navigate, awaitingConfirmation])

  // Na tela "confirme seu e-mail", fica checando se a sessão apareceu
  // (confirmou noutro aparelho) — F5 ou foco na aba também revalida.
  useEffect(() => {
    if (!awaitingConfirmation) return
    const tick = async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session && !finishingRef.current) {
        // o effect de isAuthenticated cuida do resto
        await supabase.auth.refreshSession()
      }
    }
    const id = window.setInterval(tick, 4000)
    const onFocus = () => {
      void tick()
    }
    window.addEventListener('focus', onFocus)
    void tick()
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [awaitingConfirmation])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const locked = getAuthLockMessage()
    if (locked) {
      setError(locked)
      return
    }

    if (!lojaNome.trim() || !responsavelNome.trim()) {
      setError('Informe o nome da loja e do responsável.')
      return
    }
    const digits = whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (!email.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (senha.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password: senha,
        options: { emailRedirectTo: authRedirectUrl('/auth/callback') },
      })
      if (signUpError) throw signUpError

      const pending = { loja_nome: lojaNome.trim(), responsavel_nome: responsavelNome.trim(), whatsapp: `55${digits}`, senha, plano, ciclo }

      if (data.session) {
        await api.bootstrap({
          loja_nome: pending.loja_nome,
          responsavel_nome: pending.responsavel_nome,
          whatsapp: pending.whatsapp,
          senha,
        })
        clearAuthFailures()
        const dest = await resolveSessionHome({ plano, ciclo })
        navigate(dest)
      } else {
        localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(pending))
        clearAuthFailures()
        setAwaitingConfirmation(true)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível criar sua conta. Tente novamente.'
      recordAuthFailure()
      setError(getAuthLockMessage() || translateAuthError(msg))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setError(null)
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: authRedirectUrl('/auth/callback') },
      })
      if (resendError) throw resendError
    } catch (e) {
      setError(e instanceof Error ? translateAuthError(e.message) : 'Não foi possível reenviar o e-mail.')
    } finally {
      setResending(false)
    }
  }

  if (!ready || finishing) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }

  if (awaitingConfirmation) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
        <div className="uf-mesh" />
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm relative z-10 text-center">
          <MailCheck className="w-10 h-10 text-uf-blue mx-auto mb-4" />
          <h1 className="text-xl font-black mb-2">Confirme seu e-mail</h1>
          <p className="text-sm text-uf-silver-dim mb-6">
            Enviamos um link de confirmação pra <span className="text-uf-silver">{email.trim()}</span>. Clique nele pra continuar
            {plano ? ` e assinar o plano ${planMap[plano].name}` : ''}.
          </p>
          <p className="text-xs text-uf-silver-dim mb-4">Já confirmou? Atualize a página (F5) ou volte a esta aba — a gente te leva pro painel.</p>
          {error && <p className="error-msg mb-4">{error}</p>}
          <button onClick={handleResend} disabled={resending} className="btn-ghost text-xs mx-auto">
            {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Reenviar e-mail
          </button>
        </motion.div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">
            {plano ? 'Crie sua conta pra assinar o plano abaixo.' : 'Sua loja online completa, pronta em dias — não em meses.'}
          </p>
        </div>

        {planInfo && (
          <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
            <p className="text-xs text-uf-silver-dim mb-1">Plano {planInfo.name}</p>
            <p className="text-3xl font-black uf-text">
              {ciclo === 'mensal'
                ? `R$ ${formatBRL(planInfo.price)}/mês`
                : `R$ ${formatBRL(priceForCycle(planInfo.price, 'semestral'))}/semestre (−5%)`}
            </p>
            <Link to="/#planos" className="text-[11px] text-uf-silver-dim hover:text-uf-silver underline mt-1 inline-block">
              trocar plano
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome da loja *</label>
            <input className="input-field" value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} placeholder="Ex: Minha Loja" />
          </div>
          <div>
            <label className="label">Seu nome *</label>
            <input
              className="input-field"
              value={responsavelNome}
              onChange={(e) => setResponsavelNome(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="label">WhatsApp *</label>
            <input
              className="input-field"
              value={whatsapp}
              onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
              type="tel"
              inputMode="numeric"
              placeholder="(83) 99999-9999"
              maxLength={15}
            />
          </div>
          <div>
            <label className="label">E-mail *</label>
            <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" />
          </div>
          <PasswordField
            label="Senha *"
            value={senha}
            onChange={setSenha}
            placeholder="Pelo menos 8 caracteres"
            autoComplete="new-password"
            hint="É com ela que você entra no seu painel e na sua loja."
          />

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {plano ? 'Criar conta e continuar' : 'Criar conta'}
          </button>
          <p className="text-xs text-center text-uf-silver-dim">
            Já tem conta?{' '}
            <Link to={plano ? `/login?plano=${plano}&ciclo=${ciclo}` : '/login'} className="text-uf-silver font-semibold hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </motion.div>
    </main>
  )
}
