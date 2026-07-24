import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LogIn, Loader2 } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { authStore } from '../lib/authStore'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.includes('@') || senha.length === 0) {
      setError('Informe e-mail e senha.')
      return
    }
    setLoading(true)
    try {
      const result = await api.login({ email: email.trim(), senha })
      authStore.setToken(result.token)
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar. Tente novamente.')
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
          <p className="text-uf-silver-dim text-sm mt-2">Entre no seu painel de assinante.</p>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" />
          </div>
          <div>
            <label className="label">Senha</label>
            <input className="input-field" value={senha} onChange={(e) => setSenha(e.target.value)} type="password" placeholder="••••••••" />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Entrar
          </button>

          <div className="flex items-center justify-between text-xs pt-1">
            <Link to="/esqueci-senha" className="text-uf-silver-dim hover:text-uf-silver">
              Esqueci minha senha
            </Link>
            <Link to="/cadastro" className="text-uf-silver-dim hover:text-uf-silver">
              Criar conta
            </Link>
          </div>
        </form>
      </motion.div>
    </main>
  )
}
