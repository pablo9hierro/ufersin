import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, LogOut, Rocket } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { authStore, useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { isKnownPlatformAdminEmail } from '../lib/platformAdmin'
import { resolveSessionHome } from '../lib/sessionHome'
import PasswordField from '../components/PasswordField'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

/** Conta Supabase confirmada, mas sem linha em `subscribers` (ex.: confirmou
 * o e-mail sem o pending do localStorage — link localhost, outro aparelho…). */
export default function CompletarConta() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()

  const [lojaNome, setLojaNome] = useState('')
  const [responsavelNome, setResponsavelNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [adminCheckError, setAdminCheckError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  const email = session?.user?.email ?? null
  const knownAdmin = isKnownPlatformAdminEmail(email)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await authStore.signOut('lojista')
    } finally {
      setLoggingOut(false)
      navigate('/login', { replace: true })
    }
  }

  // Superadmin nunca completa conta de lojista — manda direto pro /dashboard.
  // Quem está em KNOWN_PLATFORM_ADMIN_EMAILS também vai pro dashboard mesmo
  // se /api/superadmin/whoami estiver 404 (API antiga no Railway).
  useEffect(() => {
    if (!ready || !isAuthenticated) {
      setCheckingAdmin(false)
      return
    }
    if (knownAdmin) {
      navigate('/dashboard', { replace: true })
      return
    }
    let cancelled = false
    setCheckingAdmin(true)
    setAdminCheckError(null)
    api
      .superadminWhoami(session?.access_token ?? undefined)
      .then(() => {
        if (!cancelled) navigate('/dashboard', { replace: true })
      })
      .catch((e) => {
        if (cancelled) return
        // 403 = autenticado e não é admin → formulário lojista.
        // Qualquer outro erro (404/5xx/rede) NÃO assume lojista: mantém
        // loading + retry, com Sair disponível.
        if (e instanceof ApiError && e.status === 403) {
          setCheckingAdmin(false)
          return
        }
        setAdminCheckError(
          e instanceof ApiError
            ? e.status === 404
              ? 'Painel admin ainda não está disponível na API. Tente de novo em instantes ou saia e entre depois.'
              : e.message
            : 'Não foi possível verificar seu acesso.',
        )
        // fica em checkingAdmin=true (sem mostrar form de loja)
      })
    return () => {
      cancelled = true
    }
  }, [ready, isAuthenticated, navigate, knownAdmin, retryTick])

  const logoutControl = (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loggingOut}
      className="fixed top-4 right-4 z-50 inline-flex items-center gap-2 rounded-lg border border-uf-silver/20 bg-uf-black/80 px-3 py-2 text-sm text-uf-silver hover:border-uf-silver/40 hover:text-white backdrop-blur"
    >
      {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
      Sair
    </button>
  )

  if (!ready || checkingAdmin || knownAdmin) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex flex-col items-center justify-center gap-4 px-5 relative">
        {isAuthenticated && logoutControl}
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
        {adminCheckError && (
          <div className="text-center max-w-sm space-y-3">
            <p className="text-sm text-uf-silver-dim">{adminCheckError}</p>
            <button type="button" className="btn-secondary text-sm px-4 py-2" onClick={() => setRetryTick((n) => n + 1)}>
              Tentar de novo
            </button>
          </div>
        )}
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/cadastro" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!lojaNome.trim() || !responsavelNome.trim()) {
      setError('Informe o nome da loja e do responsável.')
      return
    }
    const digits = whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (senha.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres (mesma do login).')
      return
    }
    setLoading(true)
    try {
      await api.bootstrap({
        loja_nome: lojaNome.trim(),
        responsavel_nome: responsavelNome.trim(),
        whatsapp: `55${digits}`,
        senha,
      })
      const dest = await resolveSessionHome()
      navigate(dest, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível concluir sua conta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      {logoutControl}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">E-mail confirmado! Só falta completar os dados da loja.</p>
          {email && (
            <p className="text-xs text-uf-silver-dim mt-1">
              Conta: <span className="text-uf-silver">{email}</span>
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">Nome da loja *</label>
            <input className="input-field" value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} placeholder="Ex: Minha Loja" />
          </div>
          <div>
            <label className="label">Seu nome *</label>
            <input className="input-field" value={responsavelNome} onChange={(e) => setResponsavelNome(e.target.value)} placeholder="Nome completo" />
          </div>
          <div>
            <label className="label">WhatsApp *</label>
            <input
              className="input-field"
              value={whatsapp}
              onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
              type="tel"
              inputMode="numeric"
              placeholder="(83) 99999-9999"
              maxLength={15}
            />
          </div>
          <PasswordField
            label="Senha da conta *"
            value={senha}
            onChange={setSenha}
            placeholder="A mesma senha do cadastro"
            autoComplete="current-password"
            hint="Usamos só pra liberar o acesso ao painel da sua loja depois."
          />
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Continuar pro painel
          </button>
        </form>
      </motion.div>
    </main>
  )
}
