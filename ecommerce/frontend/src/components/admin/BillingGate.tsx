import { useEffect, useRef, useState } from 'react'
import { Loader2, Copy, Check, AlertTriangle } from 'lucide-react'
import { platformApiUrl, platformOrigin } from '../../lib/platformUrl'

type Fatura = {
  status: 'ativo' | 'pausado' | 'cancelado'
  valor: number
  ciclo: string
  loja_nome: string
  grace_until: string | null
  pix_qr_code: string | null
  pix_qr_base64: string | null
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatGraceDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/**
 * Tela persistente de cobrança de renovação -- mesmo espírito do gate de
 * WhatsApp desconectado (OnboardingGate.tsx): bloqueia o painel inteiro
 * enquanto a assinatura está `pausado` (vencida, dentro da janela de 3
 * dias úteis de tolerância) e some sozinha assim que o Pix é pago.
 *
 * Fala com a API da PLATAFORMA (ufersin-api) por slug público -- o painel
 * da loja só tem o JWT de admin da loja, nunca o JWT de assinante da
 * plataforma (são dois sistemas de auth separados).
 */
export default function BillingGate({
  slug,
  onUnlocked,
  onNotFound,
}: {
  slug: string
  onUnlocked: () => void
  /** Assinante nunca existiu / não tem registro de cobrança -- cai no
   * comportamento antigo (logout pro /admin/login). */
  onNotFound: () => void
}) {
  const [fatura, setFatura] = useState<Fatura | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const onUnlockedRef = useRef(onUnlocked)
  const onNotFoundRef = useRef(onNotFound)
  onUnlockedRef.current = onUnlocked
  onNotFoundRef.current = onNotFound

  const load = async () => {
    try {
      const res = await fetch(`${platformApiUrl()}/api/public/loja/${encodeURIComponent(slug)}/fatura`)
      if (res.status === 404) {
        onNotFoundRef.current()
        return
      }
      if (!res.ok) throw new Error('falha ao buscar fatura')
      const data: Fatura = await res.json()
      setFatura(data)
      setError(null)
      if (data.status === 'ativo') onUnlockedRef.current()
    } catch {
      setError('Não foi possível checar a fatura agora. Tentando de novo…')
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const handleCopy = () => {
    if (!fatura?.pix_qr_code) return
    navigator.clipboard.writeText(fatura.pix_qr_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      const res = await fetch(`${platformApiUrl()}/api/public/loja/${encodeURIComponent(slug)}/fatura/pagar`, {
        method: 'POST',
      })
      if (res.ok) setFatura(await res.json())
    } finally {
      setRegenerating(false)
    }
  }

  if (!fatura) {
    return (
      <div className="min-h-screen bg-son-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-silver-dim" />
      </div>
    )
  }

  if (fatura.status === 'cancelado') {
    return (
      <div className="min-h-screen bg-son-black text-white flex items-center justify-center px-5">
        <div className="max-w-md text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-xl font-black">Assinatura cancelada por falta de pagamento</h1>
          <p className="text-sm text-son-silver-dim">
            A janela de 3 dias úteis de tolerância pra pagar a mensalidade venceu, e qualquer cupom de desconto
            associado à sua loja foi perdido. Pra reativar, entre no painel de assinatura no site da Resolutoo —
            a mensalidade vai ser cobrada pelo valor de tabela atual, sem desconto.
          </p>
          <a
            href={`${platformOrigin()}/meu-plano`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 px-5 py-3 rounded-xl bg-son-pink text-white text-sm font-semibold hover:opacity-90"
          >
            Reativar assinatura no Resolutoo →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-son-black text-white flex flex-col items-center">
      <header className="w-full px-5 py-8 sm:py-10 border-b border-white/5 bg-son-surface">
        <div className="max-w-lg mx-auto text-center space-y-2">
          <p className="text-xs text-son-silver-dim uppercase tracking-wide">Assinatura vencida</p>
          <h1 className="text-xl sm:text-2xl font-black leading-snug">Renove a mensalidade pra continuar</h1>
          <p className="text-sm text-son-silver-dim">
            O painel fica bloqueado até o pagamento cair. Assim que o Pix for confirmado, o acesso volta sozinho.
          </p>
        </div>
      </header>

      <main className="flex-1 w-full flex flex-col items-center justify-start px-5 py-8 sm:py-10">
        <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-5 bg-son-surface border border-white/10 rounded-2xl p-6">
          <div className="text-center">
            <p className="text-3xl font-black">R$ {formatBRL(fatura.valor)}</p>
            <p className="text-xs text-son-silver-dim mt-1">
              {fatura.ciclo === 'semestral' ? 'semestral' : 'mensal'} — mesmo valor da sua última mensalidade
            </p>
          </div>

          {fatura.grace_until && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-center">
              Pague até <strong>{formatGraceDate(fatura.grace_until)}</strong> (3 dias úteis do vencimento) pra
              manter o desconto do seu cupom. Depois disso a assinatura é cancelada e qualquer cupom aplicado à
              loja se perde — a reativação passa a custar o valor de tabela do momento.
            </p>
          )}

          {fatura.pix_qr_base64 ? (
            <img
              src={`data:image/png;base64,${fatura.pix_qr_base64}`}
              alt="QR Code Pix"
              className="w-44 h-44 rounded-xl bg-white p-2"
            />
          ) : (
            <div className="w-44 h-44 rounded-xl bg-white/5 flex items-center justify-center text-xs text-son-silver-dim text-center px-3">
              QR indisponível — copie o código abaixo
            </div>
          )}

          {fatura.pix_qr_code && (
            <button
              type="button"
              onClick={handleCopy}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Código copiado' : 'Copiar código Pix (copia e cola)'}
            </button>
          )}

          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-xs text-son-silver-dim hover:text-white underline disabled:opacity-50"
          >
            {regenerating ? 'Gerando novo QR…' : 'QR expirou? Gerar um novo'}
          </button>

          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        </div>
      </main>
    </div>
  )
}
