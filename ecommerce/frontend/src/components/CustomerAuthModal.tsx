import { useState } from 'react'
import { Loader2, Lock, X } from 'lucide-react'
import Logo from './ui/Logo'
import { ApiError } from '../lib/apiError'
import { authService } from '../services/authService'
import { useCustomerAuth, isCustomerSessionFresh } from '../store/customerAuth'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

// Login único (cadastro e login viram o mesmo formulário): nome + whatsapp +
// código enviado por WhatsApp. Sem senha, sem e-mail, sem cadastro separado
// — se a sessão já foi verificada há menos de 1h (isCustomerSessionFresh),
// nem chega a abrir: quem chamou já está autenticado.
export default function CustomerAuthModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
  /** @deprecated Login único não distingue mais login/cadastro — mantido só
   * pra não quebrar chamadas antigas que ainda passam essa prop. */
  initialMode?: 'login' | 'register'
}) {
  const auth = useCustomerAuth()
  const [step, setStep] = useState<'form' | 'code'>('form')
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isCustomerSessionFresh()) {
    onSuccess()
    return null
  }

  const digits = whatsapp.replace(/\D/g, '')

  const requestCode = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Informe seu nome.')
      return
    }
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
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
    if (!/^\d{6}$/.test(code)) {
      setError('Informe o código de 6 dígitos.')
      return
    }
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
    // items-start + overflow-y-auto (não items-center) — o cartão fica mais
    // alto que a viewport em celular; centralizado sem scroll cortava topo
    // E rodapé pra fora da tela, sem como interagir (reportado). my-8 no
    // cartão dá respiro em vez de colar nas bordas.
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="sunset-login-card w-full max-w-sm rounded-2xl p-8 my-8" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-son-silver-dim hover:text-white" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
        <div className="text-center mb-6">
          <Logo size="md" />
          <p className="text-son-silver-dim text-sm mt-2 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> {step === 'form' ? 'Entre pra continuar' : 'Digite o código'}
          </p>
        </div>

        {step === 'form' ? (
          <div className="space-y-3">
            <div>
              <label className="label">Nome</label>
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input
                className="input-field"
                inputMode="numeric"
                autoComplete="off"
                placeholder="(83) 99999-9999"
                value={whatsapp}
                onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="button" onClick={requestCode} disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Receber código no WhatsApp
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-son-silver-dim text-center">
              Mandamos um código de 6 dígitos pro WhatsApp {whatsapp}. Vale por 10 minutos.
            </p>
            <div>
              <label className="label">Código</label>
              <input
                className="input-field text-center tracking-[0.4em] text-lg"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="button" onClick={confirmCode} disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Confirmar e entrar
            </button>
            <button type="button" onClick={() => setStep('form')} className="text-xs text-son-silver-dim hover:text-white w-full text-center">
              Errei o WhatsApp, voltar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
