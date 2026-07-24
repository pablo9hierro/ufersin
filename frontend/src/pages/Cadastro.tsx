import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CreditCard, Loader2, QrCode, Rocket } from 'lucide-react'
import { api, ApiError, type MetodoPagamento, type PlanoCode } from '../lib/api'
import { authStore } from '../lib/authStore'

const PLAN_LABEL: Record<PlanoCode, { name: string; price: number }> = {
  essential: { name: 'Essential', price: 60 },
  management: { name: 'Management', price: 250 },
  premium: { name: 'Premium', price: 350 },
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

export default function Cadastro() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const planoParam = (searchParams.get('plano') as PlanoCode) || 'essential'
  const plano: PlanoCode = planoParam in PLAN_LABEL ? planoParam : 'essential'
  const planInfo = PLAN_LABEL[plano]

  const [lojaNome, setLojaNome] = useState('')
  const [responsavelNome, setResponsavelNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [metodo, setMetodo] = useState<MetodoPagamento>('cartao')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!lojaNome.trim() || !responsavelNome.trim()) {
      setError('Informe o nome da loja e do responsável.')
      return
    }
    const digits = whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido.')
      return
    }
    if (!email.includes('@')) {
      setError('Informe um e-mail válido.')
      return
    }
    if (senha.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    setLoading(true)
    try {
      const result = await api.criarAssinatura({
        loja_nome: lojaNome.trim(),
        responsavel_nome: responsavelNome.trim(),
        whatsapp: `55${digits}`,
        email: email.trim(),
        senha,
        plano,
        metodo,
      })
      authStore.setToken(result.token)
      if (result.checkout_url) {
        window.location.href = result.checkout_url
      } else {
        navigate(`/obrigado?id=${result.id}`)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível iniciar a assinatura. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Rodoletas
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">Sua loja online completa, pronta em dias — não em meses.</p>
        </div>

        <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
          <p className="text-xs text-uf-silver-dim mb-1">Plano {planInfo.name}</p>
          <p className="text-3xl font-black uf-text">R$ {planInfo.price}/mês</p>
          <Link to="/#planos" className="text-[11px] text-uf-silver-dim hover:text-uf-silver underline mt-1 inline-block">
            trocar plano
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome da loja *</label>
            <input className="input-field" value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} placeholder="Ex: Sunset Tabas" />
          </div>
          <div>
            <label className="label">Seu nome *</label>
            <input
              className="input-field"
              value={responsavelNome}
              onChange={(e) => setResponsavelNome(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className="label">WhatsApp *</label>
            <input
              className="input-field"
              value={whatsapp}
              onChange={(e) => setWhatsapp(formatPhone(e.target.value))}
              type="tel"
              inputMode="numeric"
              placeholder="(83) 99999-9999"
              maxLength={15}
            />
          </div>
          <div>
            <label className="label">E-mail *</label>
            <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" />
          </div>
          <div>
            <label className="label">Senha *</label>
            <input
              className="input-field"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              type="password"
              placeholder="Pelo menos 8 caracteres"
            />
            <p className="text-[11px] text-uf-silver-dim mt-1">É com ela que você entra no seu painel e na sua loja.</p>
          </div>

          <div>
            <label className="label">Forma de pagamento</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMetodo('cartao')}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm border transition-colors ${
                  metodo === 'cartao' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                Cartão
              </button>
              <button
                type="button"
                onClick={() => setMetodo('pix')}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm border transition-colors ${
                  metodo === 'pix' ? 'border-uf-blue bg-white/5' : 'border-white/10 text-uf-silver-dim'
                }`}
              >
                <QrCode className="w-4 h-4" />
                Pix
              </button>
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Assinar e configurar pagamento
          </button>
          <p className="text-[11px] text-uf-silver-dim text-center">
            {metodo === 'cartao'
              ? 'Você será redirecionado ao checkout seguro pra autorizar a cobrança recorrente.'
              : 'Você vai receber um QR Code Pix na próxima tela.'}
          </p>
          <p className="text-xs text-center text-uf-silver-dim">
            Já tem conta?{' '}
            <Link to="/login" className="text-uf-silver font-semibold hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </motion.div>
    </main>
  )
}
