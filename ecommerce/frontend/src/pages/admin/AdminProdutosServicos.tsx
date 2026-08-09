import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Wrench, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import CategorySelectField from '../../components/admin/CategorySelectField'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { Category, Ingredient, Service } from '../../types'

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

type ServiceIngredientLine = { ingredient_id: string; quantity: string; unit: Ingredient['unit'] }
type ExtraCostLine = { label: string; value: string }

const EMPTY_INGREDIENT_LINE: ServiceIngredientLine = { ingredient_id: '', quantity: '', unit: 'un' }
const EMPTY_EXTRA_COST_LINE: ExtraCostLine = { label: '', value: '' }

/**
 * /admin/produtos/servicos — cadastro de SERVIÇOS (reparo/manutenção),
 * entidade separada de produto: sem estoque próprio, custo vem da
 * composição de itens de estoque + custos extras livres, mas o preço
 * final é sempre digitado pelo lojista.
 */
export default function AdminProdutosServicos() {
  const { askConfirm, confirmDialogElement } = useConfirmDialog()
  const [services, setServices] = useState<Service[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [svc, ing, cats] = await Promise.all([
        adminService.services.list(),
        adminService.ingredients.list(),
        adminService.categories.list(),
      ])
      setServices(svc)
      setIngredients(ing)
      setCategories(cats)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const [form, setForm] = useState<{
    id: string | null
    name: string
    description: string
    category_id: string
    price: string
    ingredientLines: ServiceIngredientLine[]
    extraCostLines: ExtraCostLine[]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openNew = () =>
    setForm({
      id: null,
      name: '',
      description: '',
      category_id: '',
      price: '',
      ingredientLines: [{ ...EMPTY_INGREDIENT_LINE }],
      extraCostLines: [],
    })

  const openEdit = (s: Service) =>
    setForm({
      id: s.id,
      name: s.name,
      description: s.description,
      category_id: s.category_id ?? '',
      price: String(s.price),
      ingredientLines:
        s.ingredients.length > 0
          ? s.ingredients.map((i) => ({ ingredient_id: i.ingredient_id, quantity: String(i.quantity), unit: i.unit }))
          : [{ ...EMPTY_INGREDIENT_LINE }],
      extraCostLines: s.extra_costs.map((c) => ({ label: c.label, value: String(c.value) })),
    })

  const addIngredientLine = () =>
    setForm((f) => (f ? { ...f, ingredientLines: [...f.ingredientLines, { ...EMPTY_INGREDIENT_LINE }] } : f))
  const removeIngredientLine = (idx: number) =>
    setForm((f) => (f ? { ...f, ingredientLines: f.ingredientLines.filter((_, i) => i !== idx) } : f))
  const updateIngredientLine = (idx: number, patch: Partial<ServiceIngredientLine>) =>
    setForm((f) => (f ? { ...f, ingredientLines: f.ingredientLines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) } : f))

  const addExtraCostLine = () =>
    setForm((f) => (f ? { ...f, extraCostLines: [...f.extraCostLines, { ...EMPTY_EXTRA_COST_LINE }] } : f))
  const removeExtraCostLine = (idx: number) =>
    setForm((f) => (f ? { ...f, extraCostLines: f.extraCostLines.filter((_, i) => i !== idx) } : f))
  const updateExtraCostLine = (idx: number, patch: Partial<ExtraCostLine>) =>
    setForm((f) => (f ? { ...f, extraCostLines: f.extraCostLines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) } : f))

  const estimatedCost = (() => {
    if (!form) return 0
    let total = 0
    for (const line of form.ingredientLines) {
      const ingredient = ingredients.find((i) => i.id === line.ingredient_id)
      const qty = Number(line.quantity)
      if (!ingredient || !Number.isFinite(qty) || qty <= 0) continue
      // Preview simples — soma direto sem converter unidade (conversão de
      // verdade acontece no backend); só orientativo enquanto digita.
      total += qty * ingredient.cost_price
    }
    for (const extra of form.extraCostLines) {
      total += Number(extra.value) || 0
    }
    return total
  })()

  const save = async () => {
    if (!form) return
    if (!form.name.trim()) {
      setError('Informe o nome do serviço.')
      return
    }
    if (!form.price.trim() || Number(form.price) <= 0) {
      setError('Informe o preço final do serviço.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        category_id: form.category_id || null,
        price: Number(form.price),
        active: true,
        ingredients: form.ingredientLines
          .filter((l) => l.ingredient_id && Number(l.quantity) > 0)
          .map((l) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit: l.unit })),
        extra_costs: form.extraCostLines
          .filter((l) => l.label.trim() && Number(l.value) > 0)
          .map((l) => ({ label: l.label.trim(), value: Number(l.value) })),
      }
      if (form.id) await adminService.services.update(form.id, payload)
      else await adminService.services.create(payload)
      setForm(null)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar o serviço.')
    } finally {
      setSaving(false)
    }
  }

  const remove = (s: Service) =>
    askConfirm('Remover este serviço?', async () => {
      await adminService.services.delete(s.id)
      load()
    })

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/admin/produtos" className="btn-secondary text-sm py-2 px-3">
            <ArrowLeft className="w-4 h-4" /> Produtos
          </Link>
          <h1 className="text-2xl font-black">Serviços</h1>
        </div>
        <button type="button" onClick={openNew} className="btn-primary text-sm py-2 px-4">
          <Plus className="w-4 h-4" /> Novo serviço
        </button>
      </div>

      <Card className="p-4 mb-6">
        <p className="text-sm text-son-silver-dim">
          Cadastre serviços (reparo, troca, manutenção) separados dos produtos — sem estoque próprio. O custo pode vir de{' '}
          <Link to="/admin/estoque" className="text-son-pink underline">
            itens de estoque
          </Link>{' '}
          usados + custos extras em texto livre; o preço final você define.
        </p>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-son-silver-dim" />
        </div>
      ) : services.length === 0 ? (
        <p className="text-sm text-son-silver-dim">Nenhum serviço cadastrado ainda.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="w-full aspect-video rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden mb-3">
                <Wrench className="w-8 h-8 text-son-silver-dim/40" />
              </div>
              <p className="font-semibold text-white">{s.name}</p>
              <p className="text-xs text-son-silver-dim mb-1">{categories.find((c) => c.id === s.category_id)?.name ?? 'Sem categoria'}</p>
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="sunset-text font-bold">{currency(s.price)}</span>
                <span className="text-son-silver-dim" title="Custo estimado a partir dos itens de estoque + custos extras">
                  custo ref. {currency(s.estimated_cost)}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(s)} className="btn-secondary flex-1 text-sm py-2">
                  <Pencil className="w-3.5 h-3.5" /> Editar
                </button>
                <button onClick={() => remove(s)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !saving && setForm(null)}>
          <div className="glass rounded-2xl p-6 max-w-[36.4rem] w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{form.id ? 'Editar serviço' : 'Novo serviço'}</h3>
              <button onClick={() => setForm(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">
                  Nome <span className="text-amber-400">*</span>
                </label>
                <input
                  className="input-field"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Troca de tela iPhone 12"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Descrição</label>
                <textarea className="input-field" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label className="label">Categoria</label>
                <CategorySelectField
                  className="input-field"
                  emptyLabel="Sem categoria"
                  categories={categories}
                  value={form.category_id}
                  onChange={(category_id) => setForm({ ...form, category_id })}
                  onCreateCategory={async (name) => {
                    const created = await adminService.categories.create(name)
                    setCategories((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]))
                    return created
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="label mb-0">Itens de estoque usados (opcional)</label>
                {form.ingredientLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <select
                      className="input-field flex-1"
                      value={line.ingredient_id}
                      onChange={(e) => updateIngredientLine(idx, { ingredient_id: e.target.value })}
                    >
                      <option value="">Selecionar item de estoque…</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input-field w-24"
                      type="number"
                      step="any"
                      placeholder="Qtd"
                      value={line.quantity}
                      onChange={(e) => updateIngredientLine(idx, { quantity: e.target.value })}
                    />
                    <select
                      className="input-field w-24"
                      value={line.unit}
                      onChange={(e) => updateIngredientLine(idx, { unit: e.target.value as Ingredient['unit'] })}
                    >
                      {(['g', 'kg', 'ml', 'l', 'un'] as const).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    {form.ingredientLines.length > 1 && (
                      <button type="button" onClick={() => removeIngredientLine(idx)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addIngredientLine} className="btn-secondary text-sm py-2 px-3">
                  <Plus className="w-3.5 h-3.5" /> Item de estoque
                </button>
              </div>

              <div className="space-y-2">
                <label className="label mb-0">Custos extras (opcional)</label>
                {form.extraCostLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <input
                      className="input-field flex-1"
                      placeholder="Descrição (ex: mão de obra)"
                      value={line.label}
                      onChange={(e) => updateExtraCostLine(idx, { label: e.target.value })}
                    />
                    <input
                      className="input-field w-28"
                      type="number"
                      step="0.01"
                      placeholder="Valor"
                      value={line.value}
                      onChange={(e) => updateExtraCostLine(idx, { value: e.target.value })}
                    />
                    <button type="button" onClick={() => removeExtraCostLine(idx)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addExtraCostLine} className="btn-secondary text-sm py-2 px-3">
                  <Plus className="w-3.5 h-3.5" /> + Custo
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-son-surface px-3 py-3 text-sm">
                <p className="text-son-silver-dim">
                  Custo de referência: <span className="text-white font-semibold">{currency(estimatedCost)}</span>
                </p>
              </div>

              <div>
                <label className="label">
                  Preço final do serviço <span className="text-amber-400">*</span>
                </label>
                <input className="input-field" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>

              {error && <p className="error-msg">{error}</p>}
              <button onClick={save} disabled={saving} className="btn-primary w-full mt-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialogElement}
    </div>
  )
}
