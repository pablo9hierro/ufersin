import { useEffect, useState } from 'react'
import { Bell, Loader2, PartyPopper, Wallet, X } from 'lucide-react'
import { adminService } from '../../services/adminService'
import { payrollService } from '../../services/payrollService'
import type { PayrollAlert, PayrollPayment } from '../../types'

const POLL_MS = 60_000

interface EmployeeNotification {
  id: string
  message: string
  created_at: string
}

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/** Sino de notificação de pagamento fixo (motoboy/vendedor) — "admin" mostra
 * quem está a até 2 dias do vencimento e deixa registrar o pagamento;
 * "staff" mostra os pagamentos que o admin já reportou, só com botão de
 * confirmar (nunca recusar). */
export default function PayrollBell({ mode }: { mode: 'admin' | 'staff' }) {
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<PayrollAlert[]>([])
  const [pending, setPending] = useState<PayrollPayment[]>([])
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([])
  const [reporting, setReporting] = useState<PayrollAlert | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cartao' | 'dinheiro'>('pix')
  const [confirming, setConfirming] = useState<PayrollPayment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    if (mode === 'admin') {
      adminService.payroll.alerts().then(setAlerts).catch(() => {})
      adminService.employeeNotifications().then(setNotifications).catch(() => {})
    } else {
      payrollService.myPending().then(setPending).catch(() => {})
      payrollService.myNotifications().then(setNotifications).catch(() => {})
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const count = (mode === 'admin' ? alerts.length : pending.length) + notifications.length

  const confirmReportPayment = async () => {
    if (!reporting) return
    setBusy(true)
    setError(null)
    try {
      await adminService.payroll.reportPayment(reporting.employee_role, reporting.employee_id, paymentMethod)
      setReporting(null)
      load()
    } catch {
      setError('Não foi possível registrar o pagamento.')
    } finally {
      setBusy(false)
    }
  }

  const confirmReceived = async () => {
    if (!confirming) return
    setBusy(true)
    setError(null)
    try {
      await payrollService.confirm(confirming.id)
      setConfirming(null)
      load()
    } catch {
      setError('Não foi possível confirmar o recebimento.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white/5 text-son-silver-dim hover:text-white transition-colors"
        aria-label="Notificações de pagamento"
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-son-pink text-white text-[10px] font-bold flex items-center justify-center">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Bell className="w-4 h-4 text-son-pink" /> Notificações
              </h3>
              <button onClick={() => setOpen(false)} className="text-son-silver-dim hover:text-white p-1 -m-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[26rem] overflow-y-auto divide-y divide-white/5">
              {mode === 'admin' &&
                (alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Wallet className="w-7 h-7 mx-auto mb-2 text-son-silver-dim opacity-30" />
                    <p className="text-xs text-son-silver-dim">Nenhum pagamento de funcionário pendente.</p>
                  </div>
                ) : (
                  alerts.map((a) => (
                    <button
                      key={`${a.employee_role}-${a.employee_id}`}
                      onClick={() => {
                        if (!a.payment_id) {
                          setReporting(a)
                          setPaymentMethod('pix')
                        }
                        setOpen(false)
                      }}
                      disabled={!!a.payment_id}
                      className="w-full flex items-start gap-3 text-left px-4 py-3 hover:bg-white/5 disabled:opacity-60 disabled:hover:bg-transparent transition-colors"
                    >
                      <span className="shrink-0 w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-amber-400" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-white font-medium truncate">
                          {a.name} <span className="text-son-silver-dim text-xs font-normal">({a.employee_role})</span>
                        </span>
                        <span className="block text-xs text-son-gold font-semibold mt-0.5">{currency(a.amount)}</span>
                        <span className="block text-xs text-son-silver-dim mt-0.5">
                          {a.payment_id ? 'Aguardando confirmação do funcionário' : 'Faltam ≤2 dias — toque pra informar que pagou'}
                        </span>
                      </span>
                    </button>
                  ))
                ))}
              {mode === 'staff' &&
                (pending.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Wallet className="w-7 h-7 mx-auto mb-2 text-son-silver-dim opacity-30" />
                    <p className="text-xs text-son-silver-dim">Nenhum pagamento pendente.</p>
                  </div>
                ) : (
                  pending.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setConfirming(p)
                        setOpen(false)
                      }}
                      className="w-full flex items-start gap-3 text-left px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <span className="shrink-0 w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-amber-400" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-white font-semibold">{currency(p.amount)}</span>
                        <span className="block text-xs text-son-silver-dim mt-0.5">
                          Loja informou pagamento via {p.payment_method} — toque pra confirmar recebimento
                        </span>
                      </span>
                    </button>
                  ))
                ))}
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="shrink-0 w-8 h-8 rounded-full bg-son-gold/15 flex items-center justify-center">
                    <PartyPopper className="w-4 h-4 text-son-gold" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-white">{n.message}</span>
                    <span className="block text-xs text-son-silver-dim mt-0.5">{relativeTime(n.created_at)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {reporting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setReporting(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Informar pagamento — {reporting.name}</h3>
              <button onClick={() => setReporting(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-son-silver-dim mb-4">
              Valor: <span className="text-son-gold font-semibold">{currency(reporting.amount)}</span>
            </p>
            <label className="label">Forma de pagamento</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(['pix', 'cartao', 'dinheiro'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`py-2 rounded-xl border text-sm font-medium capitalize transition-all ${
                    paymentMethod === m ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {error && <p className="error-msg mb-3">{error}</p>}
            <button onClick={confirmReportPayment} disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirmar que paguei
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Confirmar recebimento</h3>
              <button onClick={() => setConfirming(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-son-silver-dim mb-4">
              A loja informou que pagou <span className="text-son-gold font-semibold">{currency(confirming.amount)}</span> via{' '}
              {confirming.payment_method}. Confirme só depois de ter recebido de verdade.
            </p>
            {error && <p className="error-msg mb-3">{error}</p>}
            <button onClick={confirmReceived} disabled={busy} className="btn-primary w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirmar recebimento
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
