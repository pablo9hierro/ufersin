import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Lock, Users } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { useAdminAuth } from '../../store/adminAuth'
import { persistTenantSlug, resetTenantConfigCache } from '../../lib/tenantConfig'

// Login exclusivo do admin — não tenta mais vendedor/motoboy em cascata
// (isso causava logins acidentais na conta admin: o campo de e-mail vinha
// pré-preenchido com o e-mail do admin e, se a senha digitada por um
// vendedor/motoboy batesse por coincidência com a senha do admin, o login
// "colava" na conta errada). Vendedor/motoboy logam em /funcionarios/login,
// cada um na própria sessão (useVendedorAuth/useMotoboyAuth) — useAdminAuth
// aqui é 100% exclusivo do admin.
//
// `?tenant=` + `?email=` vêm do dashboard Resolutoo ("Entrar no painel da
// loja") — tenant_slug é obrigatório no login multi-tenant do motor.
export default function AdminLogin() {
  const { token, login } = useAdminAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tenantFromUrl = (searchParams.get('tenant') || '').trim().toLowerCase()
  const emailFromUrl = (searchParams.get('email') || '').trim()

  const [email, setEmail] = useState(emailFromUrl)
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState(tenantFromUrl)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (token) return <Navigate to="/admin/pedidos" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const slug = tenantSlug.trim().toLowerCase()
    if (!slug) {
      setError('Informe o identificador da loja (slug).')
      return
    }
    setLoading(true)
    try {
      const res = await authService.staff.adminLogin(email, password, slug)
      persistTenantSlug(slug)
      resetTenantConfigCache()
      login(res.token, res.name, slug)
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
          {tenantFromUrl ? (
            <p className="text-xs text-son-silver-dim mt-2">
              Loja: <span className="font-semibold text-white">{tenantFromUrl}</span>
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
          {!tenantFromUrl ? (
            <div>
              <label className="label">Identificador da loja</label>
              <input
                className="input-field"
                type="text"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="ex.: minha-loja"
                required
                autoCapitalize="none"
              />
            </div>
          ) : null}
          <div>
            <label className="label">E-mail</label>
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={!emailFromUrl}
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus={Boolean(emailFromUrl)}
            />
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
