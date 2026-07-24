import { useEffect, useState } from 'react'
import { Loader2, Smartphone, Unplug } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import type { EvolutionConnect } from '../../lib/types'

// O Baileys/Evolution API expira e troca o QR sozinho no servidor a cada
// ~20-30s, independente de qualquer chamada do frontend. Sem repolling, a
// imagem exibida fica "morta" depois desse tempo — é exatamente isso que
// explica "funcionou escaneando do computador, não funcionou do celular":
// só uma questão de quanto tempo demorou até escanear, não do aparelho em
// si. Repollar garante um QR sempre vivo, em qualquer dispositivo.
const POLL_STATUS_MS = 4000
const REFRESH_QR_MS = 25000

function extractState(status: unknown): string {
  const s = status as { instance?: { state?: string }; state?: string } | null
  return s?.instance?.state ?? s?.state ?? 'desconhecido'
}

function extractQrImage(data: EvolutionConnect): string | null {
  const b64 = data.base64 ?? data.qrcode?.base64
  if (!b64) return null
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`
}

function extractPairingCode(data: EvolutionConnect): string | null {
  return data.pairingCode ?? data.code ?? data.qrcode?.pairingCode ?? data.qrcode?.code ?? null
}

export default function WhatsAppConnection({
  api,
}: {
  api: {
    status: () => Promise<unknown>
    connect: () => Promise<EvolutionConnect>
    logout: () => Promise<void>
  }
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [qr, setQr] = useState<EvolutionConnect | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = async (): Promise<string | null> => {
    setLoadingStatus(true)
    setError(null)
    try {
      const data = await api.status()
      const s = extractState(data)
      setStatus(s)
      return s
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível consultar o status.')
      setStatus(null)
      return null
    } finally {
      setLoadingStatus(false)
    }
  }

  useEffect(() => {
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connected = status === 'open'

  // Enquanto o QR estiver na tela e a conexão ainda não fechou, mantém
  // checando se o scan já aconteceu e troca o QR periodicamente antes que
  // ele expire — sem isso, o QR fica visualmente "válido" mas morto.
  useEffect(() => {
    if (!qr || connected) return
    let cancelled = false

    const statusTimer = setInterval(async () => {
      const s = await loadStatus()
      if (!cancelled && s === 'open') setQr(null)
    }, POLL_STATUS_MS)

    const qrTimer = setInterval(async () => {
      try {
        const data = await api.connect()
        if (!cancelled) setQr(data)
      } catch {
        // silencioso — tenta de novo no próximo tick
      }
    }, REFRESH_QR_MS)

    return () => {
      cancelled = true
      clearInterval(statusTimer)
      clearInterval(qrTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr, connected])

  const connect = async () => {
    setConnecting(true)
    setError(null)
    setQr(null)
    try {
      const data = await api.connect()
      setQr(data)
      await loadStatus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o QR code.')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setDisconnecting(true)
    setError(null)
    try {
      await api.logout()
      setQr(null)
      await loadStatus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível desconectar.')
    } finally {
      setDisconnecting(false)
    }
  }

  const qrImage = qr ? extractQrImage(qr) : null
  const pairingCode = qr ? extractPairingCode(qr) : null

  return (
    <div className="max-w-sm bg-son-surface border border-white/5 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-son-silver-dim">Status</span>
        {loadingStatus ? (
          <Loader2 className="w-4 h-4 animate-spin text-son-silver-dim" />
        ) : (
          <span className={`text-sm font-semibold ${connected ? 'text-green-500' : 'text-son-silver-dim'}`}>
            {connected ? 'Conectado' : status === 'connecting' ? 'Conectando…' : 'Desconectado'}
          </span>
        )}
      </div>

      {error && <p className="error-msg">{error}</p>}

      {qrImage && (
        <div className="text-center">
          <img src={qrImage} alt="QR Code do WhatsApp" className="mx-auto rounded-lg border border-white/10" />
          <p className="text-xs text-son-silver-dim mt-2">
            Escaneie pelo WhatsApp do celular: Aparelhos conectados → Conectar um aparelho.
          </p>
        </div>
      )}
      {!qrImage && pairingCode && (
        <p className="text-center text-sm text-son-silver">
          Código de pareamento: <span className="font-mono font-bold">{pairingCode}</span>
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={connect} disabled={connecting} className="btn-secondary flex-1 text-sm py-2">
          {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Smartphone className="w-3.5 h-3.5" />}
          {connected ? 'Gerar novo QR' : 'Conectar'}
        </button>
        <button
          onClick={disconnect}
          disabled={disconnecting || !connected}
          className="btn-secondary flex-1 text-sm py-2"
        >
          {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
          Desconectar
        </button>
      </div>
    </div>
  )
}
