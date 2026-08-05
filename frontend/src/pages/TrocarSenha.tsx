import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, Loader2 } from 'lucide-react'
import { supabaseLojista } from '../lib/supabaseClient'
import { translateAuthError } from '../lib/authErrors'
import { ApiError, api } from '../lib/api'
import { useAuthReady, useLojistaSession } from '../lib/authStore'
import PasswordField from '../components/PasswordField'
import { resolveSessionHome } from '../lib/sessionHome'

/** Trocar senha logado (/meu-plano → Trocar senha).
 * 1) Supabase Auth (login Resolutoo)
 * 2) /api/me/senha → Argon2 + sync admin ecommerce
 * Se o sync da loja falhar, mostra erro (não finge sucesso). */
export default function TrocarSenha() {
  const session = useLojistaSession()
  const ready = useAuthReady()
  const navigate = useNavigate()
  const [novaSenha, setNovaSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (ready && !session) {
    return <Navigate to="/esqueci-senha" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (novaSenha.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (novaSenha !== confirma) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)
    try {
      const { error: updateError } = await supabaseLojista.auth.updateUser({ password: novaSenha })
      if (updateError) throw updateError
      try {
        await api.mudarSenha(novaSenha)
      } catch (syncErr) {
        const msg =
          syncErr instanceof ApiError
            ? syncErr.message
            : 'Senha do Resolutoo atualizada, mas não sincronizou com o painel da loja. Tente de novo.'
        throw new Error(msg)
      }
      const dest = await resolveSessionHome().catch(() => '/meu-plano')
      navigate(dest, { replace: true })
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.includes(' ')
            ? e.message
            : translateAuthError(e.message)
          : 'Não foi possível trocar a senha.',
      )
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
          <Link to="/meu-plano" className="text-2xl font-black uf-text">
            Resolutoo
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">
            Nova senha vale no Resolutoo e no painel da loja.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <PasswordField
            label="Nova senha"
            value={novaSenha}
            onChange={setNovaSenha}
            placeholder="Pelo menos 8 caracteres"
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirmar senha"
            value={confirma}
            onChange={setConfirma}
            placeholder="Repita a senha"
            autoComplete="new-password"
          />
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={loading || !ready} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Salvar senha
          </button>
        </form>

        <p className="text-xs text-center text-uf-silver-dim mt-5">
          <Link to="/meu-plano" className="hover:text-uf-silver">
            Voltar ao Meu plano
          </Link>
        </p>
      </motion.div>
    </main>
  )
}
