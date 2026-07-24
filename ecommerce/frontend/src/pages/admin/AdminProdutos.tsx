import { useEffect, useRef, useState } from 'react'
import { Barcode, ImagePlus, Loader2, Package, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import Card from '../../components/ui/Card'
import BarcodePreview from '../../components/admin/BarcodePreview'
import { useConfirmDialog } from '../../components/admin/useConfirmDialog'
import { api, ApiError } from '../../lib/api'
import type { Category, Product } from '../../lib/types'

// Timestamp (10 dígitos) + 2 dígitos aleatórios — não é um EAN de verdade
// (sem dígito verificador), só um código único o bastante pra escanear no
// PDV com CODE128, que aceita qualquer texto.
function generateBarcode(): string {
  return `${String(Date.now()).slice(-10)}${String(Math.floor(Math.random() * 90) + 10)}`
}

function currency(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

const EMPTY_FORM = { name: '', description: '', price: '', quantity: '', image_url: '', category_id: '', barcode: '' }

export default function AdminProdutos() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { askConfirm, confirmDialogElement } = useConfirmDialog()

  const load = () => {
    setLoading(true)
    Promise.all([api.admin.products.list(), api.admin.categories.list()])
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
    }
    try {
      if (editing) await api.admin.products.update(editing.id, payload)
      else await api.admin.products.create(payload)
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const remove = (id: string) =>
    askConfirm('Remover este produto?', async () => {
      await api.admin.products.delete(id)
      load()
    })

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const { url } = await api.admin.products.uploadImage(file)
      setForm((f) => ({ ...f, image_url: url }))
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  const addCategory = async () => {
    if (!newCategory.trim()) return
    await api.admin.categories.create(newCategory.trim())
    setNewCategory('')
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">Produtos</h1>
        <button onClick={openNew} className="btn-primary text-sm py-2 px-4">
          <Plus className="w-4 h-4" /> Novo produto
        </button>
      </div>

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

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-son-pink" />
        </div>
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
                    <BarcodePreview value={form.barcode} />
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
      {confirmDialogElement}
    </div>
  )
}
