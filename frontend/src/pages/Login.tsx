import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LogIn, Loader2 } from 'lucide-react'
import { supabaseConfigured, supabaseLojista, supabaseSuperadmin } from '../lib/supabaseClient'
import { authStore, useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { translateAuthError } from '../lib/authErrors'
import { clearAuthFailures, getAuthLockMessage, recordAuthFailure } from '../lib/authRateLimit'
import PasswordField from '../components/PasswordField'
import { PLAN_MAP } from '../lib/plans'
import { resolveSessionHome } from '../lib/sessionHome'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { api, ApiError, type BillingCycle, type PlanoCode } from '../lib/api'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const planoParam = searchParams.get('plano') as PlanoCode | null
  const plano: PlanoCode | null = planoParam && planoParam in PLAN_MAP ? planoParam : null
  const ciclo: BillingCycle = searchParams.get('ciclo') === 'semestral' ? 'semestral' : 'mensal'

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !isAuthenticated) return
    let cancelled = false
    setRouting(true)
    resolveSessionHome({ plano, ciclo })
      .then((to) => {
        if (!cancelled) navigate(to, { replace: true })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Não foi possível abrir seu painel.')
      })
      .finally(() => {
        if (!cancelled) setRouting(false)
      })
    return () => {
      cancelled = true
    }
  }, [ready, isAuthenticated, plano, ciclo, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const locked = getAuthLockMessage()
    if (locked) {
      setError(locked)
      return
    }
    if (!supabaseConfigured) {
      setError('Login indisponível: configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY na Vercel.')
      return
    }
    if (!email.includes('@') || senha.length === 0) {
      setError('Informe e-mail e senha.')
      return
    }
    setLoading(true)
    try {
      const trimmed = email.trim()
      // Known admin: autentica direto no slot superadmin — não toca lojista.
      if (isKnownPlatformAdminEmail(trimmed)) {
        const { data, error: signInError } = await supabaseSuperadmin.auth.signInWithPassword({
          email: trimmed,
          password: senha,
        })
        if (signInError) throw signInError
        if (!data.session) throw new Error('Sessão não retornada pelo login.')
        clearAuthFailures()
        for (let i = 0; i < 40 && !authStore.getTokenForRole('superadmin'); i++) {
          await new Promise((r) => setTimeout(r, 25))
        }
        navigate(await resolveSessionHome({ plano, ciclo, email: data.session.user.email }), { replace: true })
        return
      }

      // Lojista (default): autentica no slot lojista — não toca superadmin.
      const { data, error: signInError } = await supabaseLojista.auth.signInWithPassword({
        email: trimmed,
        password: senha,
      })
      if (signInError) throw signInError
      if (!data.session) throw new Error('Sessão não retornada pelo login.')
      clearAuthFailures()
      for (let i = 0; i < 40 && !authStore.getTokenForRole('lojista'); i++) {
        await new Promise((r) => setTimeout(r, 25))
      }

      // Se na verdade for platform admin (não listado no fallback de e-mail),
      // move pro slot superadmin e limpa só o JWT duplicado no lojista.
      try {
        await api.superadminWhoami()
        await authStore.placeSession('superadmin', data.session)
        for (let i = 0; i < 40 && !authStore.getTokenForRole('superadmin'); i++) {
          await new Promise((r) => setTimeout(r, 25))
        }
      } catch (e) {
        if (!(e instanceof ApiError && (e.status === 403 || e.status === 401))) {
          /* rede/5xx: segue como lojista */
        }
      }

      navigate(await resolveSessionHome({ plano, ciclo, email: data.session.user.email }), { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível entrar. Tente novamente.'
      recordAuthFailure()
      setError(getAuthLockMessage() || translateAuthError(msg))
    } finally {
      setLoading(false)
    }
  }

  if (ready && isAuthenticated && routing) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
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
        className="w-full max-w-sm relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">
            {plano ? `Entre pra assinar o plano ${PLAN_MAP[plano].name}.` : 'Entre na sua conta.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" />
          </div>
          <PasswordField label="Senha" value={senha} onChange={setSenha} placeholder="••••••••" />

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Entrar
          </button>

          <div className="flex items-center justify-between text-xs pt-1">
            <Link to="/esqueci-senha" className="text-uf-silver-dim hover:text-uf-silver">
              Esqueci minha senha
            </Link>
            <Link to={plano ? `/cadastro?plano=${plano}` : '/cadastro'} className="text-uf-silver-dim hover:text-uf-silver">
              Criar conta
            </Link>
          </div>
        </form>
      </motion.div>
    </main>
  )
}
