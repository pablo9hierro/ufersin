import { useState } from 'react'
import { useNavigate } from '../../lib/tenantRouter'
import { Loader2, X } from 'lucide-react'
import { ApiError } from '../../lib/apiError'
import { authService } from '../../services/authService'
import { useCustomer } from '../../store/customer'
import { useCustomerAuth } from '../../store/customerAuth'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

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
  // "Criar conta" já nasce preenchido com nome/whatsapp/nascimento do
  // rascunho de checkout (store/customer.ts) -- poupa redigitar o que já
  // foi escrito lá; e-mail nunca vem de lá (checkout não pede e-mail).
  const draft = useCustomer()
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [loginWhatsapp, setLoginWhatsapp] = useState(draft.whatsapp || '')
  const [loginPassword, setLoginPassword] = useState('')
  const [regName, setRegName] = useState(draft.name || '')
  const [regWhatsapp, setRegWhatsapp] = useState(draft.whatsapp || '')
  const [regEmail, setRegEmail] = useState('')
  const [regBirthdate, setRegBirthdate] = useState(draft.birthdate || '')
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

  const inputClass = 'u4-input w-full px-3.5 py-2.5 text-sm outline-none'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="u4-panel w-full max-w-sm p-6 my-8 relative" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-4 right-4 u4-dim" aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
        <p className="font-black text-lg mb-5">{mode === 'login' ? 'Entrar' : 'Criar conta'}</p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          <button type="button" onClick={() => setMode('login')} className={mode === 'login' ? 'u4-btn-primary py-2 text-sm' : 'u4-btn-secondary py-2 text-sm'}>
            Entrar
          </button>
          <button type="button" onClick={() => setMode('register')} className={mode === 'register' ? 'u4-btn-primary py-2 text-sm' : 'u4-btn-secondary py-2 text-sm'}>
            Criar conta
          </button>
        </div>

        {mode === 'login' ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold u4-dim">WhatsApp</label>
              <input className={inputClass} inputMode="numeric" placeholder="(83) 99999-9999" value={loginWhatsapp} onChange={(e) => setLoginWhatsapp(formatPhone(e.target.value))} />
            </div>
            <div>
              <label className="text-xs font-semibold u4-dim">Senha (4 dígitos)</label>
              <input className={inputClass} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/recuperar-senha')
              }}
              className="text-xs u4-dim"
            >
              Esqueci minha senha
            </button>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="button" onClick={handleLogin} disabled={loading} className="u4-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Entrar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold u4-dim">Nome</label>
              <input className={inputClass} value={regName} onChange={(e) => setRegName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u4-dim">WhatsApp</label>
              <input className={inputClass} inputMode="numeric" placeholder="(83) 99999-9999" value={regWhatsapp} onChange={(e) => setRegWhatsapp(formatPhone(e.target.value))} />
            </div>
            <div>
              <label className="text-xs font-semibold u4-dim">E-mail</label>
              <input className={inputClass} type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u4-dim">Data de nascimento</label>
              <input className={inputClass} type="date" value={regBirthdate} onChange={(e) => setRegBirthdate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold u4-dim">Senha (4 dígitos)</label>
              <input className={inputClass} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={regPassword} onChange={(e) => setRegPassword(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="button" onClick={handleRegister} disabled={loading} className="u4-btn-primary w-full py-2.5 flex items-center justify-center gap-2 mt-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Criar conta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
