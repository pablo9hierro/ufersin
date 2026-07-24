import { useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Product } from '../../lib/types'

// Busca com autocomplete (nome ou código de barras) + chips dos produtos já
// escolhidos — usado tanto no formulário de campanha quanto no filtro de
// "cliente comprou o produto X" do CRM.
export default function ProductMultiSelect({
  products,
  selectedIds,
  onChange,
}: {
  products: Product[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')

  const selected = selectedIds.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p)
  const matches =
    query.trim().length > 0
      ? products
          .filter(
            (p) =>
              !selectedIds.includes(p.id) &&
              (p.name.toLowerCase().includes(query.trim().toLowerCase()) ||
                (p.barcode && p.barcode.includes(query.trim())))
          )
          .slice(0, 8)
      : []

  return (
    <div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((p) => (
            <span key={p.id} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-son-pink/15 text-son-pink text-xs font-medium">
              {p.name}
              <button type="button" onClick={() => onChange(selectedIds.filter((id) => id !== p.id))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 text-son-silver-dim absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input-field pl-9"
          placeholder="Buscar por nome ou código de barras..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-son-surface border border-white/10 rounded-xl overflow-hidden shadow-lg max-h-48 overflow-y-auto">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange([...selectedIds, p.id])
                  setQuery('')
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-son-silver hover:bg-son-surface-light text-left"
              >
                <span className="truncate">{p.name}</span>
                {p.barcode && <span className="text-xs text-son-silver-dim font-mono flex-shrink-0 max-w-[140px] truncate">{p.barcode}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
