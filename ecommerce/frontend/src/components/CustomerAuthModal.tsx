import { useState } from 'react'
import { useNavigate } from '../lib/tenantRouter'
import { Eye, EyeOff, Loader2, Lock, X } from 'lucide-react'
import BirthdateInput from './checkout/BirthdateInput'
import Logo from './ui/Logo'
import { ApiError } from '../lib/apiError'
import { authService } from '../services/authService'
import { useCustomerAuth } from '../store/customerAuth'
import { useTenantConfig } from '../hooks/useTenantConfig'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

// Toggle login/criar conta, aberto sempre que uma ação exige cliente
// logado (finalizar checkout, "Acompanhar meu pedido"). Todos os campos
// nascem vazios (só placeholder) — nada vem pré-preenchido do rascunho de
// checkout, pra evitar erro de digitação passar despercebido e pra não
// vazar rascunho de outra sessão no mesmo aparelho.
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
  const auth = useCustomerAuth()
  const tenantConfig = useTenantConfig()
  const requiresBirthdate = !!tenantConfig?.vende_mais_18
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // WhatsApp já cadastrado detectado no "Criar conta" — mostra CTA de
  // recuperar senha em vez de só um erro genérico (a pessoa provavelmente
  // já tem conta e esqueceu, tentar cadastrar de novo não ajuda ela).
  const [duplicateWhatsapp, setDuplicateWhatsapp] = useState(false)

  // Nome/whatsapp/nascimento NÃO vêm pré-preenchidos do rascunho de checkout
  // — só placeholder. Preencher automaticamente escondia erros de digitação
  // (a pessoa nem olhava o campo) e um rascunho de outra sessão/pessoa no
  // mesmo aparelho vazava pro cadastro.
  const [loginWhatsapp, setLoginWhatsapp] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)

  const [regName, setRegName] = useState('')
  const [regWhatsapp, setRegWhatsapp] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regBirthdate, setRegBirthdate] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [showRegPassword, setShowRegPassword] = useState(false)

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError(null)
    setDuplicateWhatsapp(false)
  }

  const handleLogin = async () => {
    setError(null)
    const digits = loginWhatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (!/^\d{6}$/.test(loginPassword)) {
      setError('A senha tem 6 dígitos.')
      return
    }
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
    setDuplicateWhatsapp(false)
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
    if (requiresBirthdate && !regBirthdate) {
      setError('Informe sua data de nascimento.')
      return
    }
    if (!/^\d{6}$/.test(regPassword)) {
      setError('A senha tem 6 dígitos.')
      return
    }
    setLoading(true)
    try {
      const result = await authService.customer.register({
        whatsapp: `55${digits}`,
        password: regPassword,
        name: regName,
        email: regEmail,
        birthdate: requiresBirthdate ? regBirthdate : regBirthdate || '',
      })
      auth.login(result.token, result.customer)
      onSuccess()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Não foi possível criar sua conta.'
      if (message.toLowerCase().includes('already registered')) {
        setDuplicateWhatsapp(true)
        setError('Esse WhatsApp já tem uma conta. Faça login ou recupere sua senha.')
      } else {
        setError(message)
      }
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
                autoComplete="off"
                placeholder="(83) 99999-9999"
                value={loginWhatsapp}
                onChange={(e) => setLoginWhatsapp(formatPhone(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Senha (6 dígitos)</label>
              <div className="relative">
                <input
                  className="input-field pr-10"
                  type={showLoginPassword ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-son-silver-dim hover:text-white"
                  aria-label={showLoginPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
                autoComplete="off"
                placeholder="(83) 99999-9999"
                value={regWhatsapp}
                onChange={(e) => setRegWhatsapp(formatPhone(e.target.value))}
              />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input className="input-field" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
            </div>
            {requiresBirthdate && (
              <div>
                <label className="label">Data de nascimento *</label>
                <BirthdateInput value={regBirthdate} onChange={setRegBirthdate} />
                <p className="text-xs text-son-silver-dim mt-1">
                  Obrigatório — esta loja vende produtos para maiores de 18 anos.
                </p>
              </div>
            )}
            <div>
              <label className="label">Senha (6 dígitos)</label>
              <div className="relative">
                <input
                  className="input-field pr-10"
                  type={showRegPassword ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <button
                  type="button"
                  onClick={() => setShowRegPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-son-silver-dim hover:text-white"
                  aria-label={showRegPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            {duplicateWhatsapp && (
              <div className="flex gap-3 justify-center text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setLoginWhatsapp(regWhatsapp)
                    switchMode('login')
                  }}
                  className="text-son-silver-dim hover:text-white underline"
                >
                  Fazer login
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/recuperar-senha')}
                  className="text-son-silver-dim hover:text-white underline"
                >
                  Recuperar senha
                </button>
              </div>
            )}
            <button type="button" onClick={handleRegister} disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Criar conta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
