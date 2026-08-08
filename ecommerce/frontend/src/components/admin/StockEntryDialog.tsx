import { useState } from 'react'
import { Loader2, X } from 'lucide-react'

/** "Informar aumento de estoque" — sempre uma quantidade POSITIVA somada
 * ao estoque atual (nunca sobrescreve o valor absoluto, diferente do
 * dialog "Atualizar estoque" já existente em AdminProdutos.tsx). Usado
 * tanto pra insumo quanto pra produto manual (produto ERP nunca chama
 * isso — o botão nem aparece nesses cards). Mesmo padrão visual de dialog
 * pequeno (`glass rounded-2xl p-6 max-w-sm`) já usado em todo o admin. */
export default function StockEntryDialog({
  title,
  subtitle,
  onConfirm,
  onClose,
}: {
  title: string
  subtitle?: string
  onConfirm: (quantity: number) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    const quantity = Number(value)
    if (!value.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setError('Informe uma quantidade maior que zero.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onConfirm(quantity)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível confirmar o aumento de estoque.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Informar aumento de estoque</h3>
          <button onClick={onClose} disabled={saving} className="text-son-silver-dim hover:text-white disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-son-silver-dim mb-1">{title}</p>
        {subtitle && <p className="text-xs text-son-silver-dim/70 mb-3">{subtitle}</p>}
        <label className="label mt-3">Quantidade adicionada</label>
        <input
          className="input-field mb-1"
          type="number"
          step="any"
          min="0"
          placeholder="Ex: 20"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {error && <p className="error-msg mb-2">{error}</p>}
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary flex-1">
            Cancelar
          </button>
          <button type="button" onClick={confirm} disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirmar aumento
          </button>
        </div>
      </div>
    </div>
  )
}
