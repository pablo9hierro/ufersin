import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, Users } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import EletronicaLogo from '../eletronicos/EletronicaLogo'
import { ApiError } from '../../lib/apiError'
import { getDemoStaffSession, isDemoModeActive } from '../../lib/demoMode'
import { authService } from '../../services/authService'
import { useAdminAuth } from '../../store/adminAuth'
import {
  LOJA_OFFLINE_MSG,
  getTenantConfig,
  persistTenantSlug,
  resetTenantConfigCache,
  takeLojaOfflineMessage,
} from '../../lib/tenantConfig'

// Login exclusivo do admin — não tenta mais vendedor/motoboy em cascata
// (isso causava logins acidentais na conta admin: o campo de e-mail vinha
// pré-preenchido com o e-mail do admin e, se a senha digitada por um
// vendedor/motoboy batesse por coincidência com a senha do admin, o login
// "colava" na conta errada). Vendedor/motoboy logam em /funcionarios/login,
// cada um na própria sessão (useVendedorAuth/useMotoboyAuth) — useAdminAuth
// aqui é 100% exclusivo do admin.
//
// Tenant: o backend resolve pelo e-mail+senha. `?tenant=` no deep link do
// dashboard Resolutoo ("Entrar no painel da loja") é só hint opcional.
// `?email=` só vem junto com `?tenant=` pra não vazar e-mail de outra sessão.
//
// Demo pública NUNCA deve cair aqui — /demo-entrar já autentica com mock.
export default function AdminLogin() {
  const { token, login } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  // Só aceita e-mail da query quando há tenant (deep link do Meu Plano).
  // Sem tenant, ignorar ?email= evita vazar e-mail de outra sessão/plataforma.
  const tenantFromUrl = (searchParams.get('tenant') || '').trim().toLowerCase()
  const emailFromUrl = tenantFromUrl ? (searchParams.get('email') || '').trim() : ''

  const [email, setEmail] = useState(emailFromUrl)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Tela de login é a mesma pro motor inteiro (todos os verticais) --
  // quando o deep link já traz `?tenant=`, resolve o vertical ANTES do
  // login pra vestir a identidade visual certa (preto/vermelho do vrtech
  // em vez do verde/dourado genérico da Resolutoo).
  const [isEletronica, setIsEletronica] = useState(false)
  const [lojaNome, setLojaNome] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantFromUrl) return
    getTenantConfig()
      .then((c) => {
        setIsEletronica(c.vertical === 'eletronicos')
        setLojaNome(c.loja_nome ?? null)
      })
      .catch(() => {})
  }, [tenantFromUrl])

  useEffect(() => {
    const fromState =
      location.state &&
      typeof location.state === 'object' &&
      (location.state as { offline?: boolean }).offline
        ? LOJA_OFFLINE_MSG
        : null
    const stashed = takeLojaOfflineMessage()
    if (fromState || stashed) setError(fromState || stashed)
  }, [location.state])

  // Ramo eletrônicos loga por AQUI mesmo -- é o mesmo motor Rust, mesmo JWT
  // de admin. O redirect pro painel nativo (/admin-eletronica) acontece
  // DEPOIS do login, em AdminLayout.tsx (que já sabe o vertical do tenant
  // recém-logado). Nunca sai desta tela antes do submit, nem pro app
  // externo vrtech-jp.vercel.app (descontinuado).

  // Demo ativa nesta aba: pular o formulário (nunca pedir senha / autofill).
  if (isDemoModeActive()) {
    const staff = getDemoStaffSession()
    if (staff?.role === 'admin') return <Navigate to="/admin/pedidos" replace />
    return <Navigate to="/" replace />
  }
  if (token) return <Navigate to="/admin/pedidos" replace />

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    // FormData pega valores preenchidos pelo gerenciador de senhas mesmo
    // quando o React state ainda está vazio (autocomplete sem onChange).
    const fd = new FormData(e.currentTarget)
    const emailVal = String(fd.get('loja-admin-email') || email).trim()
    const passwordVal = String(fd.get('loja-admin-password') || password)
    if (emailVal !== email) setEmail(emailVal)
    if (passwordVal !== password) setPassword(passwordVal)

    if (!emailVal || !passwordVal) {
      setError('Informe e-mail e senha.')
      return
    }

    // Só manda slug quando veio do deep link (?tenant=). localStorage /
    // VITE_TENANT_SLUG / sessão anterior NÃO são hint: um slug antigo
    // forçaria login na loja errada e falharia mesmo com e-mail+senha
    // corretos da loja atual — o backend resolve pelo credential.
    const hintSlug = tenantFromUrl || undefined

    setLoading(true)
    try {
      const res = await authService.staff.adminLogin(emailVal, passwordVal, hintSlug)
      const resolvedSlug = (res.tenant_slug || hintSlug || '').trim().toLowerCase()
      if (!resolvedSlug) {
        setError('Não foi possível identificar a loja. Tente de novo ou use o link do painel Resolutoo.')
        return
      }
      persistTenantSlug(resolvedSlug)
      resetTenantConfigCache()
      login(res.token, res.name, resolvedSlug)
      navigate('/admin/pedidos')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao entrar.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // Deep link do Meu Plano: permite gerenciador de senhas do lojista.
  // Sem tenant: desliga autocomplete pra não colar credenciais da plataforma
  // Resolutoo (mesmo domínio /loja) no formulário do ecommerce.
  const allowPasswordManager = Boolean(tenantFromUrl && emailFromUrl)

  if (isEletronica) {
    const INPUT = 'w-full rounded-xl border border-white/10 bg-[#0a0a0b] px-3 py-2.5 text-sm text-white placeholder:text-[#d4d4d8]/30 outline-none focus:border-[#e0211a] transition-colors'
    return (
      <main className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center px-5">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl p-8 bg-[#161618] border border-white/10"
          autoComplete={allowPasswordManager ? 'on' : 'off'}
        >
          <div className="text-center mb-6 flex flex-col items-center">
            <EletronicaLogo size="lg" showTagline name={lojaNome} />
            <p className="text-[#d4d4d8]/50 text-sm mt-3 flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Painel administrativo
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#d4d4d8] mb-1.5">E-mail</label>
              <input
                className={INPUT}
                type="email"
                name="loja-admin-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={!emailFromUrl}
                autoComplete={allowPasswordManager ? 'username' : 'off'}
              />
            </div>
            <div>
              <label className="block text-sm text-[#d4d4d8] mb-1.5">Senha</label>
              <div className="relative">
                <input
                  className={`${INPUT} pr-12`}
                  type={showPassword ? 'text' : 'password'}
                  name="loja-admin-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus={Boolean(emailFromUrl)}
                  autoComplete={allowPasswordManager ? 'current-password' : 'off'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#d4d4d8]/50 hover:text-white p-1"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div>
                <p className="text-sm text-red-400">{error}</p>
                <p className="text-xs text-[#d4d4d8]/50 mt-1">
                  É motoboy ou vendedor? Essa tela é só pro admin — use o botão abaixo.
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#e0211a] hover:bg-[#a3140f] disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Entrar
            </button>
            <Link
              to="/funcionarios/login"
              className="w-full flex items-center justify-center gap-2 text-sm bg-[#0a0a0b] border border-white/10 text-[#d4d4d8] hover:text-white py-2.5 rounded-xl transition-colors"
            >
              <Users className="w-4 h-4" /> Sou vendedor ou motoboy
            </Link>
          </div>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-son-black text-white flex items-center justify-center px-5">
      <form
        onSubmit={handleSubmit}
        className="sunset-login-card w-full max-w-sm rounded-2xl p-8"
        autoComplete={allowPasswordManager ? 'on' : 'off'}
      >
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
              name="loja-admin-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={!emailFromUrl}
              autoComplete={allowPasswordManager ? 'username' : 'off'}
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <div className="relative">
              <input
                className="input-field pr-12"
                type={showPassword ? 'text' : 'password'}
                name="loja-admin-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus={Boolean(emailFromUrl)}
                autoComplete={allowPasswordManager ? 'current-password' : 'off'}
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
