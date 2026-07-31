import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, Rocket } from 'lucide-react'
import { api, ApiError, type PlanoCode } from '../lib/api'
import { useAuthReady, useIsAuthenticated, useSession } from '../lib/authStore'
import { PLAN_MAP } from '../lib/plans'

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

/** Só existe pra quem entrou pela primeira vez via Google OAuth e ainda
 * não tem linha em `subscribers` -- não coletamos senha aqui (não existe
 * senha nenhuma nesse fluxo, ver ARQUITETURA.md §6 "Limitação conhecida e
 * aceita"), só o que falta pra criar a conta. */
export default function CompletarCadastro() {
  const ready = useAuthReady()
  const isAuthenticated = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const planoParam = searchParams.get('plano') as PlanoCode | null
  const plano: PlanoCode | null = planoParam && planoParam in PLAN_MAP ? planoParam : null

  const [lojaNome, setLojaNome] = useState('')
  const [responsavelNome, setResponsavelNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!ready) {
    return (
      <main className="min-h-screen bg-uf-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-uf-silver-dim" />
      </main>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

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

    setLoading(true)
    try {
      await api.bootstrap({ loja_nome: lojaNome.trim(), responsavel_nome: responsavelNome.trim(), whatsapp: `55${digits}` })
      navigate(plano ? `/assinar?plano=${plano}` : '/planos')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível concluir seu cadastro.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-black uf-text">
            Rodoletas
          </Link>
          <p className="text-uf-silver-dim text-sm mt-2">Só mais um passo pra concluir sua conta, {session?.user.email}.</p>
        </div>

        {plano && (
          <div className="uf-glass rounded-2xl p-6 mb-6 text-center">
            <p className="text-xs text-uf-silver-dim mb-1">Plano {PLAN_MAP[plano].name}</p>
            <p className="text-3xl font-black uf-text">R$ {PLAN_MAP[plano].price}/mês</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">Nome da loja *</label>
            <input className="input-field" value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} placeholder="Ex: Sunset Tabas" />
          </div>
          <div>
            <label className="label">Seu nome *</label>
            <input className="input-field" value={responsavelNome} onChange={(e) => setResponsavelNome(e.target.value)} placeholder="Nome completo" />
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

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Concluir cadastro
          </button>
        </form>
      </motion.div>
    </main>
  )
}
