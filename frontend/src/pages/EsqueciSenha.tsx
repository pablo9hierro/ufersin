import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, Loader2, MailCheck } from 'lucide-react'
import { api, ApiError } from '../lib/api'

export default function EsqueciSenha() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'codigo'>('email')
  const [email, setEmail] = useState('')
  const [codigo, setCodigo] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleEnviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    setLoading(true)
    try {
      await api.esqueciSenha(email.trim())
      setStep('codigo')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar o código.')
    } finally {
      setLoading(false)
    }
  }

  const handleRedefinir = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (novaSenha.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }
    setLoading(true)
    try {
      await api.redefinirSenha({ email: email.trim(), codigo: codigo.trim(), nova_senha: novaSenha })
      navigate('/login')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Código inválido ou expirado.')
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
            {step === 'email' ? 'Vamos te mandar um código de recuperação.' : 'Confira seu e-mail e escolha uma nova senha.'}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={handleEnviar} className="uf-glass rounded-2xl p-6 space-y-4">
            <div>
              <label className="label">E-mail cadastrado</label>
              <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
              Enviar código
            </button>
          </form>
        ) : (
          <form onSubmit={handleRedefinir} className="uf-glass rounded-2xl p-6 space-y-4">
            <div>
              <label className="label">Código de 6 dígitos</label>
              <input
                className="input-field text-center tracking-[0.4em] font-bold"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
              />
            </div>
            <div>
              <label className="label">Nova senha</label>
              <input
                className="input-field"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                type="password"
                placeholder="Pelo menos 8 caracteres"
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Redefinir senha
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
