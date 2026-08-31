import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import { ApiError } from '../../lib/apiError'
import { getDemoStaffSession, isDemoModeActive } from '../../lib/demoMode'
import { authService } from '../../services/authService'
import { useVendedorAuth } from '../../store/vendedorAuth'
import { useMotoboyAuth } from '../../store/motoboyAuth'
import { useCozinhaAuth } from '../../store/cozinhaAuth'

// Login único de funcionário — o site identifica sozinho qual papel bate
// com o e-mail/senha (motoboy, vendedor ou cozinha), tentando cada login em
// sequência com a MESMA credencial, e manda pra tela certa. Sem seletor de
// papel: cada funcionário tem só uma conta, então só um dos três bate.
export default function FuncionarioLogin() {
  const { token: vendedorToken, login: vendedorLogin } = useVendedorAuth()
  const { token: motoboyToken, login: motoboyLogin } = useMotoboyAuth()
  const { token: cozinhaToken, login: cozinhaLogin } = useCozinhaAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (isDemoModeActive()) {
    const staff = getDemoStaffSession()
    if (staff?.role === 'motoboy') return <Navigate to="/funcionarios/motoboy" replace />
    if (staff?.role === 'vendedor') return <Navigate to="/funcionarios/vendedor/pdv" replace />
    return <Navigate to="/" replace />
  }
  if (motoboyToken) return <Navigate to="/funcionarios/motoboy" replace />
  if (vendedorToken) return <Navigate to="/funcionarios/vendedor" replace />
  if (cozinhaToken) return <Navigate to="/cozinha" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      try {
        const res = await authService.staff.motoboyLogin(email, password)
        motoboyLogin(res.token, res.name)
        navigate('/funcionarios/motoboy')
        return
      } catch {
        /* não é motoboy, tenta o próximo papel */
      }
      try {
        const res = await authService.staff.vendedorLogin(email, password)
        vendedorLogin(res.token, res.name)
        navigate('/funcionarios/vendedor')
        return
      } catch {
        /* não é vendedor, tenta o próximo papel */
      }
      const res = await authService.staff.cozinhaLogin(email, password)
      cozinhaLogin(res.token, res.name)
      navigate('/cozinha')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'E-mail ou senha incorretos.')
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
          <p className="text-son-silver-dim text-xs mt-1">Vendedor, motoboy ou cozinha — a gente identifica sozinho.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Senha</label>
            <div className="relative">
              <input
                className="input-field pr-12"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-son-silver-dim hover:text-white p-1"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && (
            <div>
              <p className="error-msg">{error}</p>
              <p className="text-xs text-son-silver-dim mt-1">
                Confira o e-mail/senha — são os mesmos cadastrados pelo admin em Funcionários.
              </p>
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Entrar
          </button>
          <Link to="/admin/login" className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
            <Lock className="w-4 h-4" /> Sou admin
          </Link>
        </div>
      </form>
    </main>
  )
}
