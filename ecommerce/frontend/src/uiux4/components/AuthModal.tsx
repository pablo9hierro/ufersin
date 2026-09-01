import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { useCustomer } from '../../store/customer'
import { useCustomerAuth, isCustomerSessionFresh } from '../../store/customerAuth'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

// Login único (cadastro e login viram o mesmo formulário): nome + whatsapp +
// código enviado por WhatsApp. Sessão verificada há menos de 1h pula direto
// (isCustomerSessionFresh).
export default function AuthModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
  /** @deprecated login único não distingue mais login/cadastro. */
  initialMode?: 'login' | 'register'
}) {
  const auth = useCustomerAuth()
  const draft = useCustomer()
  const [step, setStep] = useState<'form' | 'code'>('form')
  const [name, setName] = useState(draft.name || '')
  const [whatsapp, setWhatsapp] = useState(draft.whatsapp || '')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isCustomerSessionFresh()) {
    onSuccess()
    return null
  }

  const digits = whatsapp.replace(/\D/g, '')
  const inputClass = 'u4-input w-full px-3.5 py-2.5 text-sm outline-none'

  const requestCode = async () => {
    setError(null)
    if (!name.trim()) return setError('Informe seu nome.')
    if (digits.length < 10) return setError('Informe um WhatsApp válido.')
    setLoading(true)
    try {
      await authService.customer.requestLoginCode(`55${digits}`, name.trim())
      setStep('code')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o código.')
    } finally {
      setLoading(false)
    }
  }

  const confirmCode = async () => {
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError('Informe o código de 6 dígitos.')
    setLoading(true)
    try {
      const result = await authService.customer.verifyLoginCode(`55${digits}`, code)
      auth.login(result.token, result.customer)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Código inválido.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="u4-panel w-full max-w-sm p-6 my-8 relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-4 right-4 u4-dim" aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
        <p className="font-black text-lg mb-5">{step === 'form' ? 'Entrar' : 'Digite o código'}</p>

        {step === 'form' ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold u4-dim">Nome</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u4-dim">WhatsApp</label>
              <input className={inputClass} inputMode="numeric" autoComplete="off" placeholder="(83) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(formatPhone(e.target.value))} />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="button" onClick={requestCode} disabled={loading} className="u4-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Receber código no WhatsApp
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs u4-dim text-center">Mandamos um código de 6 dígitos pro WhatsApp {whatsapp}. Vale por 10 minutos.</p>
            <div>
              <label className="text-xs font-semibold u4-dim">Código</label>
              <input
                className={`${inputClass} text-center tracking-[0.4em] text-lg`}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="button" onClick={confirmCode} disabled={loading} className="u4-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar e entrar
            </button>
            <button type="button" onClick={() => setStep('form')} className="text-xs u4-dim w-full text-center">
              Errei o WhatsApp, voltar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
