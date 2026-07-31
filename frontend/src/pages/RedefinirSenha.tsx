import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { translateAuthError } from '../lib/authErrors'
import PasswordField from '../components/PasswordField'

/** Landing do link de "esqueci minha senha" -- o supabase-js já estabelece
 * uma sessão de recuperação a partir do token na URL sozinho
 * (detectSessionInUrl), então só falta pedir a nova senha e chamar
 * updateUser. */
export default function RedefinirSenha() {
  const navigate = useNavigate()
  const [novaSenha, setNovaSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRedefinir = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (novaSenha.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }
    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: novaSenha })
      if (updateError) throw updateError
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? translateAuthError(e.message) : 'Não foi possível redefinir sua senha. Peça um novo link.')
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
          <p className="text-uf-silver-dim text-sm mt-2">Escolha sua nova senha.</p>
        </div>

        <form onSubmit={handleRedefinir} className="uf-glass rounded-2xl p-6 space-y-4">
          <PasswordField
            label="Nova senha"
            value={novaSenha}
            onChange={setNovaSenha}
            placeholder="Pelo menos 8 caracteres"
            autoComplete="new-password"
          />
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Redefinir senha
          </button>
        </form>
      </motion.div>
    </main>
  )
}
