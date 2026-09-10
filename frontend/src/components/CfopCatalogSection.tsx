import { useEffect, useState } from 'react'
import { FileText, Plus, Star, Trash2 } from 'lucide-react'
import { api, ApiError, type CfopOption } from '../lib/api'

/** Meu Plano -> Integrações -> Fiscal: catálogo de CFOP de saída da loja.
 * Mesmo dado que o painel da loja mostra (tenant_cfops/fiscal_cfops) -- só
 * acessado daqui via ponte interna, sem duplicar tabela nenhuma. Novos
 * produtos e produtos sem CFOP específico usam o marcado PADRÃO aqui. */
export default function CfopCatalogSection() {
  const [cfops, setCfops] = useState<CfopOption[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CfopOption[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.cfops.list().then(setCfops).catch(() => {})
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      api.cfops
        .search(query.trim())
        .then((r) => !cancelled && setResults(r))
        .catch(() => {})
        .finally(() => !cancelled && setSearching(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const add = async (codigo: string) => {
    setError(null)
    try {
      setCfops(await api.cfops.add(codigo))
      setQuery('')
      setResults([])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível adicionar esse CFOP.')
    }
  }

  const remove = async (codigo: string) => {
    try {
      setCfops(await api.cfops.remove(codigo))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível remover esse CFOP.')
    }
  }

  const setDefault = async (codigo: string) => {
    try {
      setCfops(await api.cfops.setDefault(codigo))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível definir o padrão.')
    }
  }

  return (
    <div className="uf-glass rounded-2xl p-6 space-y-4">
      <p className="text-xs text-uf-silver-dim flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> CFOPs de saída — novos produtos e produtos sem CFOP específico usam o
        marcado PADRÃO automaticamente. Você pode sobrescrever em cada produto, no painel da loja.
      </p>

      {cfops.length > 0 && (
        <ul className="space-y-1.5">
          {cfops.map((c) => (
            <li key={c.codigo} className="flex items-center gap-2 text-sm uf-glass rounded-lg px-3 py-2">
              <span className="font-mono text-xs text-uf-silver-dim">{c.codigo}</span>
              <span className="flex-1 truncate">{c.descricao}</span>
              {c.is_default ? (
                <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 shrink-0">
                  <Star className="w-3 h-3 fill-emerald-400" /> PADRÃO
                </span>
              ) : (
                <button type="button" onClick={() => setDefault(c.codigo)} className="text-[10px] text-uf-silver-dim hover:text-emerald-400 shrink-0">
                  tornar padrão
                </button>
              )}
              <button type="button" onClick={() => remove(c.codigo)} className="text-uf-silver-dim hover:text-red-400 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          className="input-field w-full"
          placeholder="Pesquisar CFOP (código ou descrição)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(searching || results.length > 0) && (
          <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto uf-glass rounded-lg shadow-xl">
            {searching && <li className="px-3 py-2 text-xs text-uf-silver-dim">Buscando…</li>}
            {results.map((r) => (
              <li key={r.codigo}>
                <button
                  type="button"
                  onClick={() => add(r.codigo)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2"
                >
                  <Plus className="w-3.5 h-3.5 text-uf-silver-dim shrink-0" />
                  <span className="font-mono text-xs text-uf-silver-dim shrink-0">{r.codigo}</span>
                  <span className="truncate">{r.descricao}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="error-msg">{error}</p>}
    </div>
  )
}
