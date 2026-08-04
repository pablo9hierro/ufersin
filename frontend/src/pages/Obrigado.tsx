import { useEffect, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { api, ApiError, type StatusAssinatura } from '../lib/api'
import { useIsAuthenticated } from '../lib/authStore'
import { resolvePostPayDestination } from '../lib/postPayRedirect'

const POLL_MS = 3000
const POLL_TIMEOUT_MS = 120_000

export default function Obrigado() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isAuthenticated = useIsAuthenticated()
  const id = searchParams.get('id')
  const checkoutUrl = searchParams.get('checkout')
  const [status, setStatus] = useState<StatusAssinatura['status'] | 'verificando' | 'erro'>('verificando')
  const [sandbox, setSandbox] = useState(Boolean(checkoutUrl))
  const [simulating, setSimulating] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setStatus('erro')
      return
    }
    let cancelled = false
    const inicio = Date.now()

    const poll = () => {
      if (cancelled) return
      api
        .statusAssinatura(id)
        .then((r) => {
          if (cancelled) return
          setStatus(r.status)
          setSandbox(Boolean(r.sandbox))
          if (r.status === 'ativo') {
            if (!isAuthenticated) return
            void resolvePostPayDestination(r.onboarding_status).then((dest) => {
              if (!cancelled) setTimeout(() => navigate(dest), 1200)
            })
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

  const handleSimulate = async () => {
    setSimError(null)
    setSimulating(true)
    try {
      const r = await api.simularPagamento()
      setStatus(r.status)
      setSandbox(Boolean(r.sandbox))
      if (r.status === 'ativo' && isAuthenticated) {
        void resolvePostPayDestination(r.onboarding_status).then((dest) => {
          setTimeout(() => navigate(dest), 800)
        })
      }
    } catch (e) {
      setSimError(e instanceof ApiError ? e.message : 'Não foi possível simular o pagamento.')
    } finally {
      setSimulating(false)
    }
  }

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
            {(sandbox || checkoutUrl) && isAuthenticated && (
              <div className="mt-6 uf-glass rounded-2xl p-4 text-left space-y-3">
                <p className="text-xs text-amber-300/90">
                  Homologação — nenhum valor real será cobrado. Simule pra avançar, ou abra o checkout de teste.
                </p>
                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={simulating}
                  className="btn-primary w-full py-3"
                >
                  {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Simular pagamento
                </button>
                {checkoutUrl && (
                  <a
                    href={checkoutUrl}
                    className="block text-center text-sm uf-text font-semibold hover:underline py-2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir checkout de pagamento
                  </a>
                )}
                {simError && <p className="error-msg">{simError}</p>}
              </div>
            )}
          </>
        )}

        {status === 'ativo' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-2xl font-black mb-2">Assinatura ativa</h1>
            <p className="text-sm text-uf-silver-dim mb-6">
              {isAuthenticated
                ? 'Te levando pra área logada...'
                : 'Faça login pra continuar configurando sua loja.'}
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
            {sandbox && isAuthenticated && (
              <button type="button" onClick={handleSimulate} disabled={simulating} className="btn-primary w-full py-3 mb-4">
                {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Simular pagamento (homologação)
              </button>
            )}
          </>
        )}

        <Link to="/" className="text-sm uf-text font-semibold hover:underline">
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}
