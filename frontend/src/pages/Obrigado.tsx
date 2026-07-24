import { useEffect, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { api, type StatusAssinatura } from '../lib/api'
import { useIsAuthenticated } from '../lib/authStore'

const POLL_MS = 3000
const POLL_TIMEOUT_MS = 120_000

export default function Obrigado() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isAuthenticated = useIsAuthenticated()
  const id = searchParams.get('id')
  const [status, setStatus] = useState<StatusAssinatura['status'] | 'verificando' | 'erro'>('verificando')

  useEffect(() => {
    if (!id) {
      setStatus('erro')
      return
    }
    let cancelled = false
    const inicio = Date.now()

    const poll = () => {
      api
        .statusAssinatura(id)
        .then((r) => {
          if (cancelled) return
          setStatus(r.status)
          if (r.status === 'ativo') {
            // Onboarding é a etapa seguinte no fluxo Landing -> Checkout ->
            // Pagamento -> Onboarding — só faz sentido levar pra lá quando
            // já está logado (cadastro novo já guarda o token na hora).
            if (isAuthenticated && r.onboarding_status === 'aguardando_onboarding') {
              setTimeout(() => navigate('/onboarding'), 1800)
            }
            return
          }
          if (Date.now() - inicio < POLL_TIMEOUT_MS) {
            setTimeout(poll, POLL_MS)
          }
        })
        .catch(() => {
          if (!cancelled) setStatus('erro')
        })
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [id, isAuthenticated, navigate])

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        {(status === 'verificando' || status === 'pendente') && (
          <>
            <Loader2 className="w-10 h-10 animate-spin uf-text mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Confirmando sua assinatura…</h1>
            <p className="text-sm text-uf-silver-dim">
              Isso costuma levar só alguns segundos depois de autorizar o pagamento. Não feche esta página.
            </p>
          </>
        )}

        {status === 'ativo' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-2xl font-black mb-2">Assinatura ativa 🎉</h1>
            <p className="text-sm text-uf-silver-dim mb-6">
              {isAuthenticated ? 'Te levando pra configurar sua loja...' : 'Faça login pra continuar configurando sua loja.'}
            </p>
          </>
        )}

        {(status === 'pausado' || status === 'cancelado') && (
          <>
            <Clock className="w-12 h-12 text-amber-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Assinatura {status}</h1>
            <p className="text-sm text-uf-silver-dim mb-6">Entre em contato com a gente se isso não era esperado.</p>
          </>
        )}

        {status === 'erro' && (
          <>
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Não encontramos sua assinatura</h1>
            <p className="text-sm text-uf-silver-dim mb-6">
              Se você concluiu o pagamento e isso persistir, fale com a gente pelo WhatsApp.
            </p>
          </>
        )}

        <Link to="/" className="text-sm uf-text font-semibold hover:underline">
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}
