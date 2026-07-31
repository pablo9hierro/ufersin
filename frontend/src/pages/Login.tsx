import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LogIn, Loader2 } from 'lucide-react'
import { supabase, supabaseConfigured } from '../lib/supabaseClient'
import { useAuthReady, useIsAuthenticated } from '../lib/authStore'
import { translateAuthError } from '../lib/authErrors'
import { clearAuthFailures, getAuthLockMessage, recordAuthFailure } from '../lib/authRateLimit'
import PasswordField from '../components/PasswordField'
import { PLAN_MAP } from '../lib/plans'
import type { BillingCycle, PlanoCode } from '../lib/api'

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
  const [error, setError] = useState<string | null>(null)

  if (ready && isAuthenticated) {
    return <Navigate to={plano ? `/assinar?plano=${plano}&ciclo=${ciclo}` : '/dashboard'} replace />
  }

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
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
      if (signInError) throw signInError
      clearAuthFailures()
      navigate(plano ? `/assinar?plano=${plano}&ciclo=${ciclo}` : '/dashboard')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível entrar. Tente novamente.'
      recordAuthFailure()
      setError(getAuthLockMessage() || translateAuthError(msg))
    } finally {
      setLoading(false)
    }
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
            Rodoletas
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">
            {plano ? `Entre pra assinar o plano ${PLAN_MAP[plano].name}.` : 'Entre no seu painel de assinante.'}
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
