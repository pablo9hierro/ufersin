import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, Users } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { useAdminAuth } from '../../store/adminAuth'
import { persistTenantSlug, resetTenantConfigCache, resolveTenantSlug } from '../../lib/tenantConfig'

// Login exclusivo do admin — não tenta mais vendedor/motoboy em cascata
// (isso causava logins acidentais na conta admin: o campo de e-mail vinha
// pré-preenchido com o e-mail do admin e, se a senha digitada por um
// vendedor/motoboy batesse por coincidência com a senha do admin, o login
// "colava" na conta errada). Vendedor/motoboy logam em /funcionarios/login,
// cada um na própria sessão (useVendedorAuth/useMotoboyAuth) — useAdminAuth
// aqui é 100% exclusivo do admin.
//
// Tenant vem de `resolveTenantSlug()` (?tenant=, localStorage pós-login,
// VITE_TENANT_SLUG) — o assinante tem uma loja por assinatura, então não
// pedimos o identificador no formulário. `?email=` ainda vem do dashboard
// Resolutoo ("Entrar no painel da loja").
export default function AdminLogin() {
  const { token, login } = useAdminAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const emailFromUrl = (searchParams.get('email') || '').trim()
  // Prefer ?tenant= do React Router (MemoryRouter / SPA), depois localStorage /
  // VITE_TENANT_SLUG via resolveTenantSlug (window.location + storage).
  const tenantSlug =
    (searchParams.get('tenant') || '').trim().toLowerCase() || resolveTenantSlug()

  const [email, setEmail] = useState(emailFromUrl)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (token) return <Navigate to="/admin/pedidos" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const slug =
      (searchParams.get('tenant') || '').trim().toLowerCase() || resolveTenantSlug()
    if (!slug) {
      setError('Loja não identificada. Abra o login pelo link do painel Resolutoo.')
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
        </div>
        <div className="space-y-4">
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
            <div className="relative">
              <input
                className="input-field pr-12"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus={Boolean(emailFromUrl)}
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
                É motoboy ou vendedor? Essa tela é só pro admin — use o botão abaixo.
              </p>
            </div>
          )}
          <button type="submit" disabled={loading || !tenantSlug} className="btn-primary w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Entrar
          </button>
          {!tenantSlug ? (
            <p className="text-xs text-son-silver-dim text-center">
              Abra esta página pelo link &quot;Entrar no painel da loja&quot; no Resolutoo.
            </p>
          ) : null}
          <Link to="/funcionarios/login" className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
            <Users className="w-4 h-4" /> Sou vendedor ou motoboy
          </Link>
        </div>
      </form>
    </main>
  )
}
