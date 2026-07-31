import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, MailCheck } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { translateAuthError } from '../lib/authErrors'
import { authRedirectUrl } from '../lib/siteUrl'

export default function EsqueciSenha() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleEnviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    setLoading(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authRedirectUrl('/redefinir-senha'),
      })
      if (resetError) throw resetError
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? translateAuthError(e.message) : 'Não foi possível enviar o link.')
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
            {sent ? 'Confira seu e-mail e clique no link pra escolher uma nova senha.' : 'Vamos te mandar um link de recuperação.'}
          </p>
        </div>

        {sent ? (
          <div className="uf-glass rounded-2xl p-6 text-center">
            <MailCheck className="w-8 h-8 text-uf-blue mx-auto mb-3" />
            <p className="text-sm text-uf-silver-dim">
              Enviamos um link pra <span className="text-uf-silver">{email.trim()}</span>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleEnviar} className="uf-glass rounded-2xl p-6 space-y-4">
            <div>
              <label className="label">E-mail cadastrado</label>
              <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
              Enviar link
            </button>
          </form>
        )}

        <p className="text-xs text-center text-uf-silver-dim mt-5">
          <Link to="/login" className="hover:text-uf-silver">
            Voltar ao login
          </Link>
        </p>
      </motion.div>
    </main>
  )
}
