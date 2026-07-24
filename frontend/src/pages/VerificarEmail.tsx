import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, MailCheck, RotateCw } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useIsAuthenticated } from '../lib/authStore'

export default function VerificarEmail() {
  const navigate = useNavigate()
  const isAuthenticated = useIsAuthenticated()
  const [codigo, setCodigo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <p className="text-uf-silver-dim mb-4">Você precisa estar logado pra verificar o e-mail.</p>
          <Link to="/login" className="btn-primary px-5 py-2.5 inline-flex">
            Entrar
          </Link>
        </div>
      </main>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.verificarEmail(codigo.trim())
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Código inválido ou expirado.')
    } finally {
      setLoading(false)
    }
  }

  const handleReenviar = async () => {
    setResending(true)
    setError(null)
    try {
      await api.reenviarVerificacao()
      setResent(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível reenviar o código.')
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
        <p className="text-sm text-uf-silver-dim mb-6">Digite o código de 6 dígitos que enviamos pro seu e-mail.</p>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4 text-left">
          <input
            className="input-field text-center tracking-[0.4em] font-bold text-lg"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="000000"
            maxLength={6}
          />
          {error && <p className="error-msg text-center">{error}</p>}
          <button type="submit" disabled={loading || codigo.length !== 6} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
            Confirmar
          </button>
        </form>

        <button
          onClick={handleReenviar}
          disabled={resending}
          className="btn-ghost text-xs mt-5 mx-auto"
        >
          {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
          {resent ? 'Código reenviado' : 'Reenviar código'}
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
