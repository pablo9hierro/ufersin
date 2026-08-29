import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Barcode,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import BarcodePreview from '../../components/admin/BarcodePreview'
import CategorySelectField from '../../components/admin/CategorySelectField'
import PackageUnitFields from '../../components/admin/PackageUnitFields'
import StockEntryDialog from '../../components/admin/StockEntryDialog'
import UnitAwareQuantityInput from '../../components/admin/UnitAwareQuantityInput'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import { buildProductPayload } from '../../lib/productHelpers'
import { INGREDIENT_UNITS, convertUnit } from '../../lib/ingredientUnits'
import {
  mergeUnitIntoDescription,
  parseUnitFromDescription,
  stripUnitFromDescription,
  type CatalogUnit,
  type PackageContentUnit,
} from '../../lib/catalogUnit'
import type { Category, FormulationLinePayload, Ingredient, Product } from '../../types'

function generateBarcode(): string {
  return `${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 90) + 10)}`
}

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

const DIALOG_MAX = 'max-w-[36.4rem]'

type FormulationLine = { ingredient_id: string; quantity: string; unit: Ingredient['unit'] }

const EMPTY_LINE: FormulationLine = { ingredient_id: '', quantity: '', unit: 'g' }

const EMPTY_PRODUCT_FORM = {
  name: '',
  description: '',
  price: '',
  image_url: '',
  category_id: '',
  barcode: '',
  low_stock_threshold: '',
  unit: '' as CatalogUnit,
  package_qty: '',
  package_content_unit: 'un' as PackageContentUnit,
}

/**
 * /admin/estoque — cadastro de itens de estoque (insumos) e dos produtos
 * formulados que consomem esses insumos (ex-ERP Formulação, migrado pra
 * cá). Insumo/estoque de insumo NUNCA aparece pro cliente nem no PDV como
 * produto — só o produto formulado final aparece lá, com estoque/custo
 * calculados a partir daqui.
 */
