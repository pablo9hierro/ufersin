import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Loader2, Lock, Users } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import { api, ApiError } from '../../lib/api'
import { useAdminAuth } from '../../store/adminAuth'

// Login exclusivo do admin — não tenta mais vendedor/motoboy em cascata
// (isso causava logins acidentais na conta admin: o campo de e-mail vinha
// pré-preenchido com o e-mail do admin e, se a senha digitada por um
// vendedor/motoboy batesse por coincidência com a senha do admin, o login
// "colava" na conta errada). Vendedor/motoboy logam em /funcionarios/login,
// cada um na própria sessão (useVendedorAuth/useMotoboyAuth) — useAdminAuth
// aqui é 100% exclusivo do admin.
export default function AdminLogin() {
  const { token, login } = useAdminAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (token) return <Navigate to="/admin/pedidos" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.auth.adminLogin(email, password)
      login(res.token, res.name)
      navigate('/admin/pedidos')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao entrar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-son-black text-white flex items-center justify-center px-5">
      <form onSubmit={handleSubmit} className="sunset-login-card w-full max-w-sm rounded-2xl p-8">
        <div className="text-center mb-6">
          <Logo size="lg" />
          <p className="text-son-silver-dim text-sm mt-2 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Painel administrativo
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Senha</label>
            <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && (
            <div>
              <p className="error-msg">{error}</p>
              <p className="text-xs text-son-silver-dim mt-1">
                É motoboy ou vendedor? Essa tela é só pro admin — use o botão abaixo.
              </p>
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Entrar
          </button>
          <Link to="/funcionarios/login" className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
            <Users className="w-4 h-4" /> Sou vendedor ou motoboy
          </Link>
        </div>
      </form>
    </main>
  )
}
