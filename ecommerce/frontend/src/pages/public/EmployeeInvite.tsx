import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Eye, EyeOff, Loader2, PartyPopper } from 'lucide-react'
import Logo from '../../components/ui/Logo'
import { ApiError } from '../../lib/apiError'
import { api } from '../../lib/api'
import { useMotoboyAuth } from '../../store/motoboyAuth'
import { useVendedorAuth } from '../../store/vendedorAuth'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

/** Auto-cadastro de motoboy/vendedor via convite (link+código recebido por
 * WhatsApp) -- página pública, o funcionário ainda não tem conta. Isolada
 * de propósito do fluxo de OTP de cliente (nunca reusa aquele mecanismo). */
export default function EmployeeInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const motoboyLogin = useMotoboyAuth((s) => s.login)
  const vendedorLogin = useVendedorAuth((s) => s.login)

  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [role, setRole] = useState<'motoboy' | 'vendedor' | null>(null)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    api.employeeInvite
      .status(token)
      .then((res) => {
        if (res.expired) {
          setStatus('invalid')
          return
        }
        setRole(res.role)
        setStatus('ready')
      })
      .catch(() => setStatus('invalid'))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setError(null)
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.employeeInvite.complete(token, { code, name, phone: digits, password })
      if (res.role === 'motoboy') {
        motoboyLogin(res.token, res.name)
        navigate('/funcionarios/motoboy')
      } else {
        vendedorLogin(res.token, res.name)
        navigate('/funcionarios/vendedor')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível completar o cadastro.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <main className="min-h-screen bg-son-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-son-pink" />
      </main>
    )
  }

  if (status === 'invalid') {
    return (
      <main className="min-h-screen bg-son-black text-white flex items-center justify-center px-5">
        <div className="sunset-login-card w-full max-w-sm rounded-2xl p-8 text-center">
          <Logo size="lg" />
          <p className="text-son-silver-dim text-sm mt-4">
            Esse convite expirou ou já foi usado. Peça pro lojista gerar um novo.
          </p>
        </div>
      </main>
    )
  }

  const papel = role === 'motoboy' ? 'motoboy' : 'vendedor'

  return (
    <main className="min-h-screen bg-son-black text-white flex items-center justify-center px-5">
      <form onSubmit={handleSubmit} className="sunset-login-card w-full max-w-sm rounded-2xl p-8">
        <div className="text-center mb-6">
          <Logo size="lg" />
          <p className="text-son-silver-dim text-sm mt-2 flex items-center justify-center gap-1.5">
            <PartyPopper className="w-4 h-4 text-son-gold" /> Bem-vindo(a)! Complete seu cadastro de {papel}.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Código recebido no WhatsApp</label>
            <input
              className="input-field text-center tracking-widest font-mono text-lg"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Seu nome</label>
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label">Seu WhatsApp</label>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="(83) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              required
            />
          </div>
          <div>
            <label className="label">Crie uma senha</label>
            <div className="relative">
              <input
                className="input-field pr-12"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-son-silver-dim hover:text-white p-1"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Concluir cadastro
          </button>
        </div>
      </form>
    </main>
  )
}
