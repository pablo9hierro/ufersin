import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Lock, X } from 'lucide-react'
import BirthdateInput from './checkout/BirthdateInput'
import Logo from './ui/Logo'
import { api, ApiError } from '../lib/api'
import { useCustomer } from '../store/customer'
import { useCustomerAuth } from '../store/customerAuth'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

// Toggle login/criar conta, aberto sempre que uma ação exige cliente
// logado (finalizar checkout, "Acompanhar meu pedido"). "Criar conta" já
// nasce preenchido com nome/whatsapp/nascimento do rascunho de checkout
// (store/customer.ts) — editável, só poupa redigitar o que já foi
// escrito ali; e-mail não vem de lá (checkout não pede) e é digitado do zero.
export default function CustomerAuthModal({
  onClose,
  onSuccess,
  initialMode = 'login',
}: {
  onClose: () => void
  onSuccess: () => void
  initialMode?: 'login' | 'register'
}) {
  const navigate = useNavigate()
  const draft = useCustomer()
  const auth = useCustomerAuth()
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

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError(null)
  }

  const handleLogin = async () => {
    setError(null)
    const digits = loginWhatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (!/^\d{4}$/.test(loginPassword)) {
      setError('A senha tem 4 dígitos.')
      return
    }
    setLoading(true)
    try {
      const result = await api.customerAuth.login(`55${digits}`, loginPassword)
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
    if (!regName.trim()) {
      setError('Informe seu nome.')
      return
    }
    const digits = regWhatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (!regEmail.trim() || !regEmail.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!regBirthdate) {
      setError('Informe sua data de nascimento.')
      return
    }
    if (!/^\d{4}$/.test(regPassword)) {
      setError('A senha tem 4 dígitos.')
      return
    }
    setLoading(true)
    try {
      const result = await api.customerAuth.register({
        whatsapp: `55${digits}`,
        password: regPassword,
        name: regName,
        email: regEmail,
        birthdate: regBirthdate,
      })
      auth.login(result.token, result.customer)
      onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar sua conta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    // items-start + overflow-y-auto (não items-center) — o cartão de
    // cadastro é mais alto que a viewport em celular; centralizado sem
    // scroll cortava topo E rodapé pra fora da tela, sem como interagir
    // (reportado). my-8 no cartão dá respiro em vez de colar nas bordas.
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      {/* Mesmo cartão do login do admin (Uiverse.io by KhelVers — flutua,
          borda dourada, glow quente por dentro/fora) — só o formulário
          muda, o "estojo" é o mesmo em toda tela de login do site. */}
      <div className="sunset-login-card w-full max-w-sm rounded-2xl p-8 my-8" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-son-silver-dim hover:text-white" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
        <div className="text-center mb-6">
          <Logo size="md" />
          <p className="text-son-silver-dim text-sm mt-2 flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> {mode === 'login' ? 'Entre pra continuar' : 'Crie sua conta'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
              mode === 'login' ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
              mode === 'register' ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver'
            }`}
          >
            Criar conta
          </button>
        </div>

        {mode === 'login' ? (
          <div className="space-y-3">
            <div>
              <label className="label">WhatsApp</label>
              <input
                className="input-field"
                inputMode="numeric"
                placeholder="(83) 99999-9999"
                value={loginWhatsapp}
                onChange={(e) => setLoginWhatsapp(formatPhone(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Senha (4 dígitos)</label>
              <input
                className="input-field"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
            <button type="button" onClick={() => navigate('/recuperar-senha')} className="text-xs text-son-silver-dim hover:text-white">
              Esqueci minha senha
            </button>
            {error && <p className="error-msg">{error}</p>}
            <button type="button" onClick={handleLogin} disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Entrar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">Nome</label>
              <input className="input-field" value={regName} onChange={(e) => setRegName(e.target.value)} />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input
                className="input-field"
                inputMode="numeric"
                placeholder="(83) 99999-9999"
                value={regWhatsapp}
                onChange={(e) => setRegWhatsapp(formatPhone(e.target.value))}
              />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input className="input-field" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
            </div>
            <div>
              <label className="label">Data de nascimento</label>
              <BirthdateInput value={regBirthdate} onChange={setRegBirthdate} />
            </div>
            <div>
              <label className="label">Senha (4 dígitos)</label>
              <input
                className="input-field"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="button" onClick={handleRegister} disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Criar conta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
