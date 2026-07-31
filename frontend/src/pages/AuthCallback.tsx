import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, XCircle } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { supabase } from '../lib/supabaseClient'
import { PENDING_SIGNUP_KEY } from './Cadastro'

interface PendingSignup {
  loja_nome: string
  responsavel_nome: string
  whatsapp: string
  senha: string
  plano: string | null
  ciclo?: string | null
}

/** Landing do link de confirmação de e-mail depois do cadastro. O
 * supabase-js já processa o token/code da URL sozinho (detectSessionInUrl,
 * padrão true) — só falta decidir pra onde mandar o lojista. */
export default function AuthCallback() {
  const navigate = useNavigate()
  const ran = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        setError('Não foi possível confirmar sua sessão. O link pode ter expirado — tente entrar novamente.')
        return
      }

      const pendingRaw = localStorage.getItem(PENDING_SIGNUP_KEY)
      if (pendingRaw) {
        localStorage.removeItem(PENDING_SIGNUP_KEY)
        try {
          const pending = JSON.parse(pendingRaw) as PendingSignup
          await api.bootstrap({
            loja_nome: pending.loja_nome,
            responsavel_nome: pending.responsavel_nome,
            whatsapp: pending.whatsapp,
            senha: pending.senha,
          })
          const ciclo = pending.ciclo === 'semestral' ? 'semestral' : 'mensal'
          navigate(pending.plano ? `/assinar?plano=${pending.plano}&ciclo=${ciclo}` : '/planos', { replace: true })
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'Não foi possível concluir seu cadastro.')
        }
        return
      }

      try {
        await api.me()
        navigate('/dashboard', { replace: true })
      } catch {
        navigate('/cadastro', { replace: true })
      }
    })()
  }, [navigate])

  if (error) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-uf-silver-dim">{error}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
    </main>
  )
}
