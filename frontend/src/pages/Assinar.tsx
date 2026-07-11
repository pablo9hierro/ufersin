import { useState } from 'react'
import { Loader2, Rocket } from 'lucide-react'
import { api, ApiError } from '../lib/api'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

// Preço mostrado aqui é só de exibição — o valor real cobrado vem do
// backend (PLANO_VALOR_MENSAL), que é a fonte da verdade de verdade.
const PRECO_EXIBIDO = 'R$ 99/mês'

export default function Assinar() {
  const [lojaNome, setLojaNome] = useState('')
  const [responsavelNome, setResponsavelNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
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

    setLoading(true)
    try {
      const result = await api.criarAssinatura({
        loja_nome: lojaNome.trim(),
        responsavel_nome: responsavelNome.trim(),
        whatsapp: `55${digits}`,
        email: email.trim(),
      })
      window.location.href = result.checkout_url
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível iniciar a assinatura. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black uf-text mb-2">ufersin</h1>
          <p className="text-uf-silver-dim text-sm">Sua loja online completa, pronta em dias — não em meses.</p>
        </div>

        <div className="bg-uf-surface border border-white/5 rounded-2xl p-6 mb-6 text-center">
          <p className="text-xs text-uf-silver-dim mb-1">Assinatura mensal</p>
          <p className="text-3xl font-black uf-text">{PRECO_EXIBIDO}</p>
          <p className="text-xs text-uf-silver-dim mt-1">Hospedagem, catálogo, checkout e acompanhamento de pedido inclusos.</p>
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
            <input
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="voce@exemplo.com"
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Assinar e configurar pagamento
          </button>
          <p className="text-[11px] text-uf-silver-dim text-center">
            Você será redirecionado ao Mercado Pago pra autorizar a cobrança recorrente com segurança.
          </p>
        </form>
      </div>
    </main>
  )
}
