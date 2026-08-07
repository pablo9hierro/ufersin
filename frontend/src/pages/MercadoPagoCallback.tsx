import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, XCircle } from 'lucide-react'

/** Volta pra cá depois do backend trocar o code OAuth por token e salvar as
 * credenciais (ver ufersin/backend/src/mercadopago_oauth.rs::oauth_callback)
 * — o trabalho pesado já foi feito lá, aqui só decide pra onde navegar. */
export default function MercadoPagoCallback() {
  const navigate = useNavigate()
  const ran = useRef(false)
  const [error, setError] = useState<string | null>(null)
  // flow=platform é a conta Mercado Pago DA RESOLUTOO (recebe assinaturas,
  // conectada em /dashboard) — nunca confundir com a do lojista (default).
  const isPlatform = new URLSearchParams(window.location.search).get('flow') === 'platform'
  const backTo = isPlatform ? '/dashboard' : '/onboarding'

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const status = new URLSearchParams(window.location.search).get('status')
    if (status === 'success') {
      navigate(backTo, { replace: true })
      return
    }
    if (status === 'cancelled') {
      setError('Conexão cancelada — você pode tentar de novo quando quiser.')
      return
    }
    setError('Não foi possível conectar sua conta Mercado Pago. Tente de novo.')
  }, [navigate])

  if (error) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <div>
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-uf-silver-dim mb-4">{error}</p>
          <a href={backTo} className="btn-primary text-sm px-4 py-2 inline-flex">
            Voltar
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
