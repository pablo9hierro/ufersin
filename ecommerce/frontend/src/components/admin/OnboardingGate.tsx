import { useEffect, useState } from 'react'
import { ChevronDown, Clock, Loader2, MessageCircle } from 'lucide-react'
import WhatsAppConnection from '../ui/WhatsAppConnection'
import StoreHoursCard from './StoreHoursCard'
import { adminService } from '../../services/adminService'

function extractState(status: unknown): string {
  const s = status as { instance?: { state?: string }; state?: string } | null
  return s?.instance?.state ?? s?.state ?? 'desconhecido'
}

function Accordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-son-surface border border-white/10 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="font-semibold text-white text-sm sm:text-base">{title}</span>
        <ChevronDown
          className={`w-5 h-5 text-son-silver-dim shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-5 pb-5 border-t border-white/5 pt-4">{children}</div>}
    </div>
  )
}

/**
 * Gate persistente no primeiro acesso ao painel (e se WhatsApp desconectar).
 * Sem nav lateral — só os accordions obrigatórios.
 */
export default function OnboardingGate({
  whatsappRequired,
  onUnlocked,
}: {
  whatsappRequired: boolean
  onUnlocked: () => void
}) {
  const [hoursDone, setHoursDone] = useState(false)
  const [waConnected, setWaConnected] = useState(!whatsappRequired)
  const [loading, setLoading] = useState(true)
  const [openWa, setOpenWa] = useState(true)
  const [openHours, setOpenHours] = useState(true)

  const refresh = async () => {
    try {
      const [gate, waStatus] = await Promise.all([
        adminService.onboardingGate.get(),
        whatsappRequired
          ? adminService.whatsapp.status().then(extractState).catch(() => 'desconhecido')
          : Promise.resolve('open'),
      ])
      setHoursDone(!!gate.onboarding_hours_done)
      const connected = !whatsappRequired || waStatus === 'open'
      setWaConnected(connected)
      if (gate.onboarding_hours_done && connected) onUnlocked()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappRequired])

  // Re-poll WhatsApp while gate is up and WA still required.
  useEffect(() => {
    if (!whatsappRequired || waConnected) return
    const t = setInterval(async () => {
      try {
        const s = extractState(await adminService.whatsapp.status())
        if (s === 'open') {
          setWaConnected(true)
          if (hoursDone) onUnlocked()
        }
      } catch {
        /* ignore */
      }
    }, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappRequired, waConnected, hoursDone])

  if (loading) {
    return (
      <div className="min-h-screen bg-son-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-son-silver-dim" />
      </div>
    )
  }

  const showWa = whatsappRequired && !waConnected
  const showHours = !hoursDone

  return (
    <div className="min-h-screen bg-son-black text-white flex flex-col">
      <header className="px-5 py-5 border-b border-white/5 bg-son-surface">
        <p className="text-xs text-son-silver-dim uppercase tracking-wide mb-1">Configuração inicial</p>
        <h1 className="text-xl sm:text-2xl font-black">
          Conclua as configurações para começar a usar sua loja:
        </h1>
      </header>

      <main className="flex-1 p-5 sm:p-8 max-w-2xl mx-auto w-full space-y-4">
        {showWa && (
          <Accordion title="Conecte o whatsapp da loja" open={openWa} onToggle={() => setOpenWa((v) => !v)}>
            <div className="space-y-3">
              <p className="text-son-silver-dim text-xs flex items-start gap-2">
                <MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Escaneie o QR com o WhatsApp da loja. Você também pode gerenciar depois em Configurações.
              </p>
              <WhatsAppConnection
                api={adminService.whatsapp}
                onConnected={() => {
                  setWaConnected(true)
                  if (hoursDone) onUnlocked()
                  else refresh()
                }}
              />
            </div>
          </Accordion>
        )}

        {showHours && (
          <Accordion
            title="Defina horário de funcionamento"
            open={openHours}
            onToggle={() => setOpenHours((v) => !v)}
          >
            <div className="space-y-3">
              <p className="text-son-silver-dim text-xs flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Salve o horário semanal. Dá pra ajustar depois em Configurações.
              </p>
              <StoreHoursCard
                hideManualToggle
                onSaved={() => {
                  setHoursDone(true)
                  if (!showWa || waConnected) onUnlocked()
                }}
              />
            </div>
          </Accordion>
        )}

        {!showWa && !showHours && (
          <p className="text-son-silver-dim text-sm text-center py-8">Tudo pronto — liberando o painel…</p>
        )}
      </main>
    </div>
  )
}
