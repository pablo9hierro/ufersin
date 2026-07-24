import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Loader2, Lock, Store, Truck } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import { api, ApiError } from '../../lib/api'
import { useVendedorAuth } from '../../store/vendedorAuth'
import { useMotoboyAuth } from '../../store/motoboyAuth'

type Role = 'vendedor' | 'motoboy'

// Login exclusivo de vendedor/motoboy, separado do login do admin
// (/admin/login) — cada aba chama SÓ a RPC daquele papel específico, sem
// nenhuma tentativa em cascata contra outro papel. Elimina qualquer chance
// de um funcionário acabar logado numa conta que não é a dele. Vendedor
// grava em useVendedorAuth, motoboy em useMotoboyAuth — chaves de
// localStorage totalmente separadas entre si e do admin (useAdminAuth):
// logar ou deslogar qualquer um dos três nunca mais afeta os outros dois.
export default function FuncionarioLogin() {
  const { token: vendedorToken, login: vendedorLogin } = useVendedorAuth()
  const { token: motoboyToken, login: motoboyLogin } = useMotoboyAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<Role>('vendedor')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (motoboyToken) return <Navigate to="/funcionarios/motoboy" replace />
  if (vendedorToken) return <Navigate to="/funcionarios/vendedor" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (role === 'vendedor') {
        const res = await api.auth.vendedorLogin(email, password)
        vendedorLogin(res.token, res.name)
        navigate('/funcionarios/vendedor')
      } else {
        const res = await api.auth.motoboyLogin(email, password)
        motoboyLogin(res.token, res.name)
        navigate('/funcionarios/motoboy')
      }
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
          <p className="text-son-silver-dim text-sm mt-2">Login de funcionário</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => setRole('vendedor')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              role === 'vendedor' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
            }`}
          >
            <Store className="w-3.5 h-3.5" /> Vendedor
          </button>
          <button
            type="button"
            onClick={() => setRole('motoboy')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              role === 'motoboy' ? 'sunset-bg text-white' : 'bg-son-surface border border-white/5 text-son-silver-dim'
            }`}
          >
            <Truck className="w-3.5 h-3.5" /> Motoboy
          </button>
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
                Confira se a aba certa ({role === 'vendedor' ? 'Vendedor' : 'Motoboy'}) está selecionada acima, e se o
                e-mail/senha são os mesmos cadastrados pelo admin em Funcionários.
              </p>
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Entrar
          </button>
          <p className="text-center text-xs text-son-silver-dim">
            Esqueceu a senha? Peça pro admin ver/redefinir em Funcionários.
          </p>
          <Link to="/admin/login" className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
            <Lock className="w-4 h-4" /> Sou admin
          </Link>
        </div>
      </form>
    </main>
  )
}
