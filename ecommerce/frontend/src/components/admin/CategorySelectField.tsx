import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { Category } from '../../types'

const CREATE_VALUE = '__create__'

type Props = {
  categories: Category[]
  value: string
  onChange: (categoryId: string) => void
  /** Creates the category via API and returns it; parent should merge into `categories`. */
  onCreateCategory: (name: string) => Promise<Category>
  className?: string
  disabled?: boolean
  /** Placeholder when empty / first option label. */
  emptyLabel?: string
}

/**
 * Category dropdown with inline "Criar categoria" mode:
 * select → input + red X (cancel) + green V (confirm).
 */
export default function CategorySelectField({
  categories,
  value,
  onChange,
  onCreateCategory,
  className = 'input-field border-amber-500/40',
  disabled,
  emptyLabel = 'Selecione uma categoria',
}: Props) {
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancelCreate = () => {
    setCreating(false)
    setDraftName('')
    setError(null)
    setBusy(false)
  }

  const confirmCreate = async () => {
    const name = draftName.trim()
    if (!name) {
      setError('Informe o nome da categoria.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await onCreateCategory(name)
      onChange(created.id)
      cancelCreate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar a categoria.')
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div>
        <div className="flex gap-2 items-stretch">
          <input
            className={className}
            placeholder="(Crie uma categoria agora)"
            value={draftName}
            disabled={disabled || busy}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void confirmCreate()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelCreate()
              }
            }}
            data-testid="category-create-input"
          />
          <button
            type="button"
            onClick={cancelCreate}
            disabled={busy}
            className="shrink-0 w-11 h-11 rounded-xl border-2 border-red-500 text-red-500 hover:bg-red-500/10 flex items-center justify-center font-black"
            title="Cancelar"
            aria-label="Cancelar criação de categoria"
            data-testid="category-create-cancel"
          >
            <X className="w-5 h-5" strokeWidth={3} />
          </button>
          <button
            type="button"
            onClick={() => void confirmCreate()}
            disabled={disabled || busy}
            className="shrink-0 w-11 h-11 rounded-xl border-2 border-emerald-500 text-emerald-500 hover:bg-emerald-500/10 flex items-center justify-center font-black"
            title="Confirmar"
            aria-label="Confirmar criação de categoria"
            data-testid="category-create-confirm"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" strokeWidth={3} />}
          </button>
        </div>
        {error && <p className="error-msg mt-1">{error}</p>}
      </div>
    )
  }

  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value
        if (next === CREATE_VALUE) {
          setCreating(true)
          setDraftName('')
          setError(null)
          return
        }
        onChange(next)
      }}
      data-testid="category-select"
    >
      <option value="">{emptyLabel}</option>
      <option value={CREATE_VALUE}>Criar categoria</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
