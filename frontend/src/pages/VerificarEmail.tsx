import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, MailCheck, RotateCw } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { translateAuthError } from '../lib/authErrors'

/** Confirmação de e-mail é 100% do Supabase agora (link real por e-mail,
 * não código de 6 dígitos) -- esta tela só existe pra quem está logado com
 * uma sessão ainda não confirmada e quer reenviar o link (ver
 * ARQUITETURA.md §6). */
export default function VerificarEmail() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (session?.user.email_confirmed_at) return <Navigate to="/dashboard" replace />

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

        {error && <p className="error-msg text-center mb-4">{error}</p>}

        <button onClick={handleReenviar} disabled={resending} className="btn-primary px-5 py-2.5 inline-flex mx-auto">
          {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
          {resent ? 'E-mail reenviado' : 'Reenviar e-mail'}
        </button>

        <p className="text-xs text-uf-silver-dim mt-6">
          <Link to="/dashboard" className="hover:text-uf-silver">
            Fazer isso depois
          </Link>
        </p>
      </motion.div>
    </main>
  )
}
