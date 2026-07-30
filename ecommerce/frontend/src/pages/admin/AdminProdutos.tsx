import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Barcode, ImagePlus, Loader2, Package, PackageX, Pencil, Plus, Sparkles, Trash2, TrendingUp, Wallet, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import BarcodePreview from '../../components/admin/BarcodePreview'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { ApiError } from '../../lib/apiError'
import { adminService } from '../../services/adminService'
import type { Category, Product } from '../../types'

// Timestamp (10 dígitos) + 2 dígitos aleatórios — não é um EAN de verdade
// (sem dígito verificador), só um código único o bastante pra escanear no
// PDV com CODE128, que aceita qualquer texto.
function generateBarcode(): string {
  return `${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 90) + 10)}`
}

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

const EMPTY_FORM = { name: '', description: '', price: '', quantity: '', image_url: '', category_id: '', barcode: '', cost_price: '', low_stock_threshold: '' }

type Tab = 'todos' | 'baixo' | 'falta'

// Produto zerado sempre vira "em falta", nunca some no meio -- "baixo
// estoque" só existe pra quem AINDA tem alguma unidade e já configurou
// um ponto de reposição (sem threshold definido, não há como saber
// quando alertar, então o produto só aparece aqui de novo quando zerar).
function isOutOfStock(p: Product) {
  return p.quantity <= 0
}
function isLowStock(p: Product) {
  return !isOutOfStock(p) && p.low_stock_threshold != null && p.quantity <= p.low_stock_threshold
}