export default function AdminEstoque() {
  const navigate = useNavigate()
  const { askConfirm, confirmDialogElement } = useConfirmDialog()
  const [tab, setTab] = useState<'insumos' | 'produtos'>('insumos')
  const [addStockChoiceOpen, setAddStockChoiceOpen] = useState(false)

  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [ing, prod, cats] = await Promise.all([
        adminService.ingredients.list(),
        adminService.products.list(),
        adminService.categories.list(),
      ])
      setIngredients(ing)
      setProducts(prod.filter((p) => p.origin_type === 'erp_formulation'))
      setCategories(cats)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // ---------- Insumos ----------
  const [ingredientForm, setIngredientForm] = useState<{
    id: string | null
    name: string
    unit: Ingredient['unit']
    quantity: string
    cost_price: string
    low_stock_threshold: string
  } | null>(null)
  const [ingredientSaving, setIngredientSaving] = useState(false)
  const [ingredientError, setIngredientError] = useState<string | null>(null)
  const [stockEntryIngredient, setStockEntryIngredient] = useState<Ingredient | null>(null)
  const [stockFilter, setStockFilter] = useState<'todos' | 'baixo' | 'esgotado'>('todos')

  const openNewIngredient = () =>
    setIngredientForm({ id: null, name: '', unit: 'g', quantity: '', cost_price: '', low_stock_threshold: '' })
  const openEditIngredient = (i: Ingredient) =>
    setIngredientForm({
      id: i.id,
      name: i.name,
      unit: i.unit,
      quantity: String(i.quantity),
      cost_price: String(i.cost_price),
      low_stock_threshold: i.low_stock_threshold != null ? String(i.low_stock_threshold) : '',
    })

  const saveIngredient = async () => {
    if (!ingredientForm) return
    if (!ingredientForm.name.trim()) {
      setIngredientError('Informe o nome do item.')
      return
    }
    setIngredientError(null)
    setIngredientSaving(true)
    try {
      const payload = {
        name: ingredientForm.name.trim(),
        unit: ingredientForm.unit,
        quantity: Number(ingredientForm.quantity) || 0,
        cost_price: Number(ingredientForm.cost_price) || 0,
        low_stock_threshold: ingredientForm.low_stock_threshold.trim() === '' ? null : Number(ingredientForm.low_stock_threshold),
      }
      if (ingredientForm.id) await adminService.ingredients.update(ingredientForm.id, payload)
      else await adminService.ingredients.create(payload)
      setIngredientForm(null)
      load()
    } catch (e) {
      setIngredientError(e instanceof ApiError ? e.message : 'Não foi possível salvar o item de estoque.')
    } finally {
      setIngredientSaving(false)
    }
  }

  const removeIngredient = (i: Ingredient) =>
    askConfirm('Remover este item de estoque?', async () => {
      await adminService.ingredients.delete(i.id)
      load()
    })

  // ---------- Produtos formulados ----------
  const [productWizardOpen, setProductWizardOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [step, setStep] = useState<'formulacao' | 'comercial'>('formulacao')
  const [formulationName, setFormulationName] = useState('')
  const [lines, setLines] = useState<FormulationLine[]>([{ ...EMPTY_LINE }])
  const [form, setForm] = useState(EMPTY_PRODUCT_FORM)
  const [productSaving, setProductSaving] = useState(false)
  const [productError, setProductError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openNewProduct = () => {
    setEditingProduct(null)
    setFormulationName('')
    setLines([{ ...EMPTY_LINE }])
    setForm(EMPTY_PRODUCT_FORM)
    setStep('formulacao')
    setProductError(null)
    setProductWizardOpen(true)
  }

  const openEditProduct = (p: Product) => {
    setEditingProduct(p)
    setFormulationName(p.name)
    setLines([{ ...EMPTY_LINE }]) // formulação existente não é re-lida aqui (endpoint de leitura fica pra uma iteração futura); lojista redefine ao editar
    const unitBits = parseUnitFromDescription(p.description)
    setForm({
      name: p.name,
      description: stripUnitFromDescription(p.description),
      price: String(p.price),
      image_url: p.image_url ?? '',
      category_id: p.category_id ?? '',
      barcode: p.barcode ?? '',
      low_stock_threshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : '',
      unit: unitBits.unit,
      package_qty: unitBits.package_qty,
      package_content_unit: unitBits.package_content_unit,
    })
    setStep('formulacao')
    setProductError(null)
    setProductWizardOpen(true)
  }

  const addLine = () => setLines((ls) => [...ls, { ...EMPTY_LINE }])
  const removeLine = (idx: number) => setLines((ls) => ls.filter((_, i) => i !== idx))
  const updateLine = (idx: number, patch: Partial<FormulationLine>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  // Preview ao vivo (mesma fórmula do backend) — insumo limitante,
  // disponibilidade e custo estimado, atualizados a cada digitação.
  const preview = (() => {
    let available: number | null = null
    let limitingName: string | null = null
    let cost = 0
    let hasValidLine = false
    for (const line of lines) {
      const ingredient = ingredients.find((i) => i.id === line.ingredient_id)
      const qty = Number(line.quantity)
      if (!ingredient || !Number.isFinite(qty) || qty <= 0) continue
      hasValidLine = true
      const stockInLineUnit = convertUnit(ingredient.quantity, ingredient.unit, line.unit)
      const qtyInIngredientUnit = convertUnit(qty, line.unit, ingredient.unit)
      if (stockInLineUnit == null || qtyInIngredientUnit == null) continue
      const possible = Math.floor(stockInLineUnit / qty)
      if (available == null || possible < available) {
        available = possible
        limitingName = ingredient.name
      }
      cost += qtyInIngredientUnit * ingredient.cost_price
    }
    return { available: hasValidLine ? (available ?? 0) : null, limitingName, cost }
  })()

  const goToComercial = () => {
    if (!formulationName.trim()) {
      setProductError('Informe o nome do produto.')
      return
    }
    const validLines = lines.filter((l) => l.ingredient_id && Number(l.quantity) > 0)
    if (validLines.length === 0) {
      setProductError('Adicione pelo menos um insumo com quantidade maior que zero.')
      return
    }
    setProductError(null)
    setForm((f) => ({ ...f, name: formulationName.trim() }))
    setStep('comercial')
  }

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setProductError(null)
    setUploading(true)
    try {
      const { url } = await adminService.products.uploadImage(file)
      setForm((f) => ({ ...f, image_url: url }))
    } catch (err) {
      setProductError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  const saveFormulatedProduct = async () => {
    const lowStock = Number(form.low_stock_threshold)
    if (!Number.isFinite(lowStock) || lowStock < 0 || form.low_stock_threshold.trim() === '') {
      setProductError('Informe o alerta de estoque baixo (repor ao chegar em).')
      return
    }
    if (!form.category_id) {
      setProductError('Escolha uma categoria.')
      return
    }
    if (form.unit === 'pacote') {
      const pq = Number(form.package_qty)
      if (!Number.isFinite(pq) || pq <= 0 || form.package_qty.trim() === '') {
        setProductError('Informe quanto vem dentro de um pacote.')
        return
      }
    }
    const formulation: FormulationLinePayload[] = lines
      .filter((l) => l.ingredient_id && Number(l.quantity) > 0)
      .map((l) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit: l.unit }))
    if (formulation.length === 0) {
      setProductError('Adicione pelo menos um insumo com quantidade maior que zero.')
      return
    }
    setProductSaving(true)
    setProductError(null)
    try {
      const description = mergeUnitIntoDescription(form.description, form.unit, form.package_qty, form.package_content_unit)
      const commercial = buildProductPayload({ ...form, description, quantity: '0', cost_price: '' })
      const payload = { ...commercial, formulation }
      if (editingProduct) await adminService.products.updateFormulation(editingProduct.id, payload)
      else await adminService.products.createFormulation(payload)
      setProductWizardOpen(false)
      load()
    } catch (e) {
      setProductError(e instanceof ApiError ? e.message : 'Não foi possível salvar o produto.')
    } finally {
      setProductSaving(false)
    }
  }

  const removeProduct = (p: Product) =>
    askConfirm('Remover este produto?', async () => {
      await adminService.products.delete(p.id)
      load()
    })

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/admin/produtos" className="btn-secondary text-sm py-2 px-3">
            <ArrowLeft className="w-4 h-4" /> Produtos
          </Link>
          <h1 className="text-2xl font-black">Estoque</h1>
        </div>
        <button type="button" onClick={() => setAddStockChoiceOpen(true)} className="btn-primary text-sm py-2 px-4">
          <PackagePlus className="w-4 h-4" /> Adicionar estoque
        </button>
      </div>

      <Card className="p-4 mb-6">
        <p className="text-sm text-son-silver-dim">
          Cadastre <span className="text-emerald-400 font-semibold">itens de estoque</span> (insumos) e monte a{' '}
          <span className="text-emerald-400 font-semibold">ficha técnica</span> de produtos que consomem esses itens. Itens
          de estoque <span className="text-white font-semibold">nunca aparecem</span> pro cliente nem no PDV como produto —
          só o produto formulado final aparece lá, com estoque/custo calculados automaticamente a partir daqui.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-2 mb-6 max-w-sm">
        {(['insumos', 'produtos'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`py-2.5 rounded-2xl border text-sm font-medium transition-all capitalize ${
              tab === value ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver hover:border-son-pink/30'
            }`}
          >
            {value === 'insumos' ? 'Itens de estoque' : 'Produtos formulados'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-son-silver-dim" />
        </div>
      ) : tab === 'insumos' ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex gap-2">
              {(['todos', 'baixo', 'esgotado'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStockFilter(f)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                    stockFilter === f ? 'sunset-bg text-white border-transparent' : 'bg-son-surface border-white/10 text-son-silver-dim hover:border-son-pink/30'
                  }`}
                >
                  {f === 'todos' ? 'Todos' : f === 'baixo' ? 'Baixo estoque' : 'Esgotados'}
                </button>
              ))}
            </div>
            <button type="button" onClick={openNewIngredient} className="btn-primary text-sm py-2 px-4">
              <Plus className="w-4 h-4" /> Novo item de estoque
            </button>
          </div>
          {(() => {
            const filtered = ingredients.filter((i) => {
              if (stockFilter === 'esgotado') return i.quantity <= 0
              if (stockFilter === 'baixo') return i.low_stock_threshold != null && i.quantity > 0 && i.quantity <= i.low_stock_threshold
              return true
            })
            if (filtered.length === 0) {
              return (
                <p className="text-sm text-son-silver-dim">
                  {stockFilter === 'todos' ? 'Nenhum item de estoque cadastrado ainda.' : 'Nenhum item nessa condição.'}
                </p>
              )
            }
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((i) => {
                  const esgotado = i.quantity <= 0
                  const baixo = !esgotado && i.low_stock_threshold != null && i.quantity <= i.low_stock_threshold
                  return (
                    <Card key={i.id} className={`p-4 ${esgotado ? 'border-red-500/40' : baixo ? 'border-amber-500/40' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-white">{i.name}</p>
                        {esgotado && <span className="text-[10px] font-bold text-red-400 shrink-0">ESGOTADO</span>}
                        {baixo && <span className="text-[10px] font-bold text-amber-400 shrink-0">BAIXO ESTOQUE</span>}
                      </div>
                      <div className="flex items-center justify-between text-sm mb-3">
                        <span className="text-son-silver-dim">
                          {i.quantity} {i.unit} em estoque
                        </span>
                        <span className="sunset-text font-bold">
                          {currency(i.cost_price)}/{i.unit}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditIngredient(i)} className="btn-secondary flex-1 text-sm py-2">
                          <Pencil className="w-3.5 h-3.5" /> Editar
                        </button>
                        <button onClick={() => setStockEntryIngredient(i)} className="btn-secondary text-sm py-2 px-3">
                          <Wallet className="w-3.5 h-3.5" /> Atualizar estoque
                        </button>
                        <button onClick={() => removeIngredient(i)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )
          })()}
        </div>
      ) : (
        <div>
          <div className="flex justify-end mb-4">
            <button type="button" onClick={openNewProduct} className="btn-primary text-sm py-2 px-4">
              <Plus className="w-4 h-4" /> Novo produto formulado
            </button>
          </div>
          {products.length === 0 ? (
            <p className="text-sm text-son-silver-dim">Nenhum produto formulado ainda.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="w-full aspect-video rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden mb-3">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package className="w-8 h-8 text-son-silver-dim/40" />
                    )}
                  </div>
                  <p className="font-semibold text-white">{p.name}</p>
                  <p className="text-xs text-son-silver-dim mb-1">{p.category_name ?? 'Sem categoria'}</p>
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="sunset-text font-bold">{currency(p.price)}</span>
                    <span className="text-son-silver-dim" title="Estoque calculado automaticamente pelos insumos">
                      {p.quantity} calculado
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEditProduct(p)} className="btn-secondary flex-1 text-sm py-2">
                      <Pencil className="w-3.5 h-3.5" /> Editar
                    </button>
                    <button onClick={() => removeProduct(p)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {addStockChoiceOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setAddStockChoiceOpen(false)}
        >
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Adicionar estoque</h3>
              <button onClick={() => setAddStockChoiceOpen(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => navigate('/admin/estoque/xml')}
                className="w-full text-left btn-secondary py-3 px-4 flex items-center gap-3"
              >
                <FileSpreadsheet className="w-5 h-5 text-son-pink shrink-0" />
                <span>
                  <span className="block font-semibold">Importar XML</span>
                  <span className="block text-xs text-son-silver-dim">Nota fiscal de entrada de um fornecedor/distribuidor</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddStockChoiceOpen(false)
                  setTab('insumos')
                  openNewIngredient()
                }}
                className="w-full text-left btn-secondary py-3 px-4 flex items-center gap-3"
              >
                <Plus className="w-5 h-5 text-son-pink shrink-0" />
                <span>
                  <span className="block font-semibold">Cadastro manual</span>
                  <span className="block text-xs text-son-silver-dim">Digitar um item de estoque na mão</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {ingredientForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !ingredientSaving && setIngredientForm(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{ingredientForm.id ? 'Editar item de estoque' : 'Novo item de estoque'}</h3>
              <button onClick={() => setIngredientForm(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input
                  className="input-field"
                  value={ingredientForm.name}
                  onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Unidade</label>
                  <select
                    className="input-field"
                    value={ingredientForm.unit}
                    onChange={(e) => setIngredientForm({ ...ingredientForm, unit: e.target.value as Ingredient['unit'] })}
                  >
                    {INGREDIENT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Estoque inicial</label>
                  <input
                    className="input-field"
                    type="number"
                    step="any"
                    value={ingredientForm.quantity}
                    onChange={(e) => setIngredientForm({ ...ingredientForm, quantity: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Custo por {ingredientForm.unit}</label>
                <input
                  className="input-field"
                  type="number"
                  step="0.01"
                  value={ingredientForm.cost_price}
                  onChange={(e) => setIngredientForm({ ...ingredientForm, cost_price: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Avisar baixo estoque ao chegar em (opcional)</label>
                <input
                  className="input-field"
                  type="number"
                  step="any"
                  placeholder={`Ex: 10 ${ingredientForm.unit}`}
                  value={ingredientForm.low_stock_threshold}
                  onChange={(e) => setIngredientForm({ ...ingredientForm, low_stock_threshold: e.target.value })}
                />
              </div>
              {ingredientError && <p className="error-msg">{ingredientError}</p>}
              <button onClick={saveIngredient} disabled={ingredientSaving} className="btn-primary w-full mt-2">
                {ingredientSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {stockEntryIngredient && (
        <StockEntryDialog
          title={stockEntryIngredient.name}
          subtitle={`Estoque atual: ${stockEntryIngredient.quantity} ${stockEntryIngredient.unit}`}
          onClose={() => setStockEntryIngredient(null)}
          onConfirm={async (quantity) => {
            await adminService.ingredients.stockEntry(stockEntryIngredient.id, quantity)
            setStockEntryIngredient(null)
            load()
          }}
        />
      )}

      {productWizardOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !productSaving && setProductWizardOpen(false)}>
          <div className={`glass rounded-2xl p-6 ${DIALOG_MAX} w-full max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">
                {editingProduct ? 'Editar produto formulado' : 'Novo produto formulado'} — {step === 'formulacao' ? '1. Formulação' : '2. Dados comerciais'}
              </h3>
              <button onClick={() => setProductWizardOpen(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {step === 'formulacao' ? (
              <div className="space-y-3">
                <div>
                  <label className="label">Nome do produto</label>
                  <input className="input-field" value={formulationName} onChange={(e) => setFormulationName(e.target.value)} placeholder="Ex: Pão francês" />
                </div>
                <div className="space-y-2">
                  <label className="label mb-0">Itens de estoque usados</label>
                  {lines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <select
                        className="input-field flex-1"
                        value={line.ingredient_id}
                        onChange={(e) => updateLine(idx, { ingredient_id: e.target.value })}
                      >
                        <option value="">Selecionar item…</option>
                        {ingredients.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                      <UnitAwareQuantityInput
                        ingredientUnit={ingredients.find((i) => i.id === line.ingredient_id)?.unit ?? null}
                        quantity={line.quantity}
                        unit={line.unit}
                        onChange={(patch) => updateLine(idx, patch)}
                      />
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(idx)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addLine} className="btn-secondary text-sm py-2 px-3">
                    <Plus className="w-3.5 h-3.5" /> Item
                  </button>
                </div>

                <div className="rounded-xl border border-white/10 bg-son-surface px-3 py-3 space-y-1 text-sm">
                  <p className="text-son-silver-dim">
                    Custo estimado: <span className="text-white font-semibold">{currency(preview.cost)}</span>
                  </p>
                  <p className="text-son-silver-dim">
                    Disponibilidade:{' '}
                    <span className="text-white font-semibold">{preview.available == null ? '—' : `${preview.available} unidades`}</span>
                    {preview.limitingName && <span> (item limitante: {preview.limitingName})</span>}
                  </p>
                </div>

                {productError && <p className="error-msg">{productError}</p>}
                <button type="button" onClick={goToComercial} className="btn-primary w-full mt-2">
                  Avançar
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="label">
                    Nome <span className="text-amber-400">*</span>
                  </label>
                  <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Descrição</label>
                  <textarea className="input-field" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">
                      Preço <span className="text-amber-400">*</span>
                    </label>
                    <input className="input-field" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Quantidade disponível</label>
                    <input className="input-field opacity-60 cursor-not-allowed" value={preview.available ?? 0} disabled readOnly />
                    <p className="text-[10px] text-son-silver-dim mt-1">Calculado automaticamente pela disponibilidade dos itens de estoque.</p>
                  </div>
                </div>
                <div>
                  <label className="label">
                    Repor ao chegar em <span className="text-amber-400">*</span>
                  </label>
                  <input
                    className="input-field border-amber-500/40"
                    type="number"
                    placeholder="Obrigatório"
                    value={form.low_stock_threshold}
                    onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">
                    Categoria <span className="text-amber-400">*</span>
                  </label>
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
                <PackageUnitFields
                  value={{ unit: form.unit, package_qty: form.package_qty, package_content_unit: form.package_content_unit }}
                  onChange={(patch) => setForm({ ...form, ...patch })}
                  required
                />
                <div>
                  <label className="label flex items-center gap-1.5">
                    <Barcode className="w-3.5 h-3.5" /> Código de barras
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="input-field"
                      placeholder="Escaneie, digite ou gere um novo (opcional, usado no PDV)"
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    />
                    <button type="button" onClick={() => setForm({ ...form, barcode: generateBarcode() })} className="btn-secondary text-sm py-2 px-3 flex-shrink-0">
                      <Sparkles className="w-3.5 h-3.5" /> Gerar
                    </button>
                  </div>
                  {form.barcode && (
                    <div className="mt-2">
                      <BarcodePreview value={form.barcode} productName={form.name} />
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">Imagem</label>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-20 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden flex-shrink-0">
                      {uploading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-son-silver-dim" />
                      ) : form.image_url ? (
                        <img src={form.image_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-6 h-6 text-son-silver-dim/40" />
                      )}
                    </div>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-secondary text-sm py-2 px-3">
                      <ImagePlus className="w-3.5 h-3.5" />
                      {form.image_url ? 'Trocar imagem' : 'Enviar imagem'}
                    </button>
                  </div>
                </div>
                {productError && <p className="error-msg">{productError}</p>}
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => setStep('formulacao')} className="btn-secondary flex-1">
                    Voltar
                  </button>
                  <button type="button" onClick={saveFormulatedProduct} disabled={productSaving} className="btn-primary flex-1">
                    {productSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDialogElement}
    </div>
  )
}
