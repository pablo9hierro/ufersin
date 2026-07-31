import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, XCircle } from 'lucide-react'
import { ApiError } from '../lib/api'
import { supabase } from '../lib/supabaseClient'
import { finishSignupAfterConfirm } from '../lib/finishSignup'

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
      // Espera um pouco o supabase processar o hash/code da URL.
      for (let i = 0; i < 20; i++) {
        const { data } = await supabase.auth.getSession()
        if (data.session) break
        await new Promise((r) => setTimeout(r, 150))
      }
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        setError('Não foi possível confirmar sua sessão. O link pode ter expirado — tente entrar novamente.')
        return
      }

      try {
        const dest = await finishSignupAfterConfirm()
        navigate(dest, { replace: true })
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Não foi possível concluir seu cadastro.')
      }
    })()
  }, [navigate])

  if (error) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-uf-silver-dim mb-4">{error}</p>
          <a href="/login" className="btn-primary text-sm px-4 py-2 inline-flex">
            Ir pro login
          </a>
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
