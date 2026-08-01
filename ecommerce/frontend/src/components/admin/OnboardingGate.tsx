import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Clock, Loader2, MessageCircle } from 'lucide-react'
import WhatsAppConnection from '../ui/WhatsAppConnection'
import StoreHoursCard from './StoreHoursCard'
import { adminService } from '../../services/adminService'
import { classifyWaStatusPayload, WA_GATE_CONFIRM_STREAK, WaGateDebouncer } from '../../lib/whatsappGate'

function Accordion({
  title,
  open,
  onToggle,
  children,
  centered,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  centered?: boolean
}) {
  return (
    <div className="bg-son-surface border border-white/10 rounded-2xl overflow-hidden w-full">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-white/[0.03] transition-colors ${
          centered ? 'text-center' : 'text-left'
        }`}
      >
        <span className={`font-semibold text-white text-sm sm:text-base flex-1 ${centered ? 'text-center' : ''}`}>
          {title}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-son-silver-dim shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-5 pb-5 border-t border-white/5 pt-4">{children}</div>}
    </div>
  )
}

/**
 * Full-screen etapa-2 gate.
 * - First access: WhatsApp (if enabled) + hours.
 * - Reconnect (hours already done): WhatsApp ONLY.
 */
export default function OnboardingGate({
  whatsappRequired,
  hoursDone: hoursDoneProp,
  onHoursSaved,
  onUnlocked,
}: {
  whatsappRequired: boolean
  /** From AdminLayout — source of truth so reconnect never flashes the hours form. */
  hoursDone: boolean
  onHoursSaved: () => void
  onUnlocked: () => void
}) {
  const [hoursDone, setHoursDone] = useState(hoursDoneProp)
  const [waConnected, setWaConnected] = useState(!whatsappRequired)
  const [bootstrapping, setBootstrapping] = useState(whatsappRequired)
  const [openWa, setOpenWa] = useState(true)
  const [openHours, setOpenHours] = useState(true)
  const unlockDebounce = useRef(new WaGateDebouncer(WA_GATE_CONFIRM_STREAK))
  const hoursDoneRef = useRef(hoursDone)
  hoursDoneRef.current = hoursDone

  useEffect(() => {
    setHoursDone(hoursDoneProp)
  }, [hoursDoneProp])

  // Initial WA read — only unlock on definitive open; never treat errors as connected.
  useEffect(() => {
    if (!whatsappRequired) {
      setWaConnected(true)
      setBootstrapping(false)
      if (hoursDoneRef.current) onUnlocked()
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const verdict = classifyWaStatusPayload(await adminService.whatsapp.status())
        if (cancelled) return
        if (verdict === 'open') {
          setWaConnected(true)
          if (hoursDoneRef.current) onUnlocked()
        } else {
          // closed OR pending: stay on gate (pending = still connecting / QR).
          setWaConnected(false)
        }
      } catch {
        if (!cancelled) setWaConnected(false)
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappRequired])

  // While gated and WA down: poll for definitive `open` only (debounced). Never re-lock here.
  useEffect(() => {
    if (!whatsappRequired || waConnected || bootstrapping) return
    const t = setInterval(async () => {
      try {
        const verdict = classifyWaStatusPayload(await adminService.whatsapp.status())
        const confirmed = unlockDebounce.current.observe(verdict)
        if (confirmed === 'open') {
          setWaConnected(true)
          if (hoursDoneRef.current) onUnlocked()
        }
      } catch {
        /* ignore blips */
      }
    }, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappRequired, waConnected, bootstrapping])

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-son-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-silver-dim" />
      </div>
    )
  }

  const showWa = whatsappRequired && !waConnected
  // Hours ONLY on first access — never on reconnect gate.
  const showHours = !hoursDone
  const isReconnect = hoursDone && showWa

  return (
    <div className="min-h-screen bg-son-black text-white flex flex-col items-center">
      <header className="w-full px-5 py-8 sm:py-10 border-b border-white/5 bg-son-surface">
        <div className="max-w-lg mx-auto text-center space-y-2">
          <p className="text-xs text-son-silver-dim uppercase tracking-wide">
            {isReconnect ? 'WhatsApp desconectado' : 'Configuração inicial'}
          </p>
          <h1 className="text-xl sm:text-2xl font-black leading-snug">
            {isReconnect
              ? 'Reconecte o WhatsApp da loja para continuar'
              : 'Conclua as configurações para começar a usar sua loja'}
          </h1>
          {isReconnect ? (
            <p className="text-sm text-son-silver-dim">
              O painel fica bloqueado enquanto o WhatsApp estiver offline.
            </p>
          ) : null}
        </div>
      </header>

      <main className="flex-1 w-full flex flex-col items-center justify-start px-5 py-8 sm:py-10">
        <div className="w-full max-w-lg mx-auto flex flex-col items-center gap-4">
          {showWa && (
            <Accordion
              title="Conecte o WhatsApp da loja"
              open={openWa}
              onToggle={() => setOpenWa((v) => !v)}
              centered
            >
              <div className="space-y-4 flex flex-col items-center text-center">
                <p className="text-son-silver-dim text-xs flex items-start gap-2 text-left max-w-sm">
                  <MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Escaneie o QR com o WhatsApp da loja. Você também pode gerenciar depois em Configurações.
                </p>
                <div className="w-full flex justify-center">
                  <WhatsAppConnection
                    api={adminService.whatsapp}
                    onConnected={() => {
                      unlockDebounce.current.force('open')
                      setWaConnected(true)
                      if (hoursDoneRef.current) onUnlocked()
                    }}
                  />
                </div>
              </div>
            </Accordion>
          )}

          {showHours && (
            <Accordion
              title="Defina horário de funcionamento"
              open={openHours}
              onToggle={() => setOpenHours((v) => !v)}
              centered
            >
              <div className="space-y-3 flex flex-col items-center">
                <p className="text-son-silver-dim text-xs flex items-start gap-2 text-left max-w-sm w-full">
                  <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Salve o horário semanal. Dá pra ajustar depois em Configurações.
                </p>
                <div className="w-full">
                  <StoreHoursCard
                    hideManualToggle
                    onSaved={() => {
                      setHoursDone(true)
                      hoursDoneRef.current = true
                      onHoursSaved()
                      if (!showWa || waConnected) onUnlocked()
                    }}
                  />
                </div>
              </div>
            </Accordion>
          )}

          {!showWa && !showHours && (
            <p className="text-son-silver-dim text-sm text-center py-8">Tudo pronto — liberando o painel…</p>
          )}
        </div>
      </main>
    </div>
  )
}
