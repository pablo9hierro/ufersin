import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { Loader2, Lock } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import Shell from '../components/Shell'
import { brandName } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

type Step = 'whatsapp' | 'code' | 'password' | 'done'
const inputClass = 'u2-surface w-full px-3.5 py-2.5 text-sm outline-none'

export default function Uiux2RecuperarSenha() {
  const navigate = useNavigate()
  const tenantConfig = useTenantConfig()
  const name = brandName(tenantConfig?.loja_nome)
  const [step, setStep] = useState<Step>('whatsapp')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [whatsapp, setWhatsapp] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const digits = whatsapp.replace(/\D/g, '')
  const fullWhatsapp = `55${digits}`

  const sendCode = async () => {
    setError(null)
    if (digits.length < 10) return setError('Informe um WhatsApp válido.')
    setLoading(true)
    try {
      await authService.customer.requestPasswordReset(fullWhatsapp)
      setStep('code')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o código agora.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    setError(null)
    if (!/^\d{3}$/.test(code)) return setError('O código tem 3 dígitos.')
    setLoading(true)
    try {
      await authService.customer.verifyResetCode(fullWhatsapp, code)
      setStep('password')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Código inválido ou expirado.')
    } finally {
      setLoading(false)
    }
  }

  const resetPassword = async () => {
    setError(null)
    if (!/^\d{4}$/.test(password)) return setError('A senha tem 4 dígitos.')
    if (password !== passwordConfirm) return setError('As senhas não são iguais.')
    setLoading(true)
    try {
      await authService.customer.resetPassword(fullWhatsapp, code, password)
      setStep('done')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível redefinir sua senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell>
      <div className="px-4 sm:px-8 pt-8 pb-16 max-w-sm mx-auto">
        <div className="u2-card p-7">
          <div className="text-center mb-6">
            <p className="font-black text-lg">{name}</p>
            <p className="text-sm u2-dim mt-1.5 flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Recuperar senha
            </p>
          </div>

          {step === 'whatsapp' && (
            <div className="space-y-3">
              <p className="text-sm u2-dim">Informe o WhatsApp da sua conta — vamos mandar um código de 3 dígitos por lá.</p>
              <div>
                <label className="text-xs font-semibold u2-dim">WhatsApp</label>
                <input className={inputClass} inputMode="numeric" placeholder="(83) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(formatPhone(e.target.value))} />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button onClick={sendCode} disabled={loading} className="u2-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} Enviar código
              </button>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-3">
              <p className="text-sm u2-dim">Digite o código de 3 dígitos que chegou no seu WhatsApp. Vale por 10 minutos.</p>
              <div>
                <label className="text-xs font-semibold u2-dim">Código</label>
                <input className={inputClass + ' text-center text-2xl tracking-[0.5em]'} inputMode="numeric" maxLength={3} placeholder="000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 3))} />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button onClick={verifyCode} disabled={loading} className="u2-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} Confirmar código
              </button>
              <button onClick={sendCode} disabled={loading} className="text-xs u2-dim block mx-auto">
                Reenviar código
              </button>
            </div>
          )}

          {step === 'password' && (
            <div className="space-y-3">
              <p className="text-sm u2-dim">Escolha sua nova senha de 4 dígitos.</p>
              <div>
                <label className="text-xs font-semibold u2-dim">Nova senha (4 dígitos)</label>
                <input className={inputClass} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={password} onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
              <div>
                <label className="text-xs font-semibold u2-dim">Confirmar senha</label>
                <input className={inputClass} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button onClick={resetPassword} disabled={loading} className="u2-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />} Redefinir senha
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <p className="text-sm">Senha redefinida! Já pode entrar com a nova senha.</p>
              <button onClick={() => navigate('/')} className="u2-btn-primary w-full py-2.5">
                Voltar ao início
              </button>
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
