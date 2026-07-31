import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, Rocket } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
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
  const [error, setError] = useState<string | null>(null)

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
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
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível concluir sua conta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">E-mail confirmado! Só falta completar os dados da loja.</p>
          {session?.user?.email && (
            <p className="text-xs text-uf-silver-dim mt-1">
              Conta: <span className="text-uf-silver">{session.user.email}</span>
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">Nome da loja *</label>
            <input className="input-field" value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} placeholder="Ex: Sunset Tabas" />
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