export default function AdminProdutos() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('todos')
  const [editing, setEditing] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  // Diálogo de reposição -- aberto ao clicar num produto nas abas
  // "Baixo estoque"/"Em falta". Só pede a nova quantidade (e, na aba "Em
  // falta", também dá a opção de remover o produto de vez).
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [stockValue, setStockValue] = useState('')
  const [stockSaving, setStockSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([adminService.products.list(), adminService.categories.list()])
      .then(([p, c]) => {
        setProducts(p)
        setCategories(c)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const openNew = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }
  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      quantity: String(p.quantity),
      image_url: p.image_url ?? '',
      category_id: p.category_id ?? '',
      barcode: p.barcode ?? '',
      cost_price: p.cost_price != null ? String(p.cost_price) : '',
      low_stock_threshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : '',
    })
    setShowForm(true)
  }

  const save = async () => {
    setSaving(true)
    const payload = {
      name: form.name,
      description: form.description || null,
      price: Number(form.price),
      quantity: Number(form.quantity),
      image_url: form.image_url || null,
      category_id: form.category_id || null,
      barcode: form.barcode || null,
      cost_price: form.cost_price.trim() === '' ? null : Number(form.cost_price),
      low_stock_threshold: form.low_stock_threshold.trim() === '' ? null : Number(form.low_stock_threshold),
    }
    try {
      if (editing) await adminService.products.update(editing.id, payload)
      else await adminService.products.create(payload)
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const remove = (id: string) =>
    askConfirm('Remover este produto?', async () => {
      await adminService.products.delete(id)
      load()
    })

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const { url } = await adminService.products.uploadImage(file)
      setForm((f) => ({ ...f, image_url: url }))
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  const addCategory = async () => {
    if (!newCategory.trim()) return
    await adminService.categories.create(newCategory.trim())
    setNewCategory('')
    load()
  }

  const openStockDialog = (p: Product) => {
    setStockProduct(p)
    setStockValue(String(p.quantity))
  }

  const saveStock = async () => {
    if (!stockProduct) return
    setStockSaving(true)
    try {
      // Manda o produto inteiro (só trocando quantity) -- update() é um
      // replace completo (local e via RPC), um payload parcial apagaria
      // os outros campos (descrição, imagem, categoria etc).
      await adminService.products.update(stockProduct.id, { ...stockProduct, quantity: Number(stockValue) })
      setStockProduct(null)
      load()
    } finally {
      setStockSaving(false)
    }
  }

  const removeFromStockDialog = () => {
    if (!stockProduct) return
    const id = stockProduct.id
    setStockProduct(null)
    askConfirm('Remover este produto?', async () => {
      await adminService.products.delete(id)
      load()
    })
  }

  const lowStockProducts = products.filter(isLowStock)
  const outOfStockProducts = products.filter(isOutOfStock)
  const totalQuantity = products.reduce((sum, p) => sum + p.quantity, 0)
  const totalCostValue = products.reduce((sum, p) => sum + (p.cost_price ?? 0) * p.quantity, 0)
  const totalMarkupValue = products.reduce((sum, p) => sum + (p.cost_price != null ? (p.price - p.cost_price) * p.quantity : 0), 0)

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'baixo', label: 'Baixo estoque', count: lowStockProducts.length },
    { key: 'falta', label: 'Em falta', count: outOfStockProducts.length },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">Produtos</h1>
        {tab === 'todos' && (
          <button onClick={openNew} className="btn-primary text-sm py-2 px-4">
            <Plus className="w-4 h-4" /> Novo produto
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-son-surface-light flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-son-silver-dim" />
          </span>
          <div>
            <p className="text-xs text-son-silver-dim">Estoque total</p>
            <p className="font-black text-lg">{totalQuantity}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-son-surface-light flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5 text-son-silver-dim" />
          </span>
          <div>
            <p className="text-xs text-son-silver-dim">Custo total em estoque</p>
            <p className="font-black text-lg">{currency(totalCostValue)}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-son-surface-light flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-son-silver-dim" />
          </span>
          <div>
            <p className="text-xs text-son-silver-dim">Valor a mais (markup) total</p>
            <p className="font-black text-lg">{currency(totalMarkupValue)}</p>
          </div>
        </Card>
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 justify-center ${tab === t.key ? 'btn-primary text-sm py-2 px-4' : 'btn-secondary text-sm py-2 px-4'}`}
          >
            {t.label}
            {!!t.count && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{t.count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
      ) : tab === 'todos' ? (
        <>
          <Card className="p-4 mb-6">
            <p className="label mb-2">Categorias</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {categories.map((c) => (
                <span key={c.id} className="px-3 py-1.5 rounded-xl bg-son-surface-light text-sm text-son-silver">
                  {c.name}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="input-field"
                placeholder="Nova categoria"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button onClick={addCategory} className="btn-secondary px-4">
                Adicionar
              </button>
            </div>
          </Card>

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
                  <span className="text-son-silver-dim">{p.quantity} em estoque</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(p)} className="btn-secondary flex-1 text-sm py-2">
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={() => remove(p.id)} className="btn-secondary text-sm py-2 px-3 hover:text-son-pink">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : tab === 'baixo' ? (
        lowStockProducts.length === 0 ? (
          <div className="text-center py-16 text-son-silver-dim">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Nenhum produto com estoque baixo no momento.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {lowStockProducts.map((p) => (
              <li key={p.id}>
                <button onClick={() => openStockDialog(p)} className="w-full text-left glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-colors">
                  <span className="w-11 h-11 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden shrink-0">
                    {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{p.name}</p>
                    <p className="text-xs text-son-silver-dim">Ponto de reposição: {p.low_stock_threshold}</p>
                  </div>
                  <span className="text-sm font-bold text-yellow-500 shrink-0">{p.quantity} em estoque</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : outOfStockProducts.length === 0 ? (
        <div className="text-center py-16 text-son-silver-dim">
          <PackageX className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Nenhum produto em falta no momento.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {outOfStockProducts.map((p) => (
            <li key={p.id}>
              <button onClick={() => openStockDialog(p)} className="w-full text-left glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-colors">
                <span className="w-11 h-11 rounded-xl bg-son-surface-light flex items-center justify-center overflow-hidden shrink-0">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <PackageX className="w-5 h-5 text-red-500" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{p.name}</p>
                  <p className="text-xs text-son-silver-dim">{p.category_name ?? 'Sem categoria'}</p>
                </div>
                <span className="text-sm font-bold text-red-500 shrink-0">Em falta</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">{editing ? 'Editar produto' : 'Novo produto'}</h3>
              <button onClick={() => setShowForm(false)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nome</label>
                <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Descrição</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Preço</label>
                  <input
                    className="input-field"
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Estoque</label>
                  <input
                    className="input-field"
                    type="number"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor de custo</label>
                  <input
                    className="input-field"
                    type="number"
                    step="0.01"
                    placeholder="Opcional"
                    value={form.cost_price}
                    onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Repor ao chegar em</label>
                  <input
                    className="input-field"
                    type="number"
                    placeholder="Opcional"
                    value={form.low_stock_threshold}
                    onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Categoria</label>
                <select
                  className="input-field"
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                >
                  <option value="">Sem categoria</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
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
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, barcode: generateBarcode() })}
                    className="btn-secondary text-sm py-2 px-3 flex-shrink-0"
                    title="Gerar código de barras automaticamente"
                  >
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                />
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
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="btn-secondary text-sm py-2 px-3"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    {form.image_url ? 'Trocar imagem' : 'Enviar imagem'}
                  </button>
                </div>
                {uploadError && <p className="error-msg mt-1">{uploadError}</p>}
              </div>
              <button onClick={save} disabled={saving} className="btn-primary w-full mt-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {stockProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setStockProduct(null)}>
          <div className="glass rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">Atualizar estoque</h3>
              <button onClick={() => setStockProduct(null)} className="text-son-silver-dim hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-son-silver-dim mb-4">{stockProduct.name}</p>
            <label className="label">Nova quantidade em estoque</label>
            <input
              className="input-field mb-4"
              type="number"
              value={stockValue}
              onChange={(e) => setStockValue(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              {tab === 'falta' && (
                <button onClick={removeFromStockDialog} className="btn-secondary py-3 px-4 hover:text-son-pink">
                  <Trash2 className="w-4 h-4" /> Remover produto
                </button>
              )}
              <button onClick={saveStock} disabled={stockSaving} className="btn-primary flex-1">
                {stockSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
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
