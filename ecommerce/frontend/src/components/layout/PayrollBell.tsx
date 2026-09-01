import { useEffect, useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'
import { adminService } from '../../services/adminService'
import { payrollService } from '../../services/payrollService'
import type { PayrollAlert, PayrollPayment } from '../../types'

const POLL_MS = 60_000

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

/** Sino de notificação de pagamento fixo (motoboy/vendedor) — "admin" mostra
 * quem está a até 2 dias do vencimento e deixa registrar o pagamento;
 * "staff" mostra os pagamentos que o admin já reportou, só com botão de
 * confirmar (nunca recusar). */
export default function PayrollBell({ mode }: { mode: 'admin' | 'staff' }) {
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<PayrollAlert[]>([])
  const [pending, setPending] = useState<PayrollPayment[]>([])
  const [reporting, setReporting] = useState<PayrollAlert | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cartao' | 'dinheiro'>('pix')
  const [confirming, setConfirming] = useState<PayrollPayment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    if (mode === 'admin') {
      adminService.payroll.alerts().then(setAlerts).catch(() => {})
    } else {
      payrollService.myPending().then(setPending).catch(() => {})
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const count = mode === 'admin' ? alerts.length : pending.length

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
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto glass rounded-2xl p-3 z-50 border border-white/10">
            <p className="text-xs font-semibold text-son-silver-dim uppercase tracking-wide px-1 mb-2">
              {mode === 'admin' ? 'Pagamentos de funcionário' : 'Meus pagamentos'}
            </p>
            {mode === 'admin' &&
              (alerts.length === 0 ? (
                <p className="text-xs text-son-silver-dim px-1 py-4 text-center">Nada pendente.</p>
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
                    className="w-full text-left px-2 py-2 rounded-xl hover:bg-white/5 disabled:opacity-60 disabled:hover:bg-transparent"
                  >
                    <p className="text-sm text-white font-medium">
                      {a.name} <span className="text-son-silver-dim text-xs">({a.employee_role})</span>
                    </p>
                    <p className="text-xs text-son-gold">{currency(a.amount)}</p>
                    <p className="text-xs text-son-silver-dim">
                      {a.payment_id ? 'Aguardando confirmação do funcionário' : 'Faltam ≤2 dias para o pagamento — clique pra informar que pagou'}
                    </p>
                  </button>
                ))
              ))}
            {mode === 'staff' &&
              (pending.length === 0 ? (
                <p className="text-xs text-son-silver-dim px-1 py-4 text-center">Nada pendente.</p>
              ) : (
                pending.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setConfirming(p)
                      setOpen(false)
                    }}
                    className="w-full text-left px-2 py-2 rounded-xl hover:bg-white/5"
                  >
                    <p className="text-sm text-white font-medium">{currency(p.amount)}</p>
                    <p className="text-xs text-son-silver-dim">
                      Loja informou pagamento via {p.payment_method} — clique pra confirmar recebimento
                    </p>
                  </button>
                ))
              ))}
          </div>
        </>
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
