import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, MailCheck, RotateCw } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { translateAuthError } from '../lib/authErrors'
import { resolveSessionHome } from '../lib/sessionHome'

export default function VerificarEmail() {
  const navigate = useNavigate()
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const [routing, setRouting] = useState(false)

  useEffect(() => {
    if (!session?.user.email_confirmed_at) return
    setRouting(true)
    resolveSessionHome()
      .then((to) => navigate(to, { replace: true }))
      .finally(() => setRouting(false))
  }, [session?.user.email_confirmed_at, navigate])

  if (!ready || routing) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const handleReenviar = async () => {
    setResending(true)
    setError(null)
    setResent(false)
    try {
      const email = session?.user.email
      if (!email) throw new Error('conta sem e-mail associado')
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email })
      if (resendError) throw resendError
      setResent(true)
    } catch (e) {
      setError(e instanceof Error ? translateAuthError(e.message) : 'Não foi possível reenviar o e-mail.')
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm relative z-10 text-center"
      >
        <MailCheck className="w-10 h-10 text-uf-blue mx-auto mb-4" />
        <h1 className="text-xl font-black mb-2">Confirme seu e-mail</h1>
        <p className="text-sm text-uf-silver-dim mb-6">
          Clique no link que enviamos pra <span className="text-uf-silver">{session?.user.email}</span>.
        </p>
        {error && <p className="error-msg mb-4">{error}</p>}
        {resent && <p className="text-sm text-emerald-400 mb-4">E-mail reenviado!</p>}
        <button onClick={handleReenviar} disabled={resending} className="btn-secondary w-full py-3 mb-4">
          {resending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <RotateCw className="w-4 h-4 inline mr-2" />}
          Reenviar link
        </button>
        <p className="text-xs text-uf-silver-dim">
          <Link to="/meu-plano" className="hover:text-uf-silver">
            Voltar ao hub
          </Link>
        </p>
      </motion.div>
    </main>
  )
}
