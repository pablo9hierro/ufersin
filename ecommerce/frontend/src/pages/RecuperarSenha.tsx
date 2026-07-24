import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import SiteHeader from '../components/layout/SiteHeader'
import PageTransition from '../components/layout/PageTransition'
import Logo from '../components/ui/Logo'
import { api, ApiError } from '../lib/api'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

type Step = 'whatsapp' | 'code' | 'password' | 'done'

// Mesmo visual do CustomerAuthModal (glass + input-field + btn-primary),
// só que em página própria (não modal) — 3 passos: whatsapp -> código de
// 3 dígitos recebido por WhatsApp -> nova senha de 4 dígitos.
export default function RecuperarSenha() {
  const navigate = useNavigate()
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
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    setLoading(true)
    try {
      await api.customerAuth.requestPasswordReset(fullWhatsapp)
      setStep('code')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o código agora. Tente novamente em instantes.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    setError(null)
    if (!/^\d{3}$/.test(code)) {
      setError('O código tem 3 dígitos.')
      return
    }
    setLoading(true)
    try {
      await api.customerAuth.verifyResetCode(fullWhatsapp, code)
      setStep('password')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Código inválido ou expirado.')
    } finally {
      setLoading(false)
    }
  }

  const resetPassword = async () => {
    setError(null)
    if (!/^\d{4}$/.test(password)) {
      setError('A senha tem 4 dígitos.')
      return
    }
    if (password !== passwordConfirm) {
      setError('As senhas não são iguais.')
      return
    }
    setLoading(true)
    try {
      await api.customerAuth.resetPassword(fullWhatsapp, code, password)
      setStep('done')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível redefinir sua senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen text-white">
      <SiteHeader showCart={false} />
      <PageTransition className="max-w-sm mx-auto px-5 sm:px-10 pt-10 pb-20">
        {/* Mesmo cartão do login do admin/cliente (Uiverse.io by KhelVers). */}
        <div className="sunset-login-card rounded-2xl p-8">
          <div className="text-center mb-6">
            <Logo size="md" />
            <p className="text-son-silver-dim text-sm mt-2 flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Recuperar senha
            </p>
          </div>
          {step === 'whatsapp' && (
            <div className="space-y-3">
              <p className="text-sm text-son-silver-dim">Informe o WhatsApp da sua conta — vamos mandar um código de 3 dígitos por lá.</p>
              <div>
                <label className="label">WhatsApp</label>
                <input
                  className="input-field"
                  inputMode="numeric"
                  placeholder="(83) 99999-9999"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
                />
              </div>
              {error && <p className="error-msg">{error}</p>}
              <button type="button" onClick={sendCode} disabled={loading} className="btn-primary w-full mt-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Enviar código
              </button>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-3">
              <p className="text-sm text-son-silver-dim">Digite o código de 3 dígitos que chegou no seu WhatsApp. Vale por 10 minutos.</p>
              <div>
                <label className="label">Código</label>
                <input
                  className="input-field text-center text-2xl tracking-[0.5em]"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </div>
              {error && <p className="error-msg">{error}</p>}
              <button type="button" onClick={verifyCode} disabled={loading} className="btn-primary w-full mt-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Confirmar código
              </button>
              <button type="button" onClick={sendCode} disabled={loading} className="text-xs text-son-silver-dim hover:text-white block mx-auto">
                Reenviar código
              </button>
            </div>
          )}

          {step === 'password' && (
            <div className="space-y-3">
              <p className="text-sm text-son-silver-dim">Escolha sua nova senha de 4 dígitos.</p>
              <div>
                <label className="label">Nova senha (4 dígitos)</label>
                <input
                  className="input-field"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>
              <div>
                <label className="label">Confirmar senha</label>
                <input
                  className="input-field"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>
              {error && <p className="error-msg">{error}</p>}
              <button type="button" onClick={resetPassword} disabled={loading} className="btn-primary w-full mt-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Redefinir senha
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-son-silver">Senha redefinida! Já pode entrar com a nova senha.</p>
              <button type="button" onClick={() => navigate('/')} className="btn-primary w-full">
                Voltar ao início
              </button>
            </div>
          )}
        </div>
      </PageTransition>
    </main>
  )
}
