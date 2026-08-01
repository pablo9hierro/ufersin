import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { Loader2, X } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { useCustomerAuth } from '../../store/customerAuth'
import { useCustomer } from '../../store/customer'
import { brandName } from '../../lib/demoMode'
import { useTenantConfig } from '../../hooks/useTenantConfig'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

// Tela cheia de "onboarding" -- header com foto/degradê + wordmark grande
// + frase de efeito (mesma linguagem da referência "Join us and start
// your journey..."), formulário abaixo. Nada a ver com o modal
// centralizado pequeno do Ufersin nativo (uiux2/components/AuthModal.tsx).
export default function AuthModal({
  onClose,
  onSuccess,
  initialMode = 'login',
}: {
  onClose: () => void
  onSuccess: () => void
  initialMode?: 'login' | 'register'
}) {
  const navigate = useNavigate()
  const auth = useCustomerAuth()
  const customerDraft = useCustomer()
  const tenantConfig = useTenantConfig()
  const name = brandName(tenantConfig?.loja_nome)
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [loginWhatsapp, setLoginWhatsapp] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  // Pré-preenchido com o rascunho de checkout (nome/whatsapp/nascimento),
  // se já existir -- poupa redigitar o que já foi escrito lá. E-mail nunca
  // vem de lá (checkout não pede e-mail).
  const [regName, setRegName] = useState(customerDraft.name)
  const [regWhatsapp, setRegWhatsapp] = useState(customerDraft.whatsapp)
  const [regEmail, setRegEmail] = useState('')
  const [regBirthdate, setRegBirthdate] = useState(customerDraft.birthdate)
  const [regPassword, setRegPassword] = useState('')

  const handleLogin = async () => {
    setError(null)
    const digits = loginWhatsapp.replace(/\D/g, '')
    if (digits.length < 10) return setError('Informe um WhatsApp válido.')
    if (!/^\d{4}$/.test(loginPassword)) return setError('A senha tem 4 dígitos.')
    setLoading(true)
    try {
      const result = await authService.customer.login(`55${digits}`, loginPassword)
      auth.login(result.token, result.customer)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    setError(null)
    if (!regName.trim()) return setError('Informe seu nome.')
    const digits = regWhatsapp.replace(/\D/g, '')
    if (digits.length < 10) return setError('Informe um WhatsApp válido.')
    if (!regEmail.trim() || !regEmail.includes('@')) return setError('Informe um e-mail válido.')
    if (!regBirthdate) return setError('Informe sua data de nascimento.')
    if (!/^\d{4}$/.test(regPassword)) return setError('A senha tem 4 dígitos.')
    setLoading(true)
    try {
      const result = await authService.customer.register({ whatsapp: `55${digits}`, password: regPassword, name: regName, email: regEmail, birthdate: regBirthdate })
      auth.login(result.token, result.customer)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar sua conta.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'w-full px-4 py-3 text-sm outline-none rounded-2xl'
  const inputStyle = { background: 'var(--u3-surface)', color: 'var(--u3-white)' }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto u3-page">
      <div className="u3-onboard-photo relative px-6 pt-10 pb-8 text-center">
        <button type="button" onClick={onClose} className="u3-icon-btn absolute top-4 right-4" aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
        <p className="u3-wordmark text-4xl mb-2">{name}</p>
        <p className="u3-dim text-sm max-w-xs mx-auto">Junte-se a nós e comece sua jornada rumo ao hambúrguer perfeito.</p>
      </div>

      <div className="px-6 pb-10 max-w-sm mx-auto -mt-4">
        <div className="flex gap-2 mb-5">
          <button type="button" onClick={() => setMode('login')} className={mode === 'login' ? 'u3-pill-primary flex-1 py-2.5 text-sm' : 'u3-pill-secondary flex-1 py-2.5 text-sm'}>
            Entrar
          </button>
          <button type="button" onClick={() => setMode('register')} className={mode === 'register' ? 'u3-pill-primary flex-1 py-2.5 text-sm' : 'u3-pill-secondary flex-1 py-2.5 text-sm'}>
            Criar conta
          </button>
        </div>

        {mode === 'login' ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold u3-dim">WhatsApp</label>
              <input className={inputClass} style={inputStyle} inputMode="numeric" placeholder="(83) 99999-9999" value={loginWhatsapp} onChange={(e) => setLoginWhatsapp(formatPhone(e.target.value))} />
            </div>
            <div>
              <label className="text-xs font-semibold u3-dim">Senha (4 dígitos)</label>
              <input className={inputClass} style={inputStyle} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/recuperar-senha')
              }}
              className="text-xs u3-dim"
            >
              Esqueci minha senha
            </button>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="button" onClick={handleLogin} disabled={loading} className="u3-pill-primary w-full py-3 flex items-center justify-center gap-2 mt-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Entrar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold u3-dim">Nome</label>
              <input className={inputClass} style={inputStyle} value={regName} onChange={(e) => setRegName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u3-dim">WhatsApp</label>
              <input className={inputClass} style={inputStyle} inputMode="numeric" placeholder="(83) 99999-9999" value={regWhatsapp} onChange={(e) => setRegWhatsapp(formatPhone(e.target.value))} />
            </div>
            <div>
              <label className="text-xs font-semibold u3-dim">E-mail</label>
              <input className={inputClass} style={inputStyle} type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u3-dim">Data de nascimento</label>
              <input className={inputClass} style={inputStyle} type="date" value={regBirthdate} onChange={(e) => setRegBirthdate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u3-dim">Senha (4 dígitos)</label>
              <input className={inputClass} style={inputStyle} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={regPassword} onChange={(e) => setRegPassword(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="button" onClick={handleRegister} disabled={loading} className="u3-pill-primary w-full py-3 flex items-center justify-center gap-2 mt-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Criar conta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
