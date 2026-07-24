import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, ImagePlus, Loader2, Palette, Rocket } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useIsAuthenticated } from '../lib/authStore'

const CATEGORIAS = ['Alimentação', 'Moda', 'Beleza', 'Casa & decoração', 'Eletrônicos', 'Pet shop', 'Outro']
const CORES = ['#0f5132', '#4d7cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics left over after NFD decomposition
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export default function Onboarding() {
  const isAuthenticated = useIsAuthenticated()
  const navigate = useNavigate()

  const [nomeLoja, setNomeLoja] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [whatsapp, setWhatsapp] = useState('')
  const [endereco, setEndereco] = useState('')
  const [corPrincipal, setCorPrincipal] = useState(CORES[0])
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!isAuthenticated) return <Navigate to="/login" replace />

  const handleNomeChange = (v: string) => {
    setNomeLoja(v)
    if (!slugTocado) setSlug(slugify(v))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!nomeLoja.trim() || !endereco.trim() || !slug.trim()) {
      setError('Preencha nome da loja, endereço e slug.')
      return
    }
    const digits = whatsapp.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Informe um WhatsApp válido pra loja.')
      return
    }

    setLoading(true)
    try {
      await api.onboarding({
        nome_loja: nomeLoja.trim(),
        categoria,
        whatsapp: `55${digits}`,
        endereco: endereco.trim(),
        cor_principal: corPrincipal,
        slug: slugify(slug),
      })
      setDone(true)
      setTimeout(() => navigate('/dashboard'), 2200)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível finalizar o onboarding.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-uf-black text-uf-silver flex items-center justify-center px-5 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-black mb-2">Sua loja está pronta! 🎉</h1>
          <p className="text-sm text-uf-silver-dim">Te levando pro seu painel...</p>
        </motion.div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-uf-black text-uf-silver px-5 py-16 relative">
      <div className="uf-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-lg mx-auto relative z-10"
      >
        <div className="text-center mb-8">
          <span className="uf-eyebrow mb-4">Onboarding</span>
          <h1 className="text-2xl sm:text-3xl font-black mt-4">Configure sua loja</h1>
          <p className="text-sm text-uf-silver-dim mt-2">Isso leva menos de 2 minutos — dá pra editar tudo depois.</p>
        </div>

        <form onSubmit={handleSubmit} className="uf-glass rounded-2xl p-6 space-y-4">
          <div>
            <label className="label">Nome da loja *</label>
            <input className="input-field" value={nomeLoja} onChange={(e) => handleNomeChange(e.target.value)} placeholder="Ex: Sunset Tabas" />
          </div>

          <div>
            <label className="label">Categoria *</label>
            <select className="input-field" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">WhatsApp da loja *</label>
            <input
              className="input-field"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              type="tel"
              inputMode="numeric"
              placeholder="(83) 99999-9999"
            />
          </div>

          <div>
            <label className="label">Endereço *</label>
            <input className="input-field" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro, cidade" />
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <ImagePlus className="w-3.5 h-3.5" /> Logo e banner
            </label>
            <p className="text-xs text-uf-silver-dim uf-glass rounded-xl px-3 py-2.5">
              Upload de imagem fica disponível direto no painel da loja, depois que ela for criada.
            </p>
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" /> Cor principal
            </label>
            <div className="flex gap-2">
              {CORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCorPrincipal(c)}
                  className={`w-9 h-9 rounded-full border-2 transition-transform ${corPrincipal === c ? 'scale-110 border-white' : 'border-transparent'}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="label">Slug / subdomínio *</label>
            <div className="flex items-center gap-2">
              <input
                className="input-field"
                value={slug}
                onChange={(e) => {
                  setSlugTocado(true)
                  setSlug(e.target.value)
                }}
                placeholder="minha-loja"
              />
            </div>
            <p className="text-[11px] text-uf-silver-dim mt-1">
              Sua loja vai ficar em <span className="text-uf-silver">{slugify(slug) || 'minha-loja'}.rodoletas.app</span>
            </p>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Finalizar e criar minha loja
          </button>
        </form>
      </motion.div>
    </main>
  )
}
